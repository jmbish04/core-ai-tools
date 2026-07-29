/**
 * @fileoverview `understanding_results` — outputs of image understanding
 * (caption/VQA/classify/detect) that are NOT tree revisions (they don't
 * transform an image). Segmentation results become `masks` rows instead; this
 * table holds the non-mask understanding outputs, keyed to the source asset.
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";

export const UNDERSTANDING_RESULTS_TABLE_DESCRIPTION =
  "Non-mask image-understanding outputs (caption, VQA, classification, detection) keyed to a source asset. Understanding is not a tree edit, so it does not live as a revision.";

export const UNDERSTANDING_RESULTS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  source_image_id: "FK into library_images.id — the analysed asset.",
  kind: "caption | vqa | classify | detect.",
  query: "The question (VQA) or label set (classify), or null.",
  result: "JSON model output.",
  model: "Model id that produced the result.",
  created_at: "Unix timestamp (seconds).",
};

export const understandingResults = sqliteTable("understanding_results", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sourceImageId: text("source_image_id")
    .notNull()
    .references(() => libraryImages.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["caption", "vqa", "classify", "detect"] }).notNull(),
  query: text("query"),
  result: text("result", { mode: "json" }).$type<unknown>(),
  model: text("model"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertUnderstandingResultSchema = createInsertSchema(understandingResults);
export const selectUnderstandingResultSchema = createSelectSchema(understandingResults);
export type UnderstandingResult = typeof understandingResults.$inferSelect;
export type NewUnderstandingResult = typeof understandingResults.$inferInsert;
