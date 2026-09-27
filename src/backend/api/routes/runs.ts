/**
 * @fileoverview `/api/runs` — the multi-model run engine (W2.5) over REST: fan
 * one intent out to several models, then read the comparison back.
 *
 * Thin by contract: parse → `createCoreContext(c.env)` → core → serialize.
 * Handlers THROW on error; the root `errorHandler` maps a `CoreError` to its
 * status + code. Registered with zod-openapi so the paths land in
 * `/openapi.json`.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { compareModels, createCoreContext, getModelRun, listModelRuns, MAX_RUN_MODELS } from "@/backend/core";

export const runsRouter = new OpenAPIHono<{ Bindings: Env }>();

const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });

const createBody = z.object({
  prompt: z.string().min(1),
  models: z.array(z.string().min(1)).min(1).max(MAX_RUN_MODELS),
  inputImageId: z.string().nullish(),
  maskId: z.string().nullish(),
  folderId: z.string().nullish(),
  contextText: z.string().nullish(),
});

runsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/runs",
    tags: ["runs"],
    summary: "Fan one intent out to several models and return every result.",
    request: { body: jsonBody(createBody) },
    responses: ok,
  }),
  async (c) => {
    const body = c.req.valid("json");
    // waitUntil keeps guardian usage emission off the response's critical path.
    return c.json(
      await compareModels(createCoreContext(c.env), {
        ...body,
        createdVia: "api",
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      }),
    );
  },
);

runsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/runs",
    tags: ["runs"],
    summary: "List runs newest-first, optionally scoped to a folder.",
    request: { query: z.object({ folderId: z.string().optional(), limit: z.coerce.number().optional() }) },
    responses: ok,
  }),
  async (c) => c.json({ runs: await listModelRuns(createCoreContext(c.env), c.req.valid("query")) }),
);

runsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/runs/{id}",
    tags: ["runs"],
    summary: "One run with every model's result, in requested-model order.",
    request: { params: z.object({ id: z.string() }) },
    responses: ok,
  }),
  async (c) => c.json(await getModelRun(createCoreContext(c.env), c.req.valid("param").id)),
);
