/**
 * @fileoverview `/api/library` — folders (nested, with inheritable settings) +
 * images (metadata, short public id) + the direct-upload flow.
 *
 * Every handler is thin: parse → `createCoreContext(c.env)` → core → serialize.
 * Handlers THROW `CoreError`s; the root `errorHandler` maps them to statuses.
 *
 * Folder-settings semantics that the schema has to preserve: `null` CLEARS a
 * setting (so it inherits from an ancestor again) and an ABSENT key leaves it
 * alone. A `.partial()` schema that drops nulls would make un-setting impossible,
 * so each field is `.nullable().optional()` and `definedKeys` removes only the
 * keys that were genuinely absent.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  archiveFolder,
  backfillPublicIds,
  completeUpload,
  createCoreContext,
  createFolder,
  createUploadIntent,
  flagImageBad,
  listFolders,
  listLibrary,
  moveFolder,
  moveImage,
  registerImageFromSource,
  renameFolder,
  requireImageByPublicId,
  resolveSettings,
  restoreFolder,
  softDeleteImage,
  unflagImageBad,
  updateFolderSettings,
  updateImageMetadata,
} from "@/backend/core";
import { authMiddleware } from "@/backend/api/middleware/auth";

export const libraryRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const idParam = z.object({ id: z.string() });

libraryRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/library/images",
    tags: ["library"],
    request: { query: z.object({ folderId: z.string().optional(), limit: z.coerce.number().optional() }) },
    responses: ok,
  }),
  async (c) => {
    const q = c.req.valid("query");
    return c.json({ images: await listLibrary(createCoreContext(c.env), { folderId: q.folderId, limit: q.limit }) });
  },
);

/**
 * List folders. `parentFolderId` omitted lists EVERY folder (the whole nested
 * tree, flat — the UI builds the tree); `parentFolderId=null` lists roots only;
 * any other value lists that folder's direct children.
 */
libraryRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/library/folders",
    tags: ["library"],
    request: {
      query: z.object({
        parentFolderId: z.string().optional(),
        /** Archived folders are hidden unless asked for. `only` is the archive view. */
        archived: z.enum(["exclude", "include", "only"]).optional(),
      }),
    },
    responses: ok,
  }),
  async (c) => {
    const { parentFolderId: raw, archived } = c.req.valid("query");
    // A query string cannot carry a real null, so the literal "null" selects roots.
    const scope = {
      ...(raw === undefined ? {} : { parentFolderId: raw === "null" ? null : raw }),
      ...(archived ? { archived } : {}),
    };
    return c.json({ folders: await listFolders(createCoreContext(c.env), scope) });
  },
);

libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/folders",
    tags: ["library"],
    request: { body: jsonBody(z.object({ name: z.string(), parentFolderId: z.string().nullish() })) },
    responses: ok,
  }),
  async (c) => c.json(await createFolder(createCoreContext(c.env), c.req.valid("json"))),
);

libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/upload-intent",
    tags: ["library"],
    request: { body: jsonBody(z.object({ requireSignedURLs: z.boolean().optional() })) },
    responses: ok,
  }),
  async (c) => c.json(await createUploadIntent(createCoreContext(c.env), c.req.valid("json"))),
);

libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/complete-upload",
    tags: ["library"],
    request: {
      body: jsonBody(
        z.object({
          cfImageId: z.string(),
          folderId: z.string().nullish(),
          originalFilename: z.string().nullish(),
          contentType: z.string().nullish(),
          width: z.number().nullish(),
          height: z.number().nullish(),
          bytes: z.number().nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await completeUpload(createCoreContext(c.env), { ...c.req.valid("json"), uploadedVia: "api" })),
);

libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/images/{id}/move",
    tags: ["library"],
    request: { params: idParam, body: jsonBody(z.object({ folderId: z.string().nullable() })) },
    responses: ok,
  }),
  async (c) => c.json(await moveImage(createCoreContext(c.env), { imageId: c.req.valid("param").id, folderId: c.req.valid("json").folderId })),
);

libraryRouter.openapi(
  createRoute({ method: "delete", path: "/api/library/images/{id}", tags: ["library"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await softDeleteImage(createCoreContext(c.env), c.req.valid("param").id)),
);

// Register an image from a URL or base64 → a library id (reference on-ramp).
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/register",
    tags: ["library"],
    request: {
      body: jsonBody(
        z.object({
          cfImagesUrl: z.string().optional(),
          imageUrl: z.string().optional(),
          base64: z.string().optional(),
          description: z.string().nullish(),
          folderId: z.string().nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await registerImageFromSource(createCoreContext(c.env), { ...c.req.valid("json"), uploadedVia: "ui" })),
);

// Mark an image bad (with an optional reason) — ignored for editing, reversible.
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/images/{id}/flag-bad",
    tags: ["library"],
    request: { params: idParam, body: jsonBody(z.object({ notes: z.string().nullish() })) },
    responses: ok,
  }),
  async (c) => c.json(await flagImageBad(createCoreContext(c.env), c.req.valid("param").id, c.req.valid("json").notes)),
);

// Undo a bad flag.
libraryRouter.openapi(
  createRoute({ method: "post", path: "/api/library/images/{id}/unflag-bad", tags: ["library"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await unflagImageBad(createCoreContext(c.env), c.req.valid("param").id)),
);

// ---------------------------------------------------------------------------
// Folder tree: rename + move (nested; the cycle check lives in core)
// ---------------------------------------------------------------------------

/** Rename a folder in place. */
libraryRouter.openapi(
  createRoute({
    method: "patch",
    path: "/api/library/folders/{id}",
    tags: ["library"],
    request: { params: idParam, body: jsonBody(z.object({ name: z.string().min(1) })) },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await renameFolder(createCoreContext(c.env), {
        folderId: c.req.valid("param").id,
        name: c.req.valid("json").name,
      }),
    ),
);

/**
 * Re-parent a folder. `parentFolderId: null` moves it to the library root. A move
 * into the folder's own subtree is refused by `core#moveFolder` (400), which is
 * the single cycle check — this route adds none of its own.
 */
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/folders/{id}/move",
    tags: ["library"],
    request: { params: idParam, body: jsonBody(z.object({ parentFolderId: z.string().nullable() })) },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await moveFolder(createCoreContext(c.env), {
        folderId: c.req.valid("param").id,
        newParentId: c.req.valid("json").parentFolderId,
      }),
    ),
);

/**
 * Archive (retire) a folder. SOFT — the row survives because images and asset
 * lineage FK into it. The whole subtree goes down with it; images are untouched.
 * Semantics and the reasoning live in `core/library/folders.ts`.
 */
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/folders/{id}/archive",
    tags: ["library"],
    request: { params: idParam },
    responses: ok,
  }),
  async (c) => c.json(await archiveFolder(createCoreContext(c.env), c.req.valid("param").id)),
);

/**
 * Restore an archived folder and exactly the descendants the same archive took
 * down. 400 when its parent is still archived — core refuses rather than
 * re-homing the folder at the root.
 */
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/folders/{id}/restore",
    tags: ["library"],
    request: { params: idParam },
    responses: ok,
  }),
  async (c) => c.json(await restoreFolder(createCoreContext(c.env), c.req.valid("param").id)),
);

// ---------------------------------------------------------------------------
// Inheritable folder settings
// ---------------------------------------------------------------------------

/**
 * The writable settings body. Every field is `.nullable().optional()` — `null` is
 * a MEANINGFUL value here ("clear this, inherit again"), so it must survive
 * validation. Absence is what means "leave alone", and `definedKeys` below is the
 * only thing that distinguishes the two.
 */
export const folderSettingsBody = z.object({
  defaultPrompt: z.string().nullable().optional(),
  contextText: z.string().nullable().optional(),
  useCase: z.string().nullable().optional(),
  preferredModels: z.array(z.string()).nullable().optional(),
  approvalPolicy: z.enum(["auto", "masked_only", "always"]).nullable().optional(),
});

/**
 * Drop only the keys whose value is `undefined`, keeping `null`s.
 *
 * `updateFolderSettings` decides what to touch with `"key" in settings`, so a
 * validated object that materialises absent optional keys as `undefined` would
 * clear every setting the caller never mentioned. This makes that impossible
 * regardless of how the validator represents an absent key.
 *
 * @param obj A validated settings patch.
 * @returns The same object with `undefined`-valued keys removed.
 * @example definedKeys({ useCase: null, contextText: undefined }) // → { useCase: null }
 */
export function definedKeys<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Effective settings for a folder, each with the folder it was inherited from. */
libraryRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/library/folders/{id}/settings",
    tags: ["library"],
    request: { params: idParam },
    responses: ok,
  }),
  async (c) => c.json(await resolveSettings(createCoreContext(c.env), c.req.valid("param").id)),
);

/** Write a folder's own settings. `null` clears (re-inherits); absent leaves alone. */
libraryRouter.openapi(
  createRoute({
    method: "put",
    path: "/api/library/folders/{id}/settings",
    tags: ["library"],
    request: { params: idParam, body: jsonBody(folderSettingsBody) },
    responses: ok,
  }),
  async (c) => {
    const ctx = createCoreContext(c.env);
    const folderId = c.req.valid("param").id;
    await updateFolderSettings(ctx, folderId, definedKeys(c.req.valid("json")));
    // Return the RESOLVED view: the caller almost always wants to know what the
    // folder now inherits, which a bare row cannot tell them.
    return c.json(await resolveSettings(ctx, folderId));
  },
);

// ---------------------------------------------------------------------------
// Image metadata + the short public id
// ---------------------------------------------------------------------------

/** Edit an image's human metadata. `null` clears a field; absent leaves it alone. */
libraryRouter.openapi(
  createRoute({
    method: "patch",
    path: "/api/library/images/{id}",
    tags: ["library"],
    request: {
      params: idParam,
      body: jsonBody(
        z.object({
          title: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          usageInstructions: z.string().nullable().optional(),
          contextText: z.string().nullable().optional(),
          role: z.enum(["base", "reference", "inject"]).nullable().optional(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await updateImageMetadata(createCoreContext(c.env), {
        imageId: c.req.valid("param").id,
        ...definedKeys(c.req.valid("json")),
      }),
    ),
);

/** Resolve the short handle a user copied (`img_…`) to its image row. 404 on a typo. */
libraryRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/library/images/by-public-id/{publicId}",
    tags: ["library"],
    request: { params: z.object({ publicId: z.string() }) },
    responses: ok,
  }),
  async (c) => c.json(await requireImageByPublicId(createCoreContext(c.env), c.req.valid("param").publicId)),
);

/**
 * `POST /api/library/backfill-public-ids` — give a `public_id` to library rows
 * that predate the column (the column default only fires on INSERT, so rows
 * written before it exist have NULL). Idempotent: rows that already have one are
 * not touched, so re-running it is safe and eventually returns 0.
 *
 * Admin-gated for the same reason as `POST /api/models/sync`: it is a one-off
 * maintenance write over the whole table, not a feature API.
 */
libraryRouter.use("/api/library/backfill-public-ids", authMiddleware);
libraryRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/backfill-public-ids",
    tags: ["library"],
    // `limit` rides on the query so the call needs no body at all (`curl -X POST`).
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(5000).optional() }) },
    responses: ok,
  }),
  async (c) => c.json({ filled: await backfillPublicIds(createCoreContext(c.env), c.req.valid("query").limit) }),
);
