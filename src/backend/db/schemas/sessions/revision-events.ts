/**
 * @fileoverview `revision_events` — append-only per-session event log. Serves
 * two jobs at once: the audit trail AND the WebSocket replay buffer.
 *
 * `seq` is monotonic PER SESSION. On WebSocket connect a client sends its last
 * known seq and the DO replays everything after it from this table (D1 is the
 * source of truth; the DO is only fanout). The unique index on
 * (session_uuid, seq) guarantees a total order the client can resume against.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { revisions } from "./revisions";
import { sessions } from "./sessions";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `revision_events` table for the docs UI. */
export const REVISION_EVENTS_TABLE_DESCRIPTION =
  "Append-only per-session event log — both the audit trail and the WebSocket replay buffer. seq is monotonic per session; on reconnect the DO replays events after the client's last-known seq from this table.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const REVISION_EVENTS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  session_uuid: "FK into sessions.session_uuid — the session this event belongs to.",
  revision_id: "FK into revisions.id — the revision the event concerns, or null for session-level events.",
  seq: "Monotonic sequence number per session. Unique with session_uuid. Drives WebSocket replay.",
  event_type: "Event discriminator (e.g. revision_created, status_changed, approval_requested).",
  payload: "JSON event payload.",
  created_at: "Unix timestamp (seconds) when the event was appended.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const revisionEvents = sqliteTable(
  "revision_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionUuid: text("session_uuid")
      .notNull()
      .references(() => sessions.sessionUuid, { onDelete: "cascade" }),
    /** Null for session-level events not tied to a specific revision. */
    revisionId: text("revision_id").references(() => revisions.id, {
      onDelete: "cascade",
    }),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Total order per session — the replay cursor resumes against this.
    uniqueIndex("idx_revision_events_session_seq").on(t.sessionUuid, t.seq),
    // "events for this revision" (detail pane history).
    index("idx_revision_events_revision").on(t.revisionId),
  ],
);

export const insertRevisionEventSchema = createInsertSchema(revisionEvents);
export const selectRevisionEventSchema = createSelectSchema(revisionEvents);
export type RevisionEvent = typeof revisionEvents.$inferSelect;
export type NewRevisionEvent = typeof revisionEvents.$inferInsert;
