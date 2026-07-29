/**
 * @fileoverview `/api/library` — folders + images + direct-upload flow.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  completeUpload,
  createCoreContext,
  createFolder,
  createUploadIntent,
  listFolders,
  listLibrary,
  moveImage,
  softDeleteImage,
} from "@/backend/core";

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

libraryRouter.openapi(
  createRoute({ method: "get", path: "/api/library/folders", tags: ["library"], responses: ok }),
  async (c) => c.json({ folders: await listFolders(createCoreContext(c.env)) }),
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
