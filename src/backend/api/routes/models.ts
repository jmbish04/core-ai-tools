/**
 * @fileoverview `/api/models` — registry + authoritative task->model mapping.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { getDb } from "@/backend/db";
import { taskModelDefaults } from "@/backend/db/schema";
import { listModels, validateTaskDefaults } from "@/backend/ai/registry";

export const modelsRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };

modelsRouter.openapi(
  createRoute({ method: "get", path: "/api/models", tags: ["models"], responses: ok }),
  (c) => c.json({ models: listModels() }),
);

modelsRouter.openapi(
  createRoute({ method: "get", path: "/api/models/tasks", tags: ["models"], responses: ok }),
  async (c) => {
    const db = getDb(c.env);
    return c.json({ defaults: await db.select().from(taskModelDefaults), broken: await validateTaskDefaults(db) });
  },
);

modelsRouter.openapi(
  createRoute({
    method: "put",
    path: "/api/models/tasks/{taskKey}",
    tags: ["models"],
    request: {
      params: z.object({ taskKey: z.string() }),
      body: { content: { "application/json": { schema: z.object({ modelId: z.string(), enabled: z.boolean().optional(), surface: z.enum(["ui", "api", "mcp"]).default("api") }) } } },
    },
    responses: ok,
  }),
  async (c) => {
    const taskKey = c.req.valid("param").taskKey;
    const b = c.req.valid("json");
    const db = getDb(c.env);
    await db
      .insert(taskModelDefaults)
      .values({ taskKey, modelId: b.modelId, enabled: b.enabled ?? true, updatedBySurface: b.surface })
      .onConflictDoUpdate({
        target: taskModelDefaults.taskKey,
        set: { modelId: b.modelId, enabled: b.enabled ?? true, updatedBySurface: b.surface, updatedAt: new Date() },
      });
    const [row] = await db.select().from(taskModelDefaults).where(eq(taskModelDefaults.taskKey, taskKey));
    return c.json(row);
  },
);
