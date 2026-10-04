/**
 * The health endpoint must be REACHABLE and must be able to say "no".
 *
 * Both halves shipped broken, and both read as green, which is why this file
 * exists. Measured against the deployed Worker 2026-10-01:
 *
 *   GET /health       -> <title>Sign in · core-ai-tools</title>, 7,003 bytes
 *   GET /api/health   -> {"run":null,"results":[]}, HTTP 200
 *
 * The first is the page gate swallowing `/health` (no extension, not `/api`,
 * not `/login`). The second is a handler that returned the last PERSISTED run
 * without running anything — and nothing had ever been persisted, so it
 * answered 200 forever. An uptime monitor called the service UP in both cases.
 * That is the failure mode the briefing names: an instrument that cannot fail
 * is not reporting.
 *
 * Every assertion below was confirmed to go RED against the old code before the
 * fix landed — a test that has never failed is not reporting either.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { healthRouter } from "@/backend/api/routes/health";
import { errorHandler } from "@/backend/api/middleware/error";
import { apiPathFor, isApiPath, isPageRequest } from "@/backend/routing/path-gates";

/** Mount exactly as `api/index.ts` does: ONCE, at /api/health. */
function api() {
  const app = new OpenAPIHono<{ Bindings: Env }>();
  app.onError(errorHandler as never);
  app.route("/api/health", healthRouter);
  return app;
}

/**
 * The test env has a real migrated D1 but no Durable Object or KV bindings —
 * `vitest.config.mts` declares only `d1Databases` and one R2 bucket. So the
 * REQUIRED_BINDINGS presence checks would fail here for a reason that says
 * nothing about the code.
 *
 * This supplies them, and the premise is stated rather than hidden: those
 * checks assert PRESENCE only, so a sentinel is a faithful stand-in. Every
 * regression below starts from this full env and DELETES one binding, which is
 * what makes the red/green meaningful — the condition is false by default and
 * the planted fault is the only thing that changes it.
 */
function fullEnv(): Record<string, unknown> {
  const bound = env as unknown as Record<string, unknown>;
  return {
    ...bound,
    SESSION_DO: bound.SESSION_DO ?? { __stub: "SESSION_DO" },
    FOLDER_DO: bound.FOLDER_DO ?? { __stub: "FOLDER_DO" },
    OAUTH_KV: bound.OAUTH_KV ?? { __stub: "OAUTH_KV" },
  };
}

/** Resolve the public path the way `_worker.ts` does, then request it. */
const getWith = (path: string, e: Record<string, unknown>) =>
  api().request(new Request(`https://t.local${apiPathFor(path)}`), undefined, e as never);

const get = (path: string) => getWith(path, fullEnv());

describe("the page gate must not own /health", () => {
  it("routes /health to the API, not the page gate", () => {
    // The whole bug in one line: before the fix this was false, so /health fell
    // through to isPageRequest and redirected to /login.
    expect(isApiPath("/health")).toBe(true);
    expect(isPageRequest("/health")).toBe(false);
  });

  it("still gates real pages, so the fix did not open the door", () => {
    for (const page of ["/", "/library", "/sessions", "/folders", "/assets"]) {
      expect(isPageRequest(page)).toBe(true);
    }
  });

  it("keeps every other exemption intact", () => {
    for (const p of ["/login", "/api/library/images", "/openapi.json", "/mcp", "/_astro/x.js"]) {
      expect(isPageRequest(p)).toBe(false);
    }
    // An extension-bearing path is an asset, never a page.
    expect(isPageRequest("/favicon.svg")).toBe(false);
  });
});

describe("GET /health and /api/health answer with a live verdict", () => {
  it("resolves the public /health to the one mounted path", () => {
    expect(apiPathFor("/health")).toBe("/api/health");
    // Identity for everything else — an entry here is the ONLY way a public
    // path may differ from the path that serves it.
    for (const p of ["/api/health", "/api/health/latest", "/openapi.json", "/library"]) {
      expect(apiPathFor(p)).toBe(p);
    }
  });

  it("serves the same body whichever path is asked for", async () => {
    const [root, direct] = await Promise.all([get("/health"), get("/api/health")]);
    expect(root.status).toBe(direct.status);
    const [a, b] = await Promise.all([root.json(), direct.json()]);
    // checkedAt/durationMs are per-request; the verdict and checks must match.
    expect((a as Record<string, unknown>).status).toEqual((b as Record<string, unknown>).status);
    expect((a as { checks: unknown[] }).checks.map((c) => (c as { name: string }).name)).toEqual(
      (b as { checks: unknown[] }).checks.map((c) => (c as { name: string }).name),
    );
  });

  it("RUNS checks rather than replaying a persisted run", async () => {
    const body = (await (await get("/health")).json()) as {
      status: string;
      checks: Array<{ name: string; status: string }>;
      lastDeepRun: unknown;
      checkedAt: string;
    };
    // The old handler returned {run:null,results:[]} — zero checks, no verdict.
    expect(body.checks.length).toBeGreaterThan(0);
    expect(body.status).not.toBe("unknown");
    expect(Date.parse(body.checkedAt)).not.toBeNaN();
    // No deep run has been persisted in a fresh test DB, and that must NOT be
    // the answer — only context.
    expect(body.lastDeepRun).toBeNull();
  });

  /**
   * This assertion is driven by the table's actual CONTENTS, and that is the
   * whole point. The first version of it only checked that a check named
   * `d1_table_read` existed and that its message mentioned `model_catalog` —
   * so when the implementation was reverted to `SELECT 1` with a hard-coded
   * row, it still PASSED. A test that survives the bug it names is not a test.
   *
   * Reading empty-vs-populated cannot be faked by a binding-level ping: the
   * verdict has to follow the rows.
   */
  it("follows the real table's contents, so SELECT 1 cannot satisfy it", async () => {
    // A freshly migrated test DB has an empty model_catalog.
    const empty = (await (await get("/health")).json()) as {
      status: string;
      checks: Array<{ name: string; status: string; message?: string }>;
    };
    const before = empty.checks.find((c) => c.name === "d1_table_read");
    expect(before?.status, "empty config table must not read as ok").toBe("warn");
    expect(before?.message).toMatch(/EMPTY/);
    // An empty catalog means model resolution has nothing to resolve against,
    // so the overall verdict must drop out of "healthy" too.
    expect(empty.status).toBe("degraded");

    await env.DB.prepare(
      `INSERT INTO model_catalog
         (model_id, provider, display_name, capabilities, is_new, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
      .bind("probe-model", "google", "Probe", "{}", 0, 0)
      .run();

    const populated = (await (await get("/health")).json()) as {
      status: string;
      checks: Array<{ name: string; status: string }>;
    };
    expect(
      populated.checks.find((c) => c.name === "d1_table_read")?.status,
      "a populated catalog must flip the check to ok",
    ).toBe("ok");
    expect(populated.status).toBe("healthy");
  });

  it("names every REQUIRED binding as its own check", async () => {
    const body = (await (await get("/health")).json()) as {
      checks: Array<{ name: string }>;
    };
    const names = body.checks.map((c) => c.name);
    for (const b of ["binding_db", "binding_session_do", "binding_folder_do", "binding_oauth_kv"]) {
      expect(names).toContain(b);
    }
  });
});

describe("a failure changes the verdict AND the status code", () => {
  /**
   * The planted regression, and the reason this block exists: a check that
   * records a component as down without changing the verdict is worse than no
   * check, because it produces a record that reads as diligence. So drop a
   * REQUIRED binding and assert the endpoint goes red — in the body and in the
   * status line, since a monitor may only read the latter.
   */
  it("returns 503 and 'unhealthy' when a required binding is missing", async () => {
    const crippled = fullEnv();
    delete crippled.FOLDER_DO;

    const res = await getWith("/health", crippled);
    expect(res.status).toBe(503);

    const body = (await res.json()) as { status: string; checks: Array<{ name: string; status: string }> };
    expect(body.status).toBe("unhealthy");
    const missing = body.checks.find((c) => c.name === "binding_folder_do");
    expect(missing?.status).toBe("fail");
  });

  it("is 200 and not 'unhealthy' when everything required is present", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).not.toBe("unhealthy");
  });

  it("reports a missing binding as fail, never skipped", async () => {
    // `skipped` is the honest answer for an OPTIONAL dependency. For a declared
    // requirement it is how "missing" silently becomes "fine".
    const crippled = fullEnv();
    delete crippled.OAUTH_KV;
    const res = await getWith("/health", crippled);
    const body = (await res.json()) as { checks: Array<{ name: string; status: string }> };
    expect(body.checks.find((c) => c.name === "binding_oauth_kv")?.status).toBe("fail");
  });
});

describe("the OpenAPI spec stays valid", () => {
  /**
   * My first attempt at exposing `/health` mounted the health router a SECOND
   * time, at the root. That emitted 6 paths with 3 duplicate `operationId`s —
   * invalid, since operationId must be unique — and silently published
   * `/health/run` and `/health/latest`, which nothing asked for. Nothing failed:
   * the spec just quietly became wrong.
   *
   * So the rewrite is the mechanism, and this is the guard. Re-adding
   * `app.route("/health", healthRouter)` fails here.
   */
  it("registers each health operation exactly once, and nothing at the root", async () => {
    const app = new OpenAPIHono<{ Bindings: Env }>();
    app.route("/api/health", healthRouter);
    app.doc("/openapi.json", { openapi: "3.1.0", info: { title: "t", version: "1" } });

    const spec = (await (await app.request("https://t.local/openapi.json")).json()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };

    const ids: string[] = [];
    for (const methods of Object.values(spec.paths ?? {})) {
      for (const op of Object.values(methods)) if (op?.operationId) ids.push(op.operationId);
    }
    expect(ids.filter((id, i) => ids.indexOf(id) !== i), "duplicate operationIds").toEqual([]);
    expect([...ids].sort()).toEqual(["getLatestHealthCheck", "healthCheck", "runHealthCheck"]);

    // No health operation may be published at the bare root.
    expect(Object.keys(spec.paths ?? {}).filter((p) => !p.startsWith("/api/"))).toEqual([]);
  });

  it("declares both 200 and 503 on the live probe", async () => {
    const app = new OpenAPIHono<{ Bindings: Env }>();
    app.route("/api/health", healthRouter);
    app.doc("/openapi.json", { openapi: "3.1.0", info: { title: "t", version: "1" } });
    const spec = (await (await app.request("https://t.local/openapi.json")).json()) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    // An undeclared status would make the 503 a lie in the published contract.
    expect(Object.keys(spec.paths["/api/health"].get.responses ?? {}).sort()).toEqual(["200", "503"]);
  });
});
