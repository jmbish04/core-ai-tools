/**
 * @fileoverview `session_images` — a session's reference-image pool. Each row
 * tags a library image with a role (base | object | style) for use as an
 * ADDITIONAL reference in that session's edits (Nano Banana / Gemini take up to
 * 14 reference images beyond the base). This is the session-scoped palette the
 * compose-pane picker draws from and where role lives.
 *
 * The base image of an edit is still `revisions.input_image_id`; these are the
 * extra refs. A revision records WHICH refs it used (ordered) in
 * `editPayload.reference_image_ids`; roles are read from here. `library_image_id`
 * is `ON DELETE RESTRICT` (images are soft-delete-only) so a pool entry never
 * dangles. One role per (session, image): re-adding updates the role.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";
import { sessions } from "./sessions";

export const SESSION_IMAGES_TABLE_DESCRIPTION =
  "A session's reference-image pool: library images tagged with a role (base|object|style) for use as additional references in that session's edits. The compose-pane picker and submit_edit's references[] populate it.";

export const SESSION_IMAGES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  session_uuid: "FK into sessions.session_uuid (ON DELETE cascade) — the session this reference belongs to.",
  library_image_id: "FK into library_images.id (ON DELETE restrict) — the reference image.",
  role: "How the reference is used: base, object, or style. Assembly order is base → object → style.",
  created_at: "Unix timestamp (seconds) when the reference was added to the session.",
};

export const sessionImages = sqliteTable(
  "session_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionUuid: text("session_uuid")
      .notNull()
      .references(() => sessions.sessionUuid, { onDelete: "cascade" }),
    libraryImageId: text("library_image_id")
      .notNull()
      .references(() => libraryImages.id, { onDelete: "restrict" }),
    role: text("role", { enum: ["base", "object", "style"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // One role per image per session; re-adding updates the role (upsert target).
    uniqueIndex("uniq_session_images").on(t.sessionUuid, t.libraryImageId),
    // "list this session's reference pool".
    index("idx_session_images_session").on(t.sessionUuid),
  ],
);

export const insertSessionImageSchema = createInsertSchema(sessionImages);
export const selectSessionImageSchema = createSelectSchema(sessionImages);
export type SessionImage = typeof sessionImages.$inferSelect;
export type NewSessionImage = typeof sessionImages.$inferInsert;
