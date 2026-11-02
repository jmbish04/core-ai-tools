/**
 * @fileoverview `cocreate_prompt_versions` — the full prompt revision log. Every
 * prompt a session ever held is a row: the initial text, each manual edit, each
 * accepted refinement, each consultant-suggested rewrite and each restore. The
 * diff view compares any two rows.
 *
 * Append-only. `version` is monotonic per session (unique index), allocated with
 * optimistic retry on a unique violation — never a silent `MAX()+1` race.
 * Which answers a version absorbed is derived from
 * `cocreate_answers.applied_in_version_id`, not stored twice here.
 */

import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { cocreateSessions } from "./sessions";

export const COCREATE_PROMPT_VERSIONS_TABLE_DESCRIPTION =
  "Append-only prompt revision log per co-creator session. version is monotonic per session; parent_version_id records lineage (restores and branches).";

export const COCREATE_PROMPT_VERSIONS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  session_id: "FK cocreate_sessions.id (CASCADE — a session owns its log).",
  version: "1-based, monotonic per session.",
  parent_version_id: "FK self — the version this one was derived from (SET NULL).",
  prompt_text: "The full prompt text, verbatim.",
  source: "initial | manual | refine | consultant | restore.",
  graph_updates: "JSON list of belief-graph edits folded into this version (refine only).",
  note: "Optional human/consultant note on why this version exists.",
  created_at: "Unix timestamp (seconds).",
};

/** A belief-graph edit the user made before refining (mirrors the demo's GraphUpdate). */
export type GraphUpdate =
  | { type: "attribute"; entity: string; attribute: string; value: string }
  | { type: "relationship"; source: string; target: string; oldLabel: string; newLabel: string };

export const PROMPT_VERSION_SOURCES = ["initial", "manual", "refine", "consultant", "restore"] as const;
export type PromptVersionSource = (typeof PROMPT_VERSION_SOURCES)[number];

export const cocreatePromptVersions = sqliteTable(
  "cocreate_prompt_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => cocreateSessions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentVersionId: text("parent_version_id").references((): AnySQLiteColumn => cocreatePromptVersions.id, {
      onDelete: "set null",
    }),
    promptText: text("prompt_text").notNull(),
    source: text("source", { enum: PROMPT_VERSION_SOURCES }).notNull(),
    graphUpdates: text("graph_updates", { mode: "json" }).$type<GraphUpdate[]>(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Monotonic counter guard + "the log for this session, in order".
    uniqueIndex("uniq_cocreate_versions_session_version").on(t.sessionId, t.version),
    index("idx_cocreate_versions_parent").on(t.parentVersionId),
  ],
);

export const insertCocreatePromptVersionSchema = createInsertSchema(cocreatePromptVersions);
export const selectCocreatePromptVersionSchema = createSelectSchema(cocreatePromptVersions);
export type CocreatePromptVersion = typeof cocreatePromptVersions.$inferSelect;
export type NewCocreatePromptVersion = typeof cocreatePromptVersions.$inferInsert;
