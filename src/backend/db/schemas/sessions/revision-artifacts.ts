/**
 * @fileoverview `revision_artifacts` — non-output byproducts of a generation that
 * are NOT library images: interim "thought" images (Gemini thinking), grounding
 * previews, debug frames. Kept separate from `library_images` so they don't
 * pollute the library or the tree, but are still addressable for debugging a bad
 * generation. Bytes live in Cloudflare Images; this row holds the id.
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { revisions } from "./revisions";

export const REVISION_ARTIFACTS_TABLE_DESCRIPTION =
  "Non-output byproducts of a revision (interim thought images, grounding previews, debug frames) — addressable but not library images and not tree nodes.";

export const REVISION_ARTIFACTS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  revision_id: "FK into revisions.id — the revision this artifact came from.",
  kind: "thinking_image | grounding_preview | debug_frame.",
  cf_image_id: "Cloudflare Images id of the artifact bytes, or null for non-image artifacts.",
  metadata: "JSON metadata (e.g. thought step index).",
  created_at: "Unix timestamp (seconds).",
};

export const revisionArtifacts = sqliteTable("revision_artifacts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  revisionId: text("revision_id")
    .notNull()
    .references(() => revisions.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["thinking_image", "grounding_preview", "debug_frame"],
  }).notNull(),
  cfImageId: text("cf_image_id"),
  metadata: text("metadata", { mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertRevisionArtifactSchema = createInsertSchema(revisionArtifacts);
export const selectRevisionArtifactSchema = createSelectSchema(revisionArtifacts);
export type RevisionArtifact = typeof revisionArtifacts.$inferSelect;
export type NewRevisionArtifact = typeof revisionArtifacts.$inferInsert;
