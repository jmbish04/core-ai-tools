/**
 * @fileoverview `prompt_grades` — grades on a revision's output, feeding the
 * template avg_grade rollup and (long-term) a correlation of failure modes with
 * model + settings. `perspective_drift` and `dimension_change` are first in the
 * enum deliberately — the dominant failure mode for room-visualisation.
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { revisions } from "../sessions/revisions";

export const PROMPT_GRADES_TABLE_DESCRIPTION =
  "Grades (1–5) on a revision's output with a structured failure_mode, notes, and an optional suggested improved prompt. Rolls up to prompt_templates.avg_grade.";

export const PROMPT_GRADES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  revision_id: "FK into revisions.id — the graded output.",
  template_id: "Soft ref to prompt_templates.id, or null.",
  grade: "1–5.",
  graded_by_surface: "ui | api | mcp.",
  failure_mode: "perspective_drift | dimension_change | colour_shift | ignored_instruction | unwanted_addition | text_garbled | style_mismatch | quality | other.",
  notes: "Free-text notes.",
  suggested_revision: "An improved prompt the grader proposes.",
  created_at: "Unix timestamp (seconds).",
};

export const promptGrades = sqliteTable("prompt_grades", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  revisionId: text("revision_id")
    .notNull()
    .references(() => revisions.id, { onDelete: "cascade" }),
  /** Soft ref to prompt_templates.id (no FK — templates are soft-deleted). */
  templateId: text("template_id"),
  grade: integer("grade").notNull(),
  gradedBySurface: text("graded_by_surface", { enum: ["ui", "api", "mcp"] }),
  failureMode: text("failure_mode", {
    enum: [
      "perspective_drift",
      "dimension_change",
      "colour_shift",
      "ignored_instruction",
      "unwanted_addition",
      "text_garbled",
      "style_mismatch",
      "quality",
      "other",
    ],
  }),
  notes: text("notes"),
  suggestedRevision: text("suggested_revision"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertPromptGradeSchema = createInsertSchema(promptGrades);
export const selectPromptGradeSchema = createSelectSchema(promptGrades);
export type PromptGrade = typeof promptGrades.$inferSelect;
export type NewPromptGrade = typeof promptGrades.$inferInsert;
