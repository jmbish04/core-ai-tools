/**
 * W2.5 — the multi-model run engine.
 *
 * Two halves:
 *  1. `buildPromptFor` is PURE, so the per-provider rewrite is tested with no
 *     provider, no db and no env. This is the part that decides how each model
 *     is addressed, and the branch is capability-flag-derived — the assertions
 *     name the flags, not model ids.
 *  2. The fan-out is driven end to end with the provider boundary stubbed
 *     (`dispatch`) and the CF Images boundary stubbed (`uploadImageBytes` /
 *     `variantUrl` / `fetchImageBase64`, which need bindings the test env does
 *     not have). Everything between them — capability enforcement, result-row
 *     lifecycle, library registration, status derivation — is the real code.
 *
 * The load-bearing test is "one model failing still returns the others": partial
 * failure is the whole premise of a comparison, and the easy bug is a
 * `Promise.all` that throws the good results away with the bad one.
 */

import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

/** Models whose dispatch should throw, set per test. */
const FAILING = new Set<string>();

vi.mock("@/backend/ai/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/ai/dispatch")>();
  return {
    ...actual,
    dispatch: vi.fn(async (input: { model: { id: string } }) => {
      if (FAILING.has(input.model.id)) {
        throw Object.assign(new Error(`provider exploded for ${input.model.id}`), { code: "provider" });
      }
      return {
        outputImageBytes: new ArrayBuffer(8),
        servedModel: input.model.id,
        servedVia: "direct" as const,
        tokensIn: 11,
        tokensOut: 22,
      };
    }),
  };
});

vi.mock("@/backend/core/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/core/images")>();
  return {
    ...actual,
    fetchImageBase64: vi.fn(async () => "AAAA"),
    uploadImageBytes: vi.fn(async () => ({ cfImageId: `cf-${crypto.randomUUID()}`, filename: null })),
    variantUrl: vi.fn(async () => "https://images.example/acct/img/full"),
  };
});

const {
  buildPromptFor,
  promptRegister,
  compareModels,
  createFolder,
  createMask,
  createModelRun,
  getModelRun,
  listModelRuns,
  requireImage,
} = await import("@/backend/core");
const { requireModel } = await import("@/backend/ai/registry");
const { callToolByName, handleMcp } = await import("@/backend/mcp/server");
const { ctx, seedImage } = await import("./helpers");

/** A model with a native mask channel (`mask_inpainting: true`), literal register. */
const NATIVE_MASK = "gpt-image-2.5-flare";
/** A narrative-register model (`blueprint_json` + `thinking_controllable`). */
const NARRATIVE = "gemini-3.1-flash-image";
/** Literal register: none of blueprint_json / thinking_controllable / interleaved_output. */
const LITERAL = "gpt-image-2";
/** Understanding-only — no `image_to_image`, no `text_to_image`. */
const INCAPABLE = "gemini-3.6-flash";

describe("buildPromptFor — the branch is capability flags, not model ids", () => {
  it("puts a model in the narrative register only when it exposes blueprint/thinking/interleaved output", () => {
    expect(promptRegister(requireModel(NARRATIVE))).toBe("narrative");
    expect(promptRegister(requireModel("gemini-3-pro-image"))).toBe("narrative");
    // No blueprint_json, no thinking_controllable, no interleaved_output.
    expect(promptRegister(requireModel(LITERAL))).toBe("literal");
    expect(promptRegister(requireModel("gemini-3.1-flash-lite-image"))).toBe("literal");
  });

  it("a native mask channel gets a short literal instruction with no region prose", () => {
    const model = requireModel(NATIVE_MASK);
    expect(model.capabilities.mask_inpainting).toBe(true);
    const out = buildPromptFor(model, { prompt: "make the sofa green", editing: true, masked: true, maskLabel: "the sofa" });
    expect(out).toBe("Edit only the masked area: make the sofa green");
    expect(out).not.toContain("the sofa. Apply");
    expect(out).not.toContain("pixel");
  });

  it("a model with no mask channel gets the region described in words plus a change-nothing-else clause", () => {
    // Synthetic entry: the catalog currently has no mask_emulated_only model, and
    // the branch must be driven by the FLAG, not by which ids happen to exist.
    const emulated = {
      ...requireModel(NARRATIVE),
      capabilities: { ...requireModel(NARRATIVE).capabilities, mask_inpainting: false, mask_emulated_only: true },
    };
    const out = buildPromptFor(emulated, { prompt: "make the sofa green", editing: true, masked: true, maskLabel: "the sofa" });
    expect(out).toContain("Apply this change ONLY to the sofa");
    expect(out).toContain("Leave every other part of the image exactly as it is");
    expect(out).not.toContain("Edit only the masked area");
  });

  it("falls back to 'the selected region' when the mask carries no label", () => {
    const emulated = {
      ...requireModel(NARRATIVE),
      capabilities: { ...requireModel(NARRATIVE).capabilities, mask_inpainting: false, mask_emulated_only: true },
    };
    expect(buildPromptFor(emulated, { prompt: "brighten it", masked: true })).toContain("ONLY to the selected region");
  });

  it("narrative models get context as a sentence and a preservation clause; literal models get neither", () => {
    const intent = { prompt: "swap the rug", editing: true, contextText: "every photo is the same living room" };
    const narrative = buildPromptFor(requireModel(NARRATIVE), intent);
    expect(narrative).toContain("Context: every photo is the same living room.");
    expect(narrative).toContain("Preserve the original composition");

    const literal = buildPromptFor(requireModel(LITERAL), intent);
    expect(literal).toBe("swap the rug (every photo is the same living room)");
    expect(literal).not.toContain("Preserve the original composition");
  });

  it("adds no preservation clause to prompt-only generation", () => {
    expect(buildPromptFor(requireModel(NARRATIVE), { prompt: "a fox" })).toBe("a fox");
  });
});

describe("createModelRun — the intent is recorded with each model's rewritten prompt", () => {
  it("rewrites a masked intent for the mask channel and records that the mask went in-band", async () => {
    const c = ctx();
    const img = await seedImage(c);
    // A RASTERISED mask: the bytes exist, so a native-channel model can be sent
    // them. `createMask` alone leaves cfImageId null — that case is the next test.
    const mask = await createMask(c, {
      sourceImageId: img.id,
      kind: "bbox",
      geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      label: "the sofa",
      cfImageId: `cf-mask-${crypto.randomUUID()}`,
    });

    const { results } = await createModelRun(c, {
      prompt: "make the sofa green",
      models: [NATIVE_MASK, NARRATIVE],
      inputImageId: img.id,
      maskId: mask.id,
    });

    // The two branches diverge, which is the point: OpenAI has a real mask
    // parameter, so it gets the short literal instruction and the mask bytes;
    // Gemini has none (the adapter sends the mask as an image part plus a
    // convention instruction), so it gets the region described in words and no
    // in-band mask. A change that collapses these two is a regression.
    const byModel = Object.fromEntries(results.map((r) => [r.requestedModel, r]));

    expect(byModel[NATIVE_MASK].promptSent).toContain("Edit only the masked area");
    expect(byModel[NATIVE_MASK].maskSent).toBe(true);

    expect(byModel[NARRATIVE].promptSent).toContain("the sofa");
    expect(byModel[NARRATIVE].promptSent).toContain("Leave every other part of the image");
    expect(byModel[NARRATIVE].maskSent).toBe(false);

    for (const id of [NATIVE_MASK, NARRATIVE]) {
      expect(byModel[id].status).toBe("queued");
    }
  });

  it("does not claim a mask went in-band when the mask has no raster to send", async () => {
    // A semantic mask sits `proposed` with no cfImageId until it is rasterised,
    // and execution only attaches bytes when one exists. Recording maskSent from
    // model capability alone made the row claim a mask the provider never got,
    // so the comparison read as mask-vs-mask when it was prompt-vs-prompt.
    const c = ctx();
    const img = await seedImage(c);
    const unrasterised = await createMask(c, {
      sourceImageId: img.id,
      kind: "bbox",
      geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      label: "the sofa",
    });

    const { results } = await createModelRun(c, {
      prompt: "make the sofa green",
      models: [NATIVE_MASK],
      inputImageId: img.id,
      maskId: unrasterised.id,
    });

    expect(results[0].maskSent).toBe(false);
  });

  it("stores a different prompt_sent per register for the same unmasked intent", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { results } = await createModelRun(c, {
      prompt: "swap the rug",
      models: [NARRATIVE, LITERAL],
      inputImageId: img.id,
      contextText: "same living room throughout",
    });
    const byModel = Object.fromEntries(results.map((r) => [r.requestedModel, r]));
    expect(byModel[NARRATIVE].promptSent).not.toBe(byModel[LITERAL].promptSent);
    expect(byModel[NARRATIVE].promptSent).toContain("Preserve the original composition");
    expect(byModel[LITERAL].promptSent).toBe("swap the rug (same living room throughout)");
  });

  it("validates before writing anything: empty prompt, no models, too many, mask without an image", async () => {
    const c = ctx();
    await expect(createModelRun(c, { prompt: "  ", models: [NARRATIVE] })).rejects.toThrow("prompt is required");
    await expect(createModelRun(c, { prompt: "x", models: [] })).rejects.toThrow("At least one model");
    await expect(
      createModelRun(c, { prompt: "x", models: ["a", "b", "c", "d", "e", "f", "g"] }),
    ).rejects.toThrow("at most 6 models");
    await expect(createModelRun(c, { prompt: "x", models: [NARRATIVE], maskId: "nope" })).rejects.toThrow(
      "requires an inputImageId",
    );
  });

  it("marks an unregistered model id failed on its own row without rejecting the run", async () => {
    const c = ctx();
    const { results, status } = await createModelRun(c, { prompt: "a fox", models: [NARRATIVE, "not-a-model"] });
    const bad = results.find((r) => r.requestedModel === "not-a-model")!;
    expect(bad.status).toBe("failed");
    expect(bad.errorCode).toBe("not_found");
    expect(results.find((r) => r.requestedModel === NARRATIVE)!.status).toBe("queued");
    expect(status).toBe("running");
  });
});

describe("executeModelRun — concurrent fan-out, partial failure is first-class", () => {
  it("ONE MODEL FAILING STILL RETURNS THE OTHERS", async () => {
    FAILING.clear();
    FAILING.add(NATIVE_MASK);
    const c = ctx();
    const folder = await createFolder(c, { name: "runs" });

    const out = await compareModels(c, {
      prompt: "a fox in snow",
      models: [NARRATIVE, NATIVE_MASK, LITERAL],
      folderId: folder.id,
    });
    FAILING.clear();

    expect(out.status).toBe("partial");
    const byModel = Object.fromEntries(out.results.map((r) => [r.requestedModel, r]));

    expect(byModel[NATIVE_MASK].status).toBe("failed");
    expect(byModel[NATIVE_MASK].errorMessage).toContain("provider exploded");
    expect(byModel[NATIVE_MASK].outputImageId).toBeNull();

    for (const id of [NARRATIVE, LITERAL]) {
      expect(byModel[id].status).toBe("succeeded");
      expect(byModel[id].servedModel).toBe(id);
      expect(byModel[id].outputImageId).toBeTruthy();
      expect(byModel[id].tokensIn).toBe(11);
      expect(byModel[id].latencyMs).toBeGreaterThanOrEqual(0);
      // The output is a real library image, in the run's folder, so it shows up
      // in the folder tree like any other image.
      const image = await requireImage(c, byModel[id].outputImageId!);
      expect(image.folderId).toBe(folder.id);
      expect(image.description).toBe(byModel[id].promptSent);
    }
  });

  it("a model that cannot satisfy the capability rejects itself, the run still succeeds elsewhere", async () => {
    const c = ctx();
    const out = await compareModels(c, { prompt: "a fox", models: [NARRATIVE, INCAPABLE] });
    const bad = out.results.find((r) => r.requestedModel === INCAPABLE)!;
    expect(bad.status).toBe("failed");
    expect(bad.errorCode).toBe("capability");
    expect(out.results.find((r) => r.requestedModel === NARRATIVE)!.status).toBe("succeeded");
    expect(out.status).toBe("partial");
  });

  it("every model failing derives status 'failed', and nothing throws", async () => {
    FAILING.clear();
    FAILING.add(NARRATIVE);
    FAILING.add(LITERAL);
    const out = await compareModels(ctx(), { prompt: "a fox", models: [NARRATIVE, LITERAL] });
    FAILING.clear();
    expect(out.status).toBe("failed");
    expect(out.results.every((r) => r.status === "failed")).toBe(true);
  });

  it("all models succeeding derives status 'succeeded', in requested-model order", async () => {
    const c = ctx();
    const created = await compareModels(c, { prompt: "a fox", models: [LITERAL, NARRATIVE] });
    expect(created.status).toBe("succeeded");
    expect(created.results.map((r) => r.requestedModel)).toEqual([LITERAL, NARRATIVE]);

    const reread = await getModelRun(c, created.run.id);
    expect(reread.status).toBe("succeeded");
    expect(reread.results.map((r) => r.requestedModel)).toEqual([LITERAL, NARRATIVE]);
  });

  it("lists runs newest-first and scopes them to a folder", async () => {
    const c = ctx();
    const folder = await createFolder(c, { name: "scoped" });
    await compareModels(c, { prompt: "unscoped", models: [NARRATIVE] });
    const scoped = await compareModels(c, { prompt: "scoped", models: [NARRATIVE], folderId: folder.id });

    const inFolder = await listModelRuns(c, { folderId: folder.id });
    expect(inFolder.map((r) => r.run.id)).toEqual([scoped.run.id]);
    expect(inFolder[0].results).toHaveLength(1);

    const all = await listModelRuns(c, {});
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0].run.createdAt.getTime()).toBeGreaterThanOrEqual(all[1].run.createdAt.getTime());
  });
});

describe("W2.5 surfaces — REST and MCP", () => {
  /** Call an MCP tool by name and parse its single text block. */
  async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const out = await callToolByName(ctx(), name, args, "app.example");
    const text = (out.content[0] as { text?: string }).text ?? "";
    if (out.isError) throw new Error(text);
    return JSON.parse(text);
  }

  it("compare_models / get_model_run / list_model_runs are dispatchable and carry prompt_sent + URLs", async () => {
    const run = await tool("compare_models", { prompt: "a fox", models: [NARRATIVE, LITERAL] });
    expect(run.status).toBe("succeeded");
    expect(run.results).toHaveLength(2);
    expect(run.results[0].prompt_sent).toBeTruthy();
    // No inline bytes — the payload carries ids/URLs only (the URL itself is
    // null in tests: the Images account hash does not resolve without bindings).
    expect(run.results[0].image_id).toBeTruthy();
    expect(JSON.stringify(run)).not.toContain("base64");
    expect(run.app_url).toBe(`https://app.example/runs/${run.run_id}`);

    const fetched = await tool("get_model_run", { runId: run.run_id });
    expect(fetched.run_id).toBe(run.run_id);

    const listed = await tool("list_model_runs", { limit: 5 });
    expect(listed.runs.map((r: any) => r.run_id)).toContain(run.run_id);
  });

  it("the run routes are zod-openapi-registered, so they land in /openapi.json", async () => {
    const { OpenAPIHono } = await import("@hono/zod-openapi");
    const { runsRouter } = await import("@/backend/api/routes/runs");
    const app = new OpenAPIHono<{ Bindings: Env }>();
    app.route("/", runsRouter);
    app.doc("/openapi.json", { openapi: "3.1.0", info: { title: "t", version: "1" } });

    const spec: any = await (await app.request("/openapi.json", {}, env)).json();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/api/runs", "/api/runs/{id}"]));
    expect(Object.keys(spec.paths["/api/runs"]).sort()).toEqual(["get", "post"]);
  });

  it("tools/list STILL advertises exactly the 3 code-mode tools", async () => {
    const res = await handleMcp(
      new Request("https://app.example/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools).toHaveLength(3);
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["execute", "get_schema", "search"]);
    // …while the new named tools stay findable and callable.
    const found = await tool("search", { query: "model_run" });
    expect(found.tools.map((t: any) => t.name)).toEqual(
      expect.arrayContaining(["get_model_run", "list_model_runs"]),
    );
  });

  it("POST /api/runs then GET /api/runs/{id} round-trips through the real router", async () => {
    const { OpenAPIHono } = await import("@hono/zod-openapi");
    const { runsRouter } = await import("@/backend/api/routes/runs");
    const { errorHandler } = await import("@/backend/api/middleware/error");
    const app = new OpenAPIHono<{ Bindings: Env }>();
    app.onError(errorHandler as never);
    app.route("/", runsRouter);

    const created: any = await (
      await app.request(
        "/api/runs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "a fox", models: [NARRATIVE] }),
        },
        env,
        { waitUntil: () => {}, passThroughOnException: () => {} } as never,
      )
    ).json();
    expect(created.status).toBe("succeeded");

    const res = await app.request(`/api/runs/${created.run.id}`, {}, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).run.id).toBe(created.run.id);

    // A core error keeps its status through the real error handler.
    const missing = await app.request("/api/runs/nope", {}, env);
    expect(missing.status).toBe(404);

  });
});
