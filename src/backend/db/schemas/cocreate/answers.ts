/**
 * @fileoverview `cocreate_answers` — the questionnaire: each clarifying question
 * the model asked, its options, and what the user answered (or that they skipped).
 *
 * This is the reusable knowledge. Answers are readable across sessions: the
 * consultant matches a new goal against answered rows from OTHER sessions, and
 * importing one creates a new row here with `source_answer_id` pointing at the
 * original — the original is never moved or mutated.
 *
 * Lifecycle: `pending` (asked, not answered) → `answered` | `skipped`. An answer
 * is "applied" once a prompt version absorbed it (`applied_in_version_id`).
 */

import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { cocreatePromptVersions } from "./prompt-versions";
import { cocreateSessions } from "./sessions";

export const COCREATE_ANSWERS_TABLE_DESCRIPTION =
  "Clarifying questions asked in a co-creator session, with options and the user's answer. Reused across sessions via the consultant (source_answer_id lineage).";

export const COCREATE_ANSWERS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  session_id: "FK cocreate_sessions.id (CASCADE).",
  asked_in_version_id: "FK cocreate_prompt_versions.id — the prompt the question was asked about (SET NULL).",
  applied_in_version_id: "FK cocreate_prompt_versions.id — the version that absorbed this answer, or null (SET NULL).",
  question: "The question text.",
  options: "JSON array of suggested answers.",
  answer: "The user's answer (an option or free text); null while pending or when skipped.",
  status: "pending | answered | skipped.",
  source_answer_id: "FK self — the answer in another session this was imported from (SET NULL).",
  created_at: "Unix timestamp (seconds).",
  answered_at: "Unix timestamp (seconds), or null.",
};

export const ANSWER_STATUSES = ["pending", "answered", "skipped"] as const;

export const cocreateAnswers = sqliteTable(
  "cocreate_answers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => cocreateSessions.id, { onDelete: "cascade" }),
    askedInVersionId: text("asked_in_version_id").references(() => cocreatePromptVersions.id, { onDelete: "set null" }),
    appliedInVersionId: text("applied_in_version_id").references(() => cocreatePromptVersions.id, {
      onDelete: "set null",
    }),
    question: text("question").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    answer: text("answer"),
    status: text("status", { enum: ANSWER_STATUSES }).notNull().default("pending"),
    sourceAnswerId: text("source_answer_id").references((): AnySQLiteColumn => cocreateAnswers.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    answeredAt: integer("answered_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_cocreate_answers_session").on(t.sessionId),
    // Consultant candidate pool: answered rows across sessions, newest first.
    index("idx_cocreate_answers_status_answered").on(t.status, t.answeredAt),
    index("idx_cocreate_answers_source").on(t.sourceAnswerId),
  ],
);

export const insertCocreateAnswerSchema = createInsertSchema(cocreateAnswers);
export const selectCocreateAnswerSchema = createSelectSchema(cocreateAnswers);
export type CocreateAnswer = typeof cocreateAnswers.$inferSelect;
export type NewCocreateAnswer = typeof cocreateAnswers.$inferInsert;
