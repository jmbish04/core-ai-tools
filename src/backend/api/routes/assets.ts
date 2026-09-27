/**
 * @fileoverview `/api/assets` — the curated asset library: images the user
 * returns to (a material, a fixture, a product shot) plus every iteration each
 * one ever produced.
 *
 * Thin surface over `core/assets`: parse → `createCoreContext(c.env)` → core →
 * serialize. Handlers THROW `CoreError`s and the root `errorHandler` maps them
 * (NotFound → 404, Conflict → 409, Validation → 400), so nothing here inspects
 * or rewrites an error.
 *
 * `POST /api/library/images/{id}/promote` lives here rather than in
 * `routes/library.ts` because it is an ASSET operation that happens to start
 * from a library path — keeping it beside `createAsset` keeps the two ways an
 * asset comes into being in one file.
 *
 * Archive is a soft state (`archived_at`), never a delete: `asset_lineage`
 * references assets with ON DELETE RESTRICT and the iterations they produced are
 * history.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { definedKeys } from "./library";
import {
  archiveAsset,
  createAsset,
  createCoreContext,
  listAssetIterations,
  listAssets,
  promoteImageToAsset,
  requireAsset,
  restoreAsset,
  updateAsset,
} from "@/backend/core";

export const assetsRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const idParam = z.object({ id: z.string() });

/**
 * Human metadata carried by an asset. `null` CLEARS a field and an absent key
 * leaves it alone — `core#updateAsset` decides with `"key" in input`, so the
 * fields are `.nullable().optional()` and undefined keys are stripped at the
 * handler with the shared `definedKeys` (see its docstring in `routes/library.ts`).
 */
const metadataFields = {
  description: z.string().nullable().optional(),
  usageInstructions: z.string().nullable().optional(),
  contextText: z.string().nullable().optional(),
};

/** Wrap an already-registered library image as an asset. 409 if it already is one. */
assetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/assets",
    tags: ["assets"],
    request: {
      body: jsonBody(
        z.object({
          libraryImageId: z.string(),
          name: z.string().nullable().optional(),
          ...metadataFields,
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await createAsset(createCoreContext(c.env), c.req.valid("json"))),
);

/**
 * Promote an existing library image into an asset: the image row is COPIED (same
 * Cloudflare Images object, new row, fresh public id) and the asset records
 * `promoted_from_image_id`. Returns `{ asset, libraryImage }`.
 */
assetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/library/images/{id}/promote",
    tags: ["assets"],
    request: {
      params: idParam,
      body: jsonBody(
        z.object({
          name: z.string().nullable().optional(),
          folderId: z.string().nullable().optional(),
          ...metadataFields,
        }),
      ),
    },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await promoteImageToAsset(createCoreContext(c.env), {
        imageId: c.req.valid("param").id,
        ...definedKeys(c.req.valid("json")),
      }),
    ),
);

/** List assets, newest first. Archived ones are excluded unless asked for. */
assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/assets",
    tags: ["assets"],
    request: {
      query: z.object({
        includeArchived: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
    },
    responses: ok,
  }),
  async (c) => c.json({ assets: await listAssets(createCoreContext(c.env), c.req.valid("query")) }),
);

/** One asset. Archived assets are hidden unless `includeArchived=true`. */
assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/assets/{id}",
    tags: ["assets"],
    request: { params: idParam, query: z.object({ includeArchived: z.coerce.boolean().optional() }) },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await requireAsset(createCoreContext(c.env), c.req.valid("param").id, {
        includeArchived: c.req.valid("query").includeArchived,
      }),
    ),
);

/** Rename an asset and/or edit its metadata. `null` clears a metadata field. */
assetsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/api/assets/{id}",
    tags: ["assets"],
    request: {
      params: idParam,
      body: jsonBody(z.object({ name: z.string().optional(), ...metadataFields })),
    },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await updateAsset(createCoreContext(c.env), {
        assetId: c.req.valid("param").id,
        ...definedKeys(c.req.valid("json")),
      }),
    ),
);

/** Archive an asset (soft, idempotent). Its iterations stay in history. */
assetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/assets/{id}/archive",
    tags: ["assets"],
    request: { params: idParam },
    responses: ok,
  }),
  async (c) => c.json(await archiveAsset(createCoreContext(c.env), c.req.valid("param").id)),
);

/** Un-archive an asset (idempotent). */
assetsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/assets/{id}/restore",
    tags: ["assets"],
    request: { params: idParam },
    responses: ok,
  }),
  async (c) => c.json(await restoreAsset(createCoreContext(c.env), c.req.valid("param").id)),
);

/**
 * Every iteration an asset produced, oldest first — the FLAT rows. Grouping (by
 * folder, by session) is deliberately the UI's job: the order within any grouping
 * is already the timeline order, so a client groups without re-sorting.
 */
assetsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/assets/{id}/iterations",
    tags: ["assets"],
    request: {
      params: idParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(1000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
    },
    responses: ok,
  }),
  async (c) => {
    const ctx = createCoreContext(c.env);
    const assetId = c.req.valid("param").id;
    // requireAsset first so an unknown id is a 404 rather than an empty timeline
    // (an absence must never read as "this asset produced nothing").
    await requireAsset(ctx, assetId, { includeArchived: true });
    return c.json({ iterations: await listAssetIterations(ctx, assetId, c.req.valid("query")) });
  },
);
