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
  archiveAsset,
  restoreAsset,
  cancelRevision,
  compareModels,
  createAsset,
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
  getModelRun,
  listModelRuns,
  MAX_RUN_MODELS,
  listAssetIterations,
  listAssets,
  listFolders,
  listLibrary,
  listMasks,
  listMcpLogs,
  listSessions,
  listSessionsForImage,
  listTemplates,
  moveFolder,
  promoteImageToAsset,
  requireImageByPublicId,
  resolveSettings,
  sniffRevisionId,
  startMcpLog,
  pinRevision,
  promoteFromRevision,
  rejectRevision,
  retryRevision,
  setAssetTtl,
  softDeleteMask,
  submitEdit,
  updateAsset,
  updateFolderSettings,
  updateImageMetadata,
  getSessionTree,
} from "@/backend/core";
import type { CoreContext, ModelRunWithResults } from "@/backend/core";
import { listModels } from "@/backend/ai/registry";
import { buildMcpEditPayload } from "./payload";
import { EXECUTE_CONVENTION, isValidSandboxNonce, runScript } from "./codemode";
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

/** Public host used to build deep links for a sandbox-originated tool call (which
 *  has no inbound Request of its own to read the host from). */
const MCP_PUBLIC_HOST = "core-ai-tools.hacolby.workers.dev";

const SESSION_NOTE = "Session-scoped; results appear in the web UI in realtime.";

interface ToolDef {
  description: string;
  schema: z.ZodTypeAny;
  handler: (ctx: CoreContext, args: Record<string, unknown>, host: string) => Promise<unknown>;
  /** Handler returns MCP content blocks directly (e.g. image blocks) — not JSON. */
  raw?: boolean;
}

/**
 * Drop keys whose value is `undefined`, KEEPING nulls.
 *
 * The metadata/settings core functions decide what to touch with `"key" in input`,
 * and `null` is a meaningful value there ("clear this, inherit/derive again"). A
 * validated args object that materialises an absent optional key as `undefined`
 * would therefore clear fields the caller never mentioned.
 */
function definedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
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

/**
 * Serialize one multi-model run into the §4.2 compact payload: no inline bytes,
 * every output reachable by URL, and each model's EXACT prompt kept alongside
 * its result so the comparison is readable.
 */
async function runPayload(ctx: CoreContext, r: ModelRunWithResults, host: string) {
  const urls = await resolveImageUrls(ctx, r.results.map((x) => x.outputImageId), `https://${host}`);
  return {
    run_id: r.run.id,
    status: r.status,
    prompt: r.run.prompt,
    input_image_id: r.run.inputImageId,
    mask_id: r.run.maskId,
    folder_id: r.run.folderId,
    app_url: `https://${host}/runs/${r.run.id}`,
    results: r.results.map((x) => ({
      requested_model: x.requestedModel,
      served_model: x.servedModel,
      status: x.status,
      prompt_sent: x.promptSent,
      mask_sent_in_band: x.maskSent,
      image_id: x.outputImageId,
      image_url: x.outputImageId ? (urls.get(x.outputImageId)?.imageUrl ?? null) : null,
      thumb_url: x.outputImageId ? (urls.get(x.outputImageId)?.thumbUrl ?? null) : null,
      latency_ms: x.latencyMs,
      cost_usd: x.costUsd,
      tokens: { in: x.tokensIn, out: x.tokensOut, thinking: x.tokensThinking },
      error_code: x.errorCode,
      error_message: x.errorMessage,
    })),
  };
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
    description:
      "Create a library folder. Pass parentFolderId to nest it inside another folder (folders nest to any depth); omit it for a root folder. A child folder inherits its ancestors' settings — see get_folder_settings.",
    schema: z.object({ name: z.string(), parentFolderId: z.string().nullish() }),
    handler: (ctx, a) => createFolder(ctx, a as any),
  },
  list_folders: {
    description:
      "List library folders (they nest to any depth). Omit parentFolderId for EVERY folder (flat — build the tree from parentFolderId); pass null for root folders only; pass an id for that folder's direct children.",
    schema: z.object({ parentFolderId: z.string().nullish() }),
    handler: (ctx, a) =>
      listFolders(ctx, "parentFolderId" in definedKeys(a) ? { parentFolderId: a.parentFolderId as string | null } : undefined),
  },
  move_folder: {
    description:
      "Re-parent a folder (parentFolderId null = move to the library root). Refused if the target is the folder itself or one of its own descendants (that would make a cycle).",
    schema: z.object({ folderId: z.string(), parentFolderId: z.string().nullable() }),
    handler: (ctx, a) =>
      moveFolder(ctx, { folderId: a.folderId as string, newParentId: a.parentFolderId as string | null }),
  },
  get_folder_settings: {
    description:
      "Effective settings for a folder (defaultPrompt, contextText, useCase, preferredModels, approvalPolicy). Each comes back as { value, fromFolderId, inherited } so you can tell a value set HERE from one inherited from an ancestor, plus ancestorPath (folder first, root last). Read this before composing a prompt for an image in that folder — contextText and defaultPrompt are standing instructions from the user.",
    schema: z.object({ folderId: z.string() }),
    handler: (ctx, a) => resolveSettings(ctx, a.folderId as string),
  },
  set_folder_settings: {
    description:
      "Write a folder's own settings. Send null for a setting to CLEAR it, which makes the folder inherit that setting from its nearest ancestor again; omit a key to leave it untouched. Returns the resolved (post-write) view. preferredModels is advisory — task_model_defaults stays authoritative for model resolution.",
    schema: z.object({
      folderId: z.string(),
      defaultPrompt: z.string().nullish(),
      contextText: z.string().nullish(),
      useCase: z.string().nullish(),
      preferredModels: z.array(z.string()).nullish(),
      approvalPolicy: z.enum(["auto", "masked_only", "always"]).nullish(),
    }),
    handler: async (ctx, a) => {
      const { folderId, ...rest } = a as { folderId: string } & Record<string, unknown>;
      await updateFolderSettings(ctx, folderId, definedKeys(rest));
      return resolveSettings(ctx, folderId);
    },
  },
  update_image_metadata: {
    description:
      "Edit a library image's human metadata: title, description, usageInstructions (how it should be used in an edit), contextText (standing context about it), role (base|reference|inject). Send null to clear a field; omit a key to leave it alone. Returns the updated row with its urls and public_id.",
    schema: z.object({
      libraryImageId: z.string(),
      title: z.string().nullish(),
      description: z.string().nullish(),
      usageInstructions: z.string().nullish(),
      contextText: z.string().nullish(),
      role: z.enum(["base", "reference", "inject"]).nullish(),
    }),
    handler: async (ctx, a, host) => {
      const { libraryImageId, ...rest } = a as { libraryImageId: string } & Record<string, unknown>;
      const row = await updateImageMetadata(ctx, { imageId: libraryImageId, ...definedKeys(rest) });
      return (await serializeLibrary(ctx, [row], `https://${host}`))[0];
    },
  },
  get_image_by_public_id: {
    description:
      "Resolve the short handle a user copied out of the UI (`img_…`) to its library image, with urls. Use this whenever the user pastes an id instead of naming an image. Errors (never returns empty) if no live image carries that id.",
    schema: z.object({ publicId: z.string() }),
    handler: async (ctx, a, host) =>
      (await serializeLibrary(ctx, [await requireImageByPublicId(ctx, a.publicId as string)], `https://${host}`))[0],
  },
  create_asset: {
    description:
      "Make an already-registered library image an ASSET — a thing the user returns to (a material, a fixture, a product shot) whose every iteration is tracked. Errors if that image is already an asset (the existing asset id is in the message).",
    schema: z.object({
      libraryImageId: z.string(),
      name: z.string().optional(),
      description: z.string().nullish(),
      usageInstructions: z.string().nullish(),
      contextText: z.string().nullish(),
    }),
    handler: (ctx, a) => createAsset(ctx, { ...(definedKeys(a) as any) }),
  },
  promote_image_to_asset: {
    description:
      "Promote an EXISTING library image into an asset. The image row is copied (same pixels, new row, fresh public_id) and the asset records what it was promoted from, so the original stays untouched in its folder. Returns { asset, libraryImage } — the copy is the asset's backing image.",
    schema: z.object({
      imageId: z.string(),
      name: z.string().optional(),
      folderId: z.string().nullish(),
      description: z.string().nullish(),
      usageInstructions: z.string().nullish(),
      contextText: z.string().nullish(),
    }),
    handler: (ctx, a) => promoteImageToAsset(ctx, { ...(definedKeys(a) as any) }),
  },
  list_assets: {
    description: "List assets, newest first. Archived assets are excluded unless includeArchived is true.",
    schema: z.object({
      includeArchived: z.boolean().optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    }),
    handler: async (ctx, a) => ({ assets: await listAssets(ctx, a as any) }),
  },
  list_asset_iterations: {
    description:
      "Every image this asset ever produced, oldest first — the flat timeline. Each row carries the produced image (id, public_id, delivery url), the folder it landed in, and the session/revision that made it. Group by folderId or sessionUuid yourself; the rows are already in timeline order.",
    schema: z.object({ assetId: z.string(), limit: z.number().int().optional(), offset: z.number().int().optional() }),
    handler: async (ctx, a) => ({
      iterations: await listAssetIterations(ctx, a.assetId as string, a as any),
    }),
  },
  update_asset: {
    description:
      "Rename an asset and/or edit its metadata (description, usageInstructions, contextText). Send null to clear a metadata field; omit a key to leave it alone.",
    schema: z.object({
      assetId: z.string(),
      name: z.string().optional(),
      description: z.string().nullish(),
      usageInstructions: z.string().nullish(),
      contextText: z.string().nullish(),
    }),
    handler: (ctx, a) => updateAsset(ctx, { ...(definedKeys(a) as any) }),
  },
  archive_asset: {
    description:
      "Archive an asset so it drops out of the default list. Idempotent, and never a delete — the iterations it produced stay in history.",
    schema: z.object({ assetId: z.string() }),
    handler: (ctx, a) => archiveAsset(ctx, a.assetId as string),
  },
  restore_asset: {
    description: "Undo an archive — the asset returns to the default list. Idempotent.",
    schema: z.object({ assetId: z.string() }),
    handler: (ctx, a) => restoreAsset(ctx, a.assetId as string),
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
  compare_models: {
    description:
      `Run ONE intent against several models at once and compare the outputs side by side. ` +
      `Give inputImageId to compare edits of an existing image (optionally maskId to confine them), or omit it to ` +
      `compare prompt-only generation. Up to ${MAX_RUN_MODELS} models; they run concurrently. ` +
      `The prompt is REWRITTEN PER PROVIDER before dispatch (a native mask channel gets a short literal instruction; ` +
      `a model without one gets the region described in words) and each result carries the exact prompt_sent. ` +
      `One model failing does not fail the run — its result row carries the error and the others still return. ` +
      `Every output is registered as a library image in folderId, so it shows up in the folder tree. ` +
      `Call list_available_models first to pick ids. ${SESSION_NOTE}`,
    schema: z.object({
      prompt: z.string().min(1),
      models: z.array(z.string().min(1)).min(1).max(MAX_RUN_MODELS),
      inputImageId: z.string().optional(),
      maskId: z.string().optional(),
      folderId: z.string().optional(),
      contextText: z.string().optional(),
    }),
    handler: async (ctx, a, host) =>
      runPayload(ctx, await compareModels(ctx, { ...(a as any), createdVia: "mcp" }), host),
  },
  get_model_run: {
    description:
      "One multi-model run with every model's result: the exact prompt each model was sent, its output image URLs, latency, cost, tokens, and any error.",
    schema: z.object({ runId: z.string() }),
    handler: async (ctx, a, host) => runPayload(ctx, await getModelRun(ctx, a.runId as string), host),
  },
  list_model_runs: {
    description: "Recent multi-model runs, newest first. Filter by folderId.",
    schema: z.object({ folderId: z.string().optional(), limit: z.number().optional() }),
    handler: async (ctx, a, host) => {
      const runs = await listModelRuns(ctx, a as any);
      return { runs: await Promise.all(runs.map((r) => runPayload(ctx, r, host))) };
    },
  },
};

/** First sentence of a description — the summary `search` returns. */
function summarize(description: string): string {
  const cut = description.indexOf(". ");
  return (cut === -1 ? description : description.slice(0, cut + 1)).trim();
}

/**
 * Code-mode surface (see ./codemode.ts for why). These three are what `tools/list`
 * advertises; all 30 named tools stay dispatchable by name, through `tools/call`
 * directly (back-compat for a client holding a cached list) and through
 * `call_tool` inside `execute`.
 */
const CODE_MODE_TOOLS: Record<string, ToolDef> = {
  search: {
    description:
      "Find the tool for a job. Returns { name, summary } for every tool matching the query (omit the query to list all). Call get_schema for a tool's parameters, then execute to run it.",
    schema: z.object({ query: z.string().optional() }),
    handler: async (_ctx, a) => {
      const q = String(a.query ?? "").toLowerCase();
      const names = Object.keys(ALL_TOOLS).filter(
        (n) => !q || n.includes(q) || ALL_TOOLS[n].description.toLowerCase().includes(q),
      );
      return { tools: names.map((n) => ({ name: n, summary: summarize(ALL_TOOLS[n].description) })) };
    },
  },
  get_schema: {
    description: "Full description + JSON Schema for the named tools. Fetch only the ones you are about to call.",
    schema: z.object({ names: z.array(z.string()).min(1) }),
    handler: async (_ctx, a) => ({
      tools: (a.names as string[]).map((n) => {
        const t = ALL_TOOLS[n];
        if (!t) return { name: n, error: "unknown tool" };
        return { name: n, description: t.description, inputSchema: z.toJSONSchema(t.schema) };
      }),
    }),
  },
  execute: {
    description: `Run several tools in one call. ${EXECUTE_CONVENTION}`,
    schema: z.object({ code: z.string().min(1) }),
    handler: async (ctx, a) => {
      const out = await runScript(ctx.env, a.code as string);
      if (!out.ok) throw new Error(out.error ?? "script failed");
      return out.value;
    },
  },
};

/** Every dispatchable tool: the domain tools plus the code-mode trio. */
const ALL_TOOLS: Record<string, ToolDef> = { ...TOOLS, ...CODE_MODE_TOOLS };

/**
 * Dispatch one tool by name: validate, log the request to `mcp_logs` BEFORE
 * running (so a prompt survives a crash mid-edit), run, log the outcome.
 *
 * @returns MCP `tools/call` result content, or an `isError` result the model can read.
 */
export async function callToolByName(
  ctx: CoreContext,
  name: string,
  args: Record<string, unknown>,
  host: string,
): Promise<{ content: unknown[]; isError?: true }> {
  const tool = ALL_TOOLS[name];
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };

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
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (log)
      await finishMcpLog(ctx, { log, success: false, errorMessage: msg }).catch((e) =>
        console.error("[mcp] log finish failed:", e instanceof Error ? e.message : String(e)),
      );
    // Tool errors are returned as an MCP tool error result (isError), not a
    // protocol error, so the model can read + react to it.
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}

/**
 * `POST /internal/mcp-tool` — the ONLY channel a code-mode sandbox has to the
 * tools. Reached over this Worker's `SELF` service binding, authorised by the
 * per-execution nonce (never the real API key). Body: `{ name, args }`.
 *
 * @returns `{ result }` with the tool's JSON, or `{ error }` (HTTP 4xx/200) —
 *   the sandbox prelude turns a non-ok response into a thrown `call_tool` error.
 */
export async function handleInternalToolCall(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  if (!(await isValidSandboxNonce(env, request.headers.get("x-sandbox-nonce")))) {
    return Response.json({ error: "invalid or expired sandbox nonce" }, { status: 401 });
  }
  let body: { name?: string; args?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });

  const ctx = createCoreContext(env);
  const host = MCP_PUBLIC_HOST;
  const out = await callToolByName(ctx, body.name, body.args ?? {}, host);
  if (out.isError) {
    const text = (out.content[0] as { text?: string } | undefined)?.text ?? "tool failed";
    return Response.json({ error: text }, { status: 400 });
  }
  // Give the script the tool's VALUE, not MCP content blocks — a script wants data.
  const first = out.content[0] as { type?: string; text?: string } | undefined;
  if (first?.type === "text" && typeof first.text === "string") {
    try {
      return Response.json({ result: JSON.parse(first.text) });
    } catch {
      return Response.json({ result: first.text });
    }
  }
  // Image/raw tools: hand back the blocks minus any base64 payload (a script
  // should pass URLs around, not megabytes of pixels).
  return Response.json({
    result: out.content.map((b) => {
      const blk = b as Record<string, unknown>;
      return blk.type === "image" ? { type: "image", mimeType: blk.mimeType, omitted: "base64 bytes" } : blk;
    }),
  });
}

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

    case "tools/list": {
      // Code mode by default (3 tools, ~10x cheaper per session than advertising
      // all 30). `?mode=named` on the /mcp URL restores the full named surface for
      // a client that wants it; every name stays callable either way.
      const advertised = new URL(request.url).searchParams.get("mode") === "named" ? ALL_TOOLS : CODE_MODE_TOOLS;
      return result(body.id, {
        tools: Object.entries(advertised).map(([name, def]) => ({
          name,
          description: def.description,
          inputSchema: z.toJSONSchema(def.schema),
        })),
      });
    }

    case "tools/call": {
      const name = body.params?.name as string;
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      return result(body.id, await callToolByName(createCoreContext(env), name, args, host));
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
