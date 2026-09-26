/**
 * @fileoverview `/api/models` — registry + authoritative task->model mapping.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";

import { getDb } from "@/backend/db";
import { modelCatalog, taskModelDefaults } from "@/backend/db/schema";
import { listModels, requireModel, seedRegistry, validateTaskDefaults } from "@/backend/ai/registry";
import { authMiddleware } from "@/backend/api/middleware/auth";
import { ValidationError } from "@/backend/core";

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
    // `task_model_defaults.model_id` has an FK onto `model_catalog`, so an id that
    // was added to the code catalog but never synced to D1 fails as an opaque
    // constraint error. Check both, and say which fix is needed.
    requireModel(b.modelId); // registered in code? throws a readable NotFound otherwise
    const [known] = await db.select().from(modelCatalog).where(eq(modelCatalog.modelId, b.modelId));
    if (!known) {
      throw new ValidationError(
        `Model '${b.modelId}' is in the code catalog but not yet in D1's model_catalog. POST /api/models/sync first (admin).`,
      );
    }
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

/**
 * `POST /api/models/sync` — push the declarative code catalog into D1
 * (`model_catalog`), and seed a `task_model_defaults` row for any task that has
 * none. Idempotent, and it NEVER overwrites a human-set task default.
 *
 * Admin-gated: this is configuration, not a feature API. Needed because adding a
 * model to `registry/catalog.ts` alone leaves D1 unaware of it, and
 * `task_model_defaults.model_id` has an FK onto `model_catalog`.
 */
modelsRouter.use("/api/models/sync", authMiddleware);
modelsRouter.openapi(
  createRoute({ method: "post", path: "/api/models/sync", tags: ["models"], responses: ok }),
  async (c) => {
    const db = getDb(c.env);
    await seedRegistry(db);
    return c.json({
      synced: listModels().length,
      defaults: await db.select().from(taskModelDefaults),
      broken: await validateTaskDefaults(db),
    });
  },
);
