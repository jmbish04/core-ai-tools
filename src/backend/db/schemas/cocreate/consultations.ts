/**
 * @fileoverview `cocreate_consultations` + `cocreate_consultation_matches` — the
 * consultant. A user describes what they are trying to make; the consultant
 * reads answered questionnaire rows from other sessions, picks the relevant ones,
 * and advises how to use them to get an image closer to the intent (and away
 * from hallucinated detail).
 *
 * Matches are a join table, not a JSON id list, so every cited answer is an FK
 * that must resolve at write time.
 */

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { cocreateAnswers } from "./answers";
import { cocreateSessions } from "./sessions";

export const COCREATE_CONSULTATIONS_TABLE_DESCRIPTION =
  "Consultant runs: a goal, the advice given, and (via cocreate_consultation_matches) which past answers it cited.";

export const COCREATE_CONSULTATIONS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  session_id: "FK cocreate_sessions.id — the session it was asked from, or null when asked before one existed (SET NULL).",
  goal: "What the user described.",
  advice: "Markdown advice.",
  model: "Model id that answered.",
  candidate_count: "How many past answers were offered to the model.",
  created_at: "Unix timestamp (seconds).",
};

export const cocreateConsultations = sqliteTable(
  "cocreate_consultations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id").references(() => cocreateSessions.id, { onDelete: "set null" }),
    goal: text("goal").notNull(),
    advice: text("advice").notNull(),
    model: text("model").notNull(),
    candidateCount: integer("candidate_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("idx_cocreate_consultations_session").on(t.sessionId, t.createdAt)],
);

export const COCREATE_CONSULTATION_MATCHES_TABLE_DESCRIPTION =
  "M:N between consultations and the past answers they cited, with why and how to use each.";

export const COCREATE_CONSULTATION_MATCHES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  consultation_id: "FK cocreate_consultations.id (CASCADE).",
  answer_id: "FK cocreate_answers.id (CASCADE).",
  reason: "Why this answer is relevant to the goal.",
  how_to_use: "How to apply it to improve alignment.",
};

export const cocreateConsultationMatches = sqliteTable(
  "cocreate_consultation_matches",
  {
    consultationId: text("consultation_id")
      .notNull()
      .references(() => cocreateConsultations.id, { onDelete: "cascade" }),
    answerId: text("answer_id")
      .notNull()
      .references(() => cocreateAnswers.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    howToUse: text("how_to_use").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.consultationId, t.answerId] }),
    // "Which consultations cited this answer" (reuse popularity).
    index("idx_cocreate_matches_answer").on(t.answerId),
  ],
);

export const insertCocreateConsultationSchema = createInsertSchema(cocreateConsultations);
export const selectCocreateConsultationSchema = createSelectSchema(cocreateConsultations);
export type CocreateConsultation = typeof cocreateConsultations.$inferSelect;
export type CocreateConsultationMatch = typeof cocreateConsultationMatches.$inferSelect;
