/**
 * @fileoverview `/api/sessions` — thin REST over the session core, registered
 * with zod-openapi (appears in /openapi.json). Handlers return 200 and THROW on
 * error; the global `onError` maps `CoreError` → HTTP status + code.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  archiveSession,
  createCoreContext,
  createSession,
  getSessionView,
  listSessions,
  listSessionsForImage,
} from "@/backend/core";

export const sessionsRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };

sessionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/sessions",
    tags: ["sessions"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              originLibraryImageId: z.string().max(64),
              title: z.string().max(200).nullish(),
              approvalPolicy: z.enum(["auto", "masked_only", "always"]).optional(),
              createdVia: z.enum(["ui", "api", "mcp"]).optional(),
              // Bounded at the trust boundary: a session's reference pool is small
              // (models take ≤14 refs); 50 is generous headroom, not a real limit.
              references: z
                .array(z.object({ imageId: z.string().max(64), role: z.enum(["object", "style"]) }))
                .max(50)
                .optional(),
              // Overrides are keyed by task_key (a handful) → small, bounded record.
              modelOverrides: z.record(z.string().max(64), z.string().max(256)).optional(),
            }),
          },
        },
      },
    },
    responses: ok,
  }),
  async (c) => c.json(await createSession(createCoreContext(c.env), c.req.valid("json"))),
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/sessions",
    tags: ["sessions"],
    request: {
      query: z.object({
        status: z.enum(["active", "archived"]).optional(),
        limit: z.coerce.number().optional(),
        offset: z.coerce.number().optional(),
        forImage: z.string().optional(),
      }),
    },
    responses: ok,
  }),
  async (c) => {
    const q = c.req.valid("query");
    const ctx = createCoreContext(c.env);
    const sessions = q.forImage
      ? await listSessionsForImage(ctx, q.forImage)
      : await listSessions(ctx, { status: q.status, limit: q.limit, offset: q.offset });
    return c.json({ sessions });
  },
);

sessionsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/sessions/{uuid}",
    tags: ["sessions"],
    request: { params: z.object({ uuid: z.string() }) },
    responses: ok,
  }),
  async (c) => c.json(await getSessionView(createCoreContext(c.env), c.req.valid("param").uuid)),
);

sessionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/sessions/{uuid}/archive",
    tags: ["sessions"],
    request: { params: z.object({ uuid: z.string() }) },
    responses: ok,
  }),
  async (c) => c.json(await archiveSession(createCoreContext(c.env), c.req.valid("param").uuid)),
);
