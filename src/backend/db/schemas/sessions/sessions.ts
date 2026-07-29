/**
 * @fileoverview `sessions` — one editing session per source photo. The PK is a
 * UUIDv4 (`session_uuid`) so it can key the per-session Durable Object
 * (`env.SESSION_DO.getByName(sessionUuid)`) directly.
 *
 * `origin_library_image_id` is a hard FK into library_images and is INDEXED: a
 * defining product requirement is "select any library photo → list every
 * session ever spawned from it" (list_sessions_for_image).
 *
 * `root_revision_id` intentionally carries NO database FK. sessions and
 * revisions reference each other (a revision belongs to a session; a session
 * names its root revision), which is a cycle SQLite would force us to create
 * tables around awkwardly. The root revision is written immediately after the
 * session inside one service-layer transaction, so this stays a soft reference.
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `sessions` table for the docs UI. */
export const SESSIONS_TABLE_DESCRIPTION =
  "One editing session per source photo. PK is a UUIDv4 keying the per-session Durable Object. origin_library_image_id is an indexed FK enabling 'list every session spawned from this image'. approval_policy gates masked/all edits behind HITL review.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const SESSIONS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  session_uuid: "UUIDv4 primary key. Keys the per-session Durable Object.",
  title: "Human-readable session title.",
  origin_library_image_id:
    "Indexed FK into library_images.id — the source photo this session edits. Enables list_sessions_for_image.",
  status: "Lifecycle state: active or archived.",
  approval_policy:
    "HITL gate policy: auto (no gate), masked_only (default — gate edits that use a mask), or always (gate every edit).",
  root_revision_id:
    "Soft reference (no DB FK, to avoid a sessions<->revisions cycle) to the root node of this session's revision tree.",
  created_via: "Surface that created the session: ui, api, or mcp.",
  created_at: "Unix timestamp (seconds) when the session was created.",
  updated_at: "Unix timestamp (seconds) of the last modification.",
  last_activity_at: "Unix timestamp (seconds) of the most recent activity (used for sorting/idle sweeps).",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const sessions = sqliteTable("sessions", {
  sessionUuid: text("session_uuid")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title"),
  /**
   * The source photo. Hard FK and indexed (see index below) so any library
   * image can enumerate every session descended from it. `restrict` on delete
   * is moot in practice because library images are only ever soft-deleted.
   */
  originLibraryImageId: text("origin_library_image_id")
    .notNull()
    .references(() => libraryImages.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  approvalPolicy: text("approval_policy", {
    enum: ["auto", "masked_only", "always"],
  })
    .notNull()
    .default("masked_only"),
  /** Soft reference to revisions.id — deliberately NOT a DB FK (see @fileoverview). */
  rootRevisionId: text("root_revision_id"),
  /**
   * Per-session model overrides by task_key (JSON, e.g.
   * {"image_edit":"gemini-3-pro-image"}). Second in the resolution order:
   * explicit request → this → task_model_defaults → error.
   */
  modelOverrides: text("model_overrides", { mode: "json" }).$type<Record<string, string>>(),
  createdVia: text("created_via", { enum: ["ui", "api", "mcp"] })
    .notNull()
    .default("ui"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (t) => [
  // The FK payoff: "list every session spawned from this library image."
  index("idx_sessions_origin_image").on(t.originLibraryImageId),
]);

export const insertSessionSchema = createInsertSchema(sessions);
export const selectSessionSchema = createSelectSchema(sessions);
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
