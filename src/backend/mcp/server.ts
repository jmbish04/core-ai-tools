/**
 * @fileoverview `/mcp` — a Streamable-HTTP MCP server (JSON-RPC 2.0) over the
 * shared core. No SDK dependency: it implements `initialize`, `tools/list`, and
 * `tools/call` directly. Every image-producing tool returns the §4.2 compact
 * payload (never inline bytes). Tool names are snake_case; each is session-scoped
 * and its results are visible in the web UI in realtime.
 *
 * Mount: the Worker routes `/mcp` to the Hono app (see `_worker.ts` isApiPath).
 */

import { z } from "zod";

import {
  approveRevision,
  cancelRevision,
  createCoreContext,
  createFolder,
  createMask,
  createSemanticMask,
  rasterizeAndUploadMask,
  createSession,
  describeMask,
  executeRevision,
  flagImageBad,
  unflagImageBad,
  registerImageFromSource,
  forkRevision,
  finishMcpLog,
  generateImages,
  GENERATE_PRESETS,
  MAX_GENERATE_COUNT,
  VARIATION_SUFFIXES,
  gradeRevision,
  listLibrary,
  listMasks,
  listMcpLogs,
  listSessions,
  listSessionsForImage,
  listTemplates,
  sniffRevisionId,
  startMcpLog,
  pinRevision,
  promoteFromRevision,
  rejectRevision,
  retryRevision,
  setAssetTtl,
  softDeleteMask,
  submitEdit,
  getSessionTree,
} from "@/backend/core";
import type { CoreContext } from "@/backend/core";
import { listModels } from "@/backend/ai/registry";
import { buildMcpEditPayload } from "./payload";
import {
  imageContentBlock,
  maskImageBlock,
  revisionImageBlock,
  serializeLibrary,
  serializeMasks,
  serializeSessions,
  serializeSessionTree,
  resolveImageUrls,
} from "./serialize";

// Auth is enforced by the OAuth 2.1 layer (workers-oauth-provider) that wraps
// this handler: OAuth-issued access tokens are validated before `handleMcp` runs,
// and the WORKER_API_KEY bearer is accepted via the `resolveExternalToken`
// callback (see backend/mcp/oauth.ts). So `handleMcp` here assumes the request is
// already authenticated and just dispatches.

const SESSION_NOTE = "Session-scoped; results appear in the web UI in realtime.";

interface ToolDef {
  description: string;
  schema: z.ZodTypeAny;
  handler: (ctx: CoreContext, args: Record<string, unknown>, host: string) => Promise<unknown>;
  /** Handler returns MCP content blocks directly (e.g. image blocks) — not JSON. */
  raw?: boolean;
}

/** Wrap a revision result in the §4.2 compact payload. */
async function editPayload(ctx: CoreContext, rev: Awaited<ReturnType<typeof submitEdit>>, host: string) {
  return buildMcpEditPayload(ctx, rev, host);
}

/**
 * Run a freshly-`queued` revision to completion, then return its compact payload.
 * MCP has no `waitUntil`, so we execute inline (the tool call awaits the result —
 * the caller sees the finished revision, not a stuck `queued` one). Non-queued
 * results (awaiting_approval) pass through untouched.
 */
async function runAndPayload(ctx: CoreContext, rev: Awaited<ReturnType<typeof submitEdit>>, host: string) {
  const executed = rev?.status === "queued" ? await executeRevision(ctx, { revisionId: rev.id, surface: "mcp" }) : rev;
  return editPayload(ctx, executed as typeof rev, host);
}

/**
 * Build the MCP content for an image tool: the inline image block (base64) PLUS
 * a text block carrying the public CF Images URLs, so a client can ingest the
 * pixels directly OR fetch the URL — whichever is more native to it.
 */
function imageResultContent(r: { image: unknown; imageUrl: string | null; thumbUrl: string | null }) {
  return [r.image, { type: "text", text: JSON.stringify({ imageUrl: r.imageUrl, thumbUrl: r.thumbUrl }) }];
}

const TOOLS: Record<string, ToolDef> = {
  generate_image: {
    description:
      `Generate NEW images from a text prompt (no source image) into the library; returns image ids + URLs. ` +
      `Use a returned image id as create_session.originLibraryImageId to start editing it. ` +
      `Variations: count (1–${MAX_GENERATE_COUNT}), styles[] (one image per style, e.g. watercolor, photorealistic), ` +
      `variations[] (each axis adds 2 prompts; crossed with styles, clamped to count). Variations render in parallel. ` +
      `preset: icon (type app-icon|favicon|ui-element, style, background), pattern (type seamless|texture|wallpaper, ` +
      `style, density sparse|medium|dense, colors), diagram (type flowchart|architecture|network|database|wireframe|` +
      `mindmap|sequence, style, layout, density=complexity, colors), story (count frames, default 4; type ` +
      `story|process|tutorial|timeline — frames are chained for visual consistency, rendered sequentially). ` +
      `Partial failures are listed per prompt; the call errors only if nothing rendered.`,
    schema: z.object({
      prompt: z.string().min(1),
      count: z.number().int().min(1).max(MAX_GENERATE_COUNT).optional(),
      styles: z.array(z.string().min(1)).max(MAX_GENERATE_COUNT).optional(),
      variations: z.array(z.enum(Object.keys(VARIATION_SUFFIXES) as [string, ...string[]])).optional(),
      preset: z.enum(GENERATE_PRESETS).optional(),
      type: z.string().optional(),
      style: z.string().optional(),
      background: z.string().optional(),
      density: z.string().optional(),
      colors: z.string().optional(),
      layout: z.string().optional(),
      requestedModel: z.string().optional(),
      aspectRatio: z.string().optional(),
      resolution: z.enum(["512px", "1K", "2K", "4K"]).optional(),
      folderId: z.string().optional(),
    }),
    handler: async (ctx, a, host) => {
      const out = await generateImages(ctx, { ...(a as any), surface: "mcp" });
      const urls = await resolveImageUrls(ctx, out.images.map((i) => i.image.id), `https://${host}`);
      return {
        model: out.model,
        images: out.images.map((i) => ({
          index: i.index,
          image_id: i.image.id,
          prompt: i.prompt,
          image_url: urls.get(i.image.id)?.imageUrl ?? null,
          thumb_url: urls.get(i.image.id)?.thumbUrl ?? null,
        })),
        failures: out.failures,
      };
    },
  },
  create_session: {
    description: `Start a session from a library image. A session name (title) is REQUIRED. ${SESSION_NOTE}`,
    schema: z.object({
      originLibraryImageId: z.string(),
      title: z.string().min(1, "A session name (title) is required."),
      approvalPolicy: z.enum(["auto", "masked_only", "always"]).optional(),
    }),
    handler: (ctx, a) => createSession(ctx, { ...(a as any), createdVia: "mcp" }),
  },
  list_sessions: {
    description: "List sessions. Each row carries originImageUrls (thumb/full) for its origin image.",
    schema: z.object({ status: z.enum(["active", "archived"]).optional(), limit: z.number().optional() }),
    handler: async (ctx, a, host) => serializeSessions(ctx, await listSessions(ctx, a as any), `https://${host}`),
  },
  list_sessions_for_image: {
    description: "Every session descended from one library image.",
    schema: z.object({ imageId: z.string() }),
    handler: (ctx, a) => listSessionsForImage(ctx, a.imageId as string),
  },
  get_session_tree: {
    description: `Full revision tree, retry attempts grouped. Every image reference (seed, each attempt's input + output, multi-image reference sets) carries thumbUrl/imageUrl. To SEE a render, call get_revision_image. ${SESSION_NOTE}`,
    schema: z.object({ sessionUuid: z.string() }),
    handler: async (ctx, a, host) =>
      serializeSessionTree(ctx, await getSessionTree(ctx, a.sessionUuid as string), `https://${host}`),
  },
  submit_edit: {
    description:
      `Create a revision (queued or awaiting_approval); progress streams to the web UI. ${SESSION_NOTE} ` +
      `Supply idempotency_key so a retry of a dropped call returns the same revision. ` +
      `references[] adds up to 14 extra reference images (beyond the base) for multi-reference models ` +
      `(Pro: ≤6 object, ≤3 style) — each { imageId, role: object|style }; register a raw image with register_image first.`,
    schema: z.object({
      sessionUuid: z.string(),
      parentRevisionId: z.string(),
      promptText: z.string().optional(),
      editPayload: z.any(),
      requestedModel: z.string(),
      maskId: z.string().optional(),
      maskMode: z.enum(["none", "inpaint", "preserve"]).optional(),
      references: z
        .array(z.object({ imageId: z.string(), role: z.enum(["base", "object", "style"]) }))
        .optional(),
      idempotencyKey: z.string().optional(),
    }),
    handler: async (ctx, a, host) =>
      runAndPayload(ctx, await submitEdit(ctx, { ...(a as any), createdVia: "mcp" }), host),
  },
  retry_revision: {
    description: "New attempt of an edit (same parent + fingerprint).",
    schema: z.object({ revisionId: z.string(), idempotencyKey: z.string().optional() }),
    handler: async (ctx, a, host) =>
      runAndPayload(ctx, await retryRevision(ctx, { ...(a as any), createdVia: "mcp" }), host),
  },
  fork_revision: {
    description: "Branch a new edit from any node (including a failed one).",
    schema: z.object({
      fromRevisionId: z.string(),
      editPayload: z.any(),
      requestedModel: z.string(),
      promptText: z.string().optional(),
      maskId: z.string().optional(),
      maskMode: z.enum(["none", "inpaint", "preserve"]).optional(),
      idempotencyKey: z.string().optional(),
    }),
    handler: async (ctx, a, host) =>
      runAndPayload(ctx, await forkRevision(ctx, { ...(a as any), createdVia: "mcp" }), host),
  },
  pin_revision: {
    description: "Mark the accepted result (protects a video output from TTL).",
    schema: z.object({ revisionId: z.string() }),
    handler: (ctx, a) => pinRevision(ctx, { revisionId: a.revisionId as string }),
  },
  cancel_revision: {
    description: "Cancel in-flight work.",
    schema: z.object({ revisionId: z.string() }),
    handler: (ctx, a) => cancelRevision(ctx, a.revisionId as string),
  },
  approve_revision: {
    description: `Approve a gated revision (HITL). ${SESSION_NOTE}`,
    schema: z.object({ revisionId: z.string() }),
    handler: async (ctx, a, host) =>
      runAndPayload(ctx, await approveRevision(ctx, { revisionId: a.revisionId as string, approvedBySurface: "mcp" }), host),
  },
  reject_revision: {
    description: "Reject a gated revision (it stays in the tree).",
    schema: z.object({ revisionId: z.string(), reason: z.string().optional() }),
    handler: (ctx, a) => rejectRevision(ctx, { revisionId: a.revisionId as string, rejectionReason: a.reason as string, rejectedBySurface: "mcp" }),
  },
  create_mask: {
    description:
      `Create a mask and get back a maskId to pass to submit_edit(maskId, maskMode). ` +
      `kind='bbox' geometry={x,y,w,h} (0–1); kind='polygon' geometry={points:[{x,y}…]} (0–1); ` +
      `both rasterise server-side to the exact edit region — no segmenter or human draw needed. ` +
      `kind='semantic' resolves a natural-language region ('the shower head', 'the countertop') via segmentation. ` +
      `kind='raster' expects a pre-uploaded PNG via cfImageId. Explicit bbox/polygon are 'confirmed' ` +
      `(precise, ungated); semantic is 'proposed' (a blind estimate). Returns the mask row incl. its id (the ` +
      `same id shown in the UI); call get_mask_image / describe_mask to SEE the result and confirm. ${SESSION_NOTE}`,
    schema: z.object({
      sessionUuid: z.string().optional(),
      sourceImageId: z.string(),
      kind: z.enum(["bbox", "polygon", "raster", "semantic"]),
      geometry: z.any().optional(),
      cfImageId: z.string().optional(),
      description: z.string().optional(),
      label: z.string().optional(),
      maskMode: z.enum(["inpaint", "preserve"]).optional(),
    }),
    handler: async (ctx, a) => {
      if (a.kind === "semantic") {
        return createSemanticMask(ctx, { sessionUuid: a.sessionUuid as string, sourceImageId: a.sourceImageId as string, description: String(a.description ?? ""), createdVia: "mcp" });
      }
      // Explicit geometry is a precise instruction, not a blind estimate — don't
      // gate it behind approval, so a bbox inpaint lands in one surgical pass.
      // bbox/polygon carry no PNG; rasterise + upload so they reach the provider.
      let cfImageId = (a.cfImageId as string | undefined) ?? null;
      let coverageRatio: number | undefined;
      if (a.kind === "bbox" || a.kind === "polygon") {
        const r = await rasterizeAndUploadMask(ctx, {
          kind: a.kind,
          geometry: a.geometry,
          sourceImageId: a.sourceImageId as string,
        });
        cfImageId = r.cfImageId;
        coverageRatio = r.coverageRatio;
      }
      const state = a.kind === "bbox" || a.kind === "polygon" ? "confirmed" : undefined;
      return createMask(ctx, { ...(a as any), cfImageId, coverageRatio, state, createdVia: "mcp" });
    },
  },
  list_masks: {
    description:
      "List masks for a session (or library-scoped). Each row carries its id (visible in the UI too), kind, geometry, mode, state, plus maskThumbUrl/maskImageUrl (the painted raster) and sourceImageUrls.",
    schema: z.object({ sessionUuid: z.string().optional() }),
    handler: async (ctx, a, host) => serializeMasks(ctx, await listMasks(ctx, a as any), `https://${host}`),
  },
  describe_mask: {
    description: "Return a mask row + geometry. To SEE the mask over the image, call get_mask_image.",
    schema: z.object({ maskId: z.string() }),
    handler: (ctx, a) => describeMask(ctx, a.maskId as string),
  },
  get_mask_image: {
    description:
      "SEE a mask for confirmation: returns an MCP image of the source with the mask drawn over it (semi-transparent). Use this to ask the user whether the mask is correct before running an edit.",
    raw: true,
    schema: z.object({ maskId: z.string() }),
    handler: async (ctx, a) => imageResultContent(await maskImageBlock(ctx, a.maskId as string)),
  },
  drop_mask: {
    description: "Drop (soft-delete) a mask by id — e.g. when the user rejects it, or to clear masks so a model that can't handle masks can run. Revision history keeps its reference.",
    schema: z.object({ maskId: z.string() }),
    handler: (ctx, a) => softDeleteMask(ctx, a.maskId as string),
  },
  list_library: {
    description: "List library images. Each row carries thumbUrl/imageUrl. To SEE an image, call get_library_image.",
    schema: z.object({ folderId: z.string().optional(), limit: z.number().optional() }),
    handler: async (ctx, a, host) => serializeLibrary(ctx, await listLibrary(ctx, a as any), `https://${host}`),
  },
  get_revision_image: {
    description:
      "Return a revision's image as an MCP image content block you can SEE (base64) PLUS a text block with its public Cloudflare Images URL (imageUrl/thumbUrl) — ingest whichever is more native. which=output|input (default output), variant=thumb|full (default thumb — small, ~512px). Use whenever get_session_tree hands you an outputImageId you want to inspect.",
    raw: true,
    schema: z.object({
      revisionUuid: z.string(),
      which: z.enum(["output", "input"]).optional(),
      variant: z.enum(["thumb", "full"]).optional(),
    }),
    handler: async (ctx, a) =>
      imageResultContent(
        await revisionImageBlock(
          ctx,
          a.revisionUuid as string,
          (a.which as "output" | "input") ?? "output",
          (a.variant as "thumb" | "full") ?? "thumb",
        ),
      ),
  },
  get_library_image: {
    description:
      "Return a library image (seed/reference) as an MCP image content block you can SEE (base64) PLUS its public Cloudflare Images URL. variant=thumb|full (default thumb).",
    raw: true,
    schema: z.object({ libraryImageId: z.string(), variant: z.enum(["thumb", "full"]).optional() }),
    handler: async (ctx, a) =>
      imageResultContent(
        await imageContentBlock(ctx, a.libraryImageId as string, (a.variant as "thumb" | "full") ?? "thumb"),
      ),
  },
  register_image: {
    description:
      "Register an image into the library and get its id (use it as a submit_edit reference). " +
      "Provide EXACTLY ONE of: cfImagesUrl (an imagedelivery.net URL — registered by id, deduped, no re-upload), " +
      "imageUrl (any http(s) image — fetched and re-hosted to Cloudflare Images), or base64. " +
      "Optional description is stored on the row and used as reference context.",
    schema: z.object({
      cfImagesUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      base64: z.string().optional(),
      description: z.string().optional(),
      folderId: z.string().optional(),
    }),
    handler: (ctx, a) => registerImageFromSource(ctx, { ...(a as any), uploadedVia: "mcp" }),
  },
  mark_image_bad: {
    description:
      "Flag a library image as bad so it's visibly ignored for editing, with an optional reason. Reversible via unmark_image_bad.",
    schema: z.object({ libraryImageId: z.string(), notes: z.string().optional() }),
    handler: (ctx, a) => flagImageBad(ctx, a.libraryImageId as string, a.notes as string | undefined),
  },
  unmark_image_bad: {
    description: "Undo a bad flag on a library image (clears the marker and its notes).",
    schema: z.object({ libraryImageId: z.string() }),
    handler: (ctx, a) => unflagImageBad(ctx, a.libraryImageId as string),
  },
  create_folder: {
    description: "Create a library folder.",
    schema: z.object({ name: z.string(), parentFolderId: z.string().optional() }),
    handler: (ctx, a) => createFolder(ctx, a as any),
  },
  list_available_models: {
    description: "Registry ids, capabilities, cost — drives model selection.",
    schema: z.object({}),
    handler: async () => ({ models: listModels() }),
  },
  get_prompt_templates: {
    description: "Retrieve relevant best-practice templates BEFORE composing a prompt.",
    schema: z.object({ category: z.string().optional(), q: z.string().optional() }),
    handler: (ctx, a) => listTemplates(ctx, a as any),
  },
  promote_prompt: {
    description: "Promote a successful revision's prompt into a template.",
    schema: z.object({ revisionId: z.string(), title: z.string(), category: z.string() }),
    handler: (ctx, a) => promoteFromRevision(ctx, { ...(a as any), createdVia: "mcp" }),
  },
  grade_revision: {
    description: "Record a grade + failure mode + suggested prompt. Grade after a visibly poor result.",
    schema: z.object({
      revisionId: z.string(),
      grade: z.number().min(1).max(5),
      templateId: z.string().optional(),
      failureMode: z.string().optional(),
      notes: z.string().optional(),
      suggestedRevision: z.string().optional(),
    }),
    handler: (ctx, a) => gradeRevision(ctx, { ...(a as any), failureMode: a.failureMode as never, gradedBySurface: "mcp" }),
  },
  set_asset_ttl: {
    description: "Set/clear a video asset's TTL (null = never expires).",
    schema: z.object({ assetId: z.string(), ttlDays: z.number().nullable() }),
    handler: (ctx, a) => setAssetTtl(ctx, { assetId: a.assetId as string, ttlDays: a.ttlDays as number | null, surface: "mcp" }),
  },
  get_interaction_log: {
    description:
      "Recent MCP tool calls with their full request payloads and results/errors. Use this to review exactly what was tried in a session and reason about why an edit did not turn out as intended. Filter by sessionUuid.",
    schema: z.object({ sessionUuid: z.string().optional(), limit: z.number().optional() }),
    handler: (ctx, a) => listMcpLogs(ctx, a as any),
  },
};

interface RpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function result(id: RpcReq["id"], res: unknown, headers?: Record<string, string>) {
  return Response.json({ jsonrpc: "2.0", id, result: res }, headers ? { headers } : undefined);
}
function rpcError(id: RpcReq["id"], code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

/** Protocol versions we understand; echo the client's if supported. */
const SUPPORTED_PROTOCOLS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

/** Handle one MCP JSON-RPC request. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("MCP endpoint — POST JSON-RPC.", { status: 405 });
  }
  const host = new URL(request.url).host;
  let body: RpcReq;
  try {
    body = (await request.json()) as RpcReq;
  } catch (e) {
    console.error("[mcp] body parse failed (body consumed upstream?):", e instanceof Error ? e.message : String(e));
    return rpcError(null, -32700, "Parse error");
  }

  console.log(`[mcp] ${body.method} id=${String(body.id)}`);

  // Notifications (no id) — ack with 202, no body.
  if (body.id === undefined || body.id === null) {
    return new Response(null, { status: 202 });
  }

  try {
   switch (body.method) {
    case "initialize": {
      const requested = (body.params?.protocolVersion as string) ?? "";
      const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : "2025-06-18";
      // Some Streamable-HTTP clients key their session off this header.
      return result(
        body.id,
        {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "core-ai-tools", version: "1.0.0" },
        },
        { "Mcp-Session-Id": crypto.randomUUID() },
      );
    }

    case "ping":
      return result(body.id, {});

    case "tools/list":
      return result(body.id, {
        tools: Object.entries(TOOLS).map(([name, def]) => ({
          name,
          description: def.description,
          inputSchema: z.toJSONSchema(def.schema),
        })),
      });

    case "tools/call": {
      const name = body.params?.name as string;
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS[name];
      if (!tool) return rpcError(body.id, -32601, `Unknown tool: ${name}`);
      const ctx = createCoreContext(env);

      // Persist the request (tool + full payload) BEFORE running the handler, so
      // the prompt survives even a crash/timeout mid-edit. A logging failure must
      // never take down the tool, so we swallow it here (D1 being down would fail
      // the handler anyway).
      const log = await startMcpLog(ctx, { toolName: name, request: args }).catch((e) => {
        console.error("[mcp] log start failed:", e instanceof Error ? e.message : String(e));
        return null;
      });

      try {
        const parsed = tool.schema.parse(args);
        const out = await tool.handler(ctx, parsed as Record<string, unknown>, host);
        // raw tools return MCP content blocks directly (image bytes); everything
        // else returns JSON we wrap in a text block. Never log base64 bytes.
        const content = tool.raw ? (out as unknown[]) : [{ type: "text", text: JSON.stringify(out, null, 2) }];
        const logResponse = tool.raw
          ? { blocks: (out as Array<{ type?: string; mimeType?: string }>).map((b) => ({ type: b.type, mimeType: b.mimeType })) }
          : out;
        if (log)
          await finishMcpLog(ctx, { log, success: true, response: logResponse, revisionId: tool.raw ? undefined : sniffRevisionId(out) }).catch(
            (e) => console.error("[mcp] log finish failed:", e instanceof Error ? e.message : String(e)),
          );
        return result(body.id, { content });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (log)
          await finishMcpLog(ctx, { log, success: false, errorMessage: msg }).catch((e) =>
            console.error("[mcp] log finish failed:", e instanceof Error ? e.message : String(e)),
          );
        // Tool errors are returned as an MCP tool error result (isError), not a
        // protocol error, so the model can read + react to it.
        return result(body.id, { isError: true, content: [{ type: "text", text: msg }] });
      }
    }

    default:
      return rpcError(body.id, -32601, `Unknown method: ${body.method}`);
   }
  } catch (err) {
    // A protocol-level exception (not a tool error) — log it so a "connection
    // failed" in the client maps to a real cause here, and return -32603.
    console.error(`[mcp] method ${body.method} threw:`, err instanceof Error ? err.stack : String(err));
    return rpcError(body.id, -32603, err instanceof Error ? err.message : "Internal error");
  }
}
