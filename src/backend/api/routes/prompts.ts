/**
 * @fileoverview `/api/prompts` — prompt library CRUD, grading, promotion.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  createCoreContext,
  createTemplate,
  gradeRevision,
  listTemplates,
  promoteFromRevision,
  softDeleteTemplate,
  useTemplate,
} from "@/backend/core";

export const promptsRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const idParam = z.object({ id: z.string() });

promptsRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/prompts",
    tags: ["prompts"],
    request: { query: z.object({ category: z.string().optional(), q: z.string().optional() }) },
    responses: ok,
  }),
  async (c) => c.json({ templates: await listTemplates(createCoreContext(c.env), c.req.valid("query")) }),
);

promptsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/prompts",
    tags: ["prompts"],
    request: {
      body: jsonBody(
        z.object({
          title: z.string(),
          category: z.string(),
          templateBody: z.string(),
          examplePrompt: z.string().nullish(),
          recommendedModel: z.string().nullish(),
          recommendedSettings: z.record(z.string(), z.any()).nullish(),
          techniqueTags: z.array(z.string()).nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => c.json(await createTemplate(createCoreContext(c.env), { ...c.req.valid("json"), createdVia: "api" })),
);

promptsRouter.openapi(
  createRoute({ method: "post", path: "/api/prompts/{id}/use", tags: ["prompts"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await useTemplate(createCoreContext(c.env), c.req.valid("param").id)),
);

promptsRouter.openapi(
  createRoute({ method: "delete", path: "/api/prompts/{id}", tags: ["prompts"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await softDeleteTemplate(createCoreContext(c.env), c.req.valid("param").id)),
);

promptsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/prompts/promote",
    tags: ["prompts"],
    request: { body: jsonBody(z.object({ revisionId: z.string(), title: z.string(), category: z.string() })) },
    responses: ok,
  }),
  async (c) => c.json(await promoteFromRevision(createCoreContext(c.env), { ...c.req.valid("json"), createdVia: "api" })),
);

promptsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/prompts/grade",
    tags: ["prompts"],
    request: {
      body: jsonBody(
        z.object({
          revisionId: z.string(),
          grade: z.number().min(1).max(5),
          templateId: z.string().nullish(),
          failureMode: z.string().nullish(),
          notes: z.string().nullish(),
          suggestedRevision: z.string().nullish(),
        }),
      ),
    },
    responses: ok,
  }),
  async (c) => {
    const b = c.req.valid("json");
    return c.json(await gradeRevision(createCoreContext(c.env), { ...b, failureMode: b.failureMode as never, gradedBySurface: "api" }));
  },
);
