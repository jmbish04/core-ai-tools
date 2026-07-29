/**
 * @fileoverview `prompt_templates` — the best-practices prompt library. Seeded
 * from the prompting guide, extended by promotion from successful revisions, and
 * surfaced on all three surfaces (a `/prompts` page, a `use_template` action, and
 * an MCP tool that lets the model retrieve relevant templates BEFORE composing).
 *
 * `promoted_from_revision_id` links a template back to the revision it was
 * promoted from; `avg_grade` rolls up from `prompt_grades` so a promoted template
 * that stops performing becomes visible.
 */

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const PROMPT_TEMPLATES_TABLE_DESCRIPTION =
  "Best-practices prompt library. Categorised, with placeholder slots, recommended model + settings, promotion lineage, and a rolled-up avg_grade.";

export const PROMPT_TEMPLATES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  title: "Short template name.",
  category: "photorealistic | text-in-image | product-mockup | inpainting | style-transfer | composition | detail-preservation | sketch-to-photo | character-consistency | sequential-art | minimalist | grounding | video | room-visualisation | technique.",
  template_body: "Template with [placeholder] slots.",
  example_prompt: "A filled-in example.",
  recommended_model: "Suggested model id.",
  recommended_settings: "JSON: aspect_ratio, image_size, thinking_level, grounding.",
  technique_tags: "JSON array of technique tags.",
  source: "seeded | promoted | manual.",
  promoted_from_revision_id: "Revision this was promoted from (soft ref), or null.",
  use_count: "How many times applied.",
  avg_grade: "Rolled-up average grade (1–5) from prompt_grades, or null.",
  created_via: "ui | api | mcp.",
  created_at: "Unix timestamp (seconds).",
  updated_at: "Unix timestamp (seconds).",
  deleted_at: "Soft-delete marker, or null.",
};

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  category: text("category").notNull(),
  templateBody: text("template_body").notNull(),
  examplePrompt: text("example_prompt"),
  recommendedModel: text("recommended_model"),
  recommendedSettings: text("recommended_settings", { mode: "json" }).$type<Record<string, unknown>>(),
  techniqueTags: text("technique_tags", { mode: "json" }).$type<string[]>(),
  source: text("source", { enum: ["seeded", "promoted", "manual"] })
    .notNull()
    .default("manual"),
  /** Soft ref to revisions.id (no FK — templates outlive revisions/sessions). */
  promotedFromRevisionId: text("promoted_from_revision_id"),
  useCount: integer("use_count").notNull().default(0),
  avgGrade: real("avg_grade"),
  createdVia: text("created_via", { enum: ["ui", "api", "mcp"] })
    .notNull()
    .default("ui"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates);
export const selectPromptTemplateSchema = createSelectSchema(promptTemplates);
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
