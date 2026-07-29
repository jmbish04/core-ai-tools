/**
 * @fileoverview `model_catalog` — the informational registry of models that
 * exist. Sync from providers surfaces what's available (`is_new` banners,
 * `deprecated_at`); it NEVER changes dispatch behaviour. Dispatch reads
 * `task_model_defaults`, not this table. The declarative code registry
 * (`backend/ai/registry`) seeds and mirrors these rows.
 */

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/** Human-readable description of `model_catalog` for the docs UI. */
export const MODEL_CATALOG_TABLE_DESCRIPTION =
  "Informational registry of known models + their capability flags. Never authoritative for dispatch (that is task_model_defaults). Records is_new and deprecated_at for surfacing.";

export const MODEL_CATALOG_COLUMN_DESCRIPTIONS: Record<string, string> = {
  model_id: "Provider model id, e.g. gemini-3.1-flash-image. Primary key.",
  provider: "google | openai | workers-ai.",
  display_name: "Human label.",
  capabilities: "JSON capability flags (text_to_image, mask_inpainting, grounding_web, video_generation, segmentation, …).",
  max_resolution: "Max output resolution label (e.g. 4K).",
  supported_aspect_ratios: "JSON array of supported aspect ratios.",
  cost_per_image: "Approximate USD per image, or null (guardian auto-prices).",
  is_new: "Surfaced as a banner on /models until acknowledged.",
  deprecated_at: "Set when the model disappears from the provider; alerts if an enabled default points at it.",
  created_at: "Unix timestamp (seconds).",
  updated_at: "Unix timestamp (seconds).",
};

export const modelCatalog = sqliteTable("model_catalog", {
  modelId: text("model_id").primaryKey(),
  provider: text("provider", { enum: ["google", "openai", "workers-ai"] }).notNull(),
  displayName: text("display_name").notNull(),
  capabilities: text("capabilities", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  maxResolution: text("max_resolution"),
  supportedAspectRatios: text("supported_aspect_ratios", { mode: "json" }).$type<string[]>(),
  costPerImage: real("cost_per_image"),
  isNew: integer("is_new", { mode: "boolean" }).notNull().default(false),
  deprecatedAt: integer("deprecated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertModelCatalogSchema = createInsertSchema(modelCatalog);
export const selectModelCatalogSchema = createSelectSchema(modelCatalog);
export type ModelCatalogRow = typeof modelCatalog.$inferSelect;
export type NewModelCatalogRow = typeof modelCatalog.$inferInsert;
