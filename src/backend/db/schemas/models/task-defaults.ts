/**
 * @fileoverview `task_model_defaults` — THE authoritative dispatch mapping. Code
 * always reads this. "Newest and best" happens only when someone updates a row
 * (via /models, the set_task_default MCP tool, or PUT /api/models/tasks/:key).
 * No auto-promotion, no lineage inference.
 *
 * Resolution order for a capability: explicit request →
 * sessions.model_overrides[task_key] → task_model_defaults[task_key] → ERROR.
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { modelCatalog } from "./model-catalog";

export const TASK_MODEL_DEFAULTS_TABLE_DESCRIPTION =
  "Authoritative task_key -> model_id mapping that dispatch reads. Updating a row is the only way to change which model serves a task. No auto-promotion.";

export const TASK_MODEL_DEFAULTS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  task_key: "Capability key: image_generate, image_edit, video, understand, segment, decompose.",
  model_id: "FK into model_catalog.model_id — the model that serves this task.",
  enabled: "Whether this default is active. A disabled default resolves to error.",
  updated_by_surface: "Surface that last changed the mapping: ui, api, or mcp.",
  updated_at: "Unix timestamp (seconds) of the last change.",
};

export const taskModelDefaults = sqliteTable("task_model_defaults", {
  taskKey: text("task_key").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => modelCatalog.modelId, { onDelete: "restrict" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedBySurface: text("updated_by_surface", { enum: ["ui", "api", "mcp"] }),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertTaskModelDefaultSchema = createInsertSchema(taskModelDefaults);
export const selectTaskModelDefaultSchema = createSelectSchema(taskModelDefaults);
export type TaskModelDefault = typeof taskModelDefaults.$inferSelect;
export type NewTaskModelDefault = typeof taskModelDefaults.$inferInsert;
