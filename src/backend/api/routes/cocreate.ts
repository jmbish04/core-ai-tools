/**
 * @fileoverview `/api/cocreate` — the prompt co-creator and its consultant.
 * Thin: parse → `createCoreContext(c.env)` → core → serialize. Errors are thrown
 * and mapped by the root error handler (CoreError → status + code).
 *
 * Gated (session cookie or Bearer WORKER_API_KEY) by the product auth loop in
 * `api/index.ts` — prompts and answers are user data.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  addPromptVersion,
  analyzeCocreateSession,
  answerQuestions,
  consult,
  createCocreateSession,
  createCoreContext,
  generateForCocreateSession,
  getCocreateSession,
  importAnswers,
  listConsultations,
  listCocreateSessions,
  proposeRefinement,
  updateCocreateSession,
} from "@/backend/core";

export const cocreateRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const idParam = z.object({ id: z.string().max(64) });
const tags = ["cocreate"];

const proactiveness = z.enum(["low", "medium", "high"]);
const graphUpdate = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attribute"), entity: z.string().max(200), attribute: z.string().max(200), value: z.string().max(500) }),
  z.object({
    type: z.literal("relationship"),
    source: z.string().max(200),
    target: z.string().max(200),
    oldLabel: z.string().max(200),
    newLabel: z.string().max(200),
  }),
]);
const ids = z.array(z.string().max(64)).max(50);

/** `waitUntil` for non-blocking usage emission inside dispatch. */
const wait = (c: { executionCtx: ExecutionContext }) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

cocreateRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/cocreate/sessions",
    tags,
    request: { query: z.object({ includeArchived: z.coerce.boolean().optional() }) },
    responses: ok,
  }),
  async (c) => c.json({ sessions: await listCocreateSessions(createCoreContext(c.env), c.req.valid("query")) }),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions",
    tags,
    request: {
      body: jsonBody(
        z.object({
          prompt: z.string().min(1).max(8000),
          title: z.string().max(200).nullish(),
          goal: z.string().max(4000).nullish(),
          proactiveness: proactiveness.optional(),
          aspectRatio: z.string().max(10).optional(),
          imageModel: z.string().max(128).nullish(),
          referenceImageId: z.string().max(64).nullish(),
          folderId: z.string().max(64).nullish(),
          importAnswerIds: ids.optional(),
          consultationId: z.string().max(64).nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await createCocreateSession(createCoreContext(c.env), c.req.valid("json"))),
);

cocreateRouter.openapi(
  createRoute({ method: "get", path: "/api/cocreate/sessions/{id}", tags, request: { params: idParam }, responses: ok }),
  async (c) => c.json(await getCocreateSession(createCoreContext(c.env), c.req.valid("param").id)),
);

cocreateRouter.openapi(
  createRoute({
    method: "patch",
    path: "/api/cocreate/sessions/{id}",
    tags,
    request: {
      params: idParam,
      body: jsonBody(
        z.object({
          title: z.string().min(1).max(200).optional(),
          goal: z.string().max(4000).nullable().optional(),
          proactiveness: proactiveness.optional(),
          aspectRatio: z.string().max(10).optional(),
          imageModel: z.string().max(128).nullable().optional(),
          referenceImageId: z.string().max(64).nullable().optional(),
          folderId: z.string().max(64).nullable().optional(),
          archived: z.boolean().optional(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await updateCocreateSession(createCoreContext(c.env), c.req.valid("param").id, c.req.valid("json"))),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/analyze",
    tags,
    request: { params: idParam, body: jsonBody(z.object({ graph: z.boolean().optional() })) },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await analyzeCocreateSession(createCoreContext(c.env), c.req.valid("param").id, {
        graph: c.req.valid("json").graph,
        waitUntil: wait(c),
      }),
    ),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/answers",
    tags,
    request: {
      params: idParam,
      body: jsonBody(z.object({ answers: z.array(z.object({ id: z.string().max(64), answer: z.string().max(2000).nullable() })).max(50) })),
    },
    responses: ok,
  }),
  async (c) =>
    c.json({ answers: await answerQuestions(createCoreContext(c.env), c.req.valid("param").id, c.req.valid("json").answers) }),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/refine",
    tags,
    request: { params: idParam, body: jsonBody(z.object({ answerIds: ids.optional(), graphUpdates: z.array(graphUpdate).max(100).optional() })) },
    responses: ok,
  }),
  async (c) =>
    c.json(await proposeRefinement(createCoreContext(c.env), c.req.valid("param").id, { ...c.req.valid("json"), waitUntil: wait(c) })),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/versions",
    tags,
    request: {
      params: idParam,
      body: jsonBody(
        z.object({
          promptText: z.string().min(1).max(8000),
          source: z.enum(["manual", "refine", "consultant", "restore"]),
          parentVersionId: z.string().max(64).nullish(),
          answerIds: ids.optional(),
          graphUpdates: z.array(graphUpdate).max(100).optional(),
          note: z.string().max(2000).nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await addPromptVersion(createCoreContext(c.env), c.req.valid("param").id, c.req.valid("json"))),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/generate",
    tags,
    request: {
      params: idParam,
      body: jsonBody(z.object({ versionId: z.string().max(64).optional(), count: z.number().int().min(1).max(8).optional() })),
    },
    responses: ok,
  }),
  async (c) =>
    c.json(
      await generateForCocreateSession(createCoreContext(c.env), c.req.valid("param").id, {
        ...c.req.valid("json"),
        waitUntil: wait(c),
      }),
    ),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/sessions/{id}/import-answers",
    tags,
    request: { params: idParam, body: jsonBody(z.object({ answerIds: ids.min(1) })) },
    responses: ok,
  }),
  async (c) =>
    c.json({ answers: await importAnswers(createCoreContext(c.env), c.req.valid("param").id, c.req.valid("json").answerIds) }),
);

cocreateRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/cocreate/consultations",
    tags,
    request: { query: z.object({ sessionId: z.string().max(64).optional() }) },
    responses: ok,
  }),
  async (c) =>
    c.json({ consultations: await listConsultations(createCoreContext(c.env), c.req.valid("query").sessionId ?? null) }),
);

cocreateRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/cocreate/consult",
    tags,
    request: { body: jsonBody(z.object({ goal: z.string().min(1).max(4000), sessionId: z.string().max(64).nullish() })) },
    responses: ok,
  }),
  async (c) => c.json(await consult(createCoreContext(c.env), { ...c.req.valid("json"), waitUntil: wait(c) })),
);
