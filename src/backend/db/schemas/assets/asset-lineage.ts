/**
 * @fileoverview `asset_lineage` — "which asset(s) did this image descend from?"
 *
 * One row per (asset, produced image). Written when a revision succeeds: the
 * output image INHERITS every lineage row of the revision's input image (plus the
 * asset itself, if the input image is an asset's backing image). That single rule
 * is what makes lineage survive the shape of the revision tree:
 *
 *   - FORK   — the child's input_image_id is the forked-from node's output image,
 *              which already carries the lineage → inherited.
 *   - RETRY  — same parent, therefore the same input image → inherited.
 *
 * So the lineage is stored TRANSITIVELY CLOSED (asset → every descendant image,
 * not just the direct child). That is deliberate: an asset page's only query is
 * "every iteration this asset ever produced", which is then one indexed read
 * instead of a recursive walk up a tree whose middle nodes may have failed.
 *
 * Both the asset and the image FK are `ON DELETE RESTRICT` (both targets are
 * soft-delete/archive-only). `session_uuid` and `revision_id` are `SET NULL`:
 * they are provenance for grouping and timeline display, and the lineage fact
 * outlives the session that happened to produce it.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";
import { revisions } from "../sessions/revisions";
import { sessions } from "../sessions/sessions";
import { assets } from "./assets";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `asset_lineage` table for the docs UI. */
export const ASSET_LINEAGE_TABLE_DESCRIPTION =
  "Transitively-closed descent: one row per (asset, image produced from it). Written when a revision succeeds — the output image inherits every lineage row of its input image, which is why lineage survives forks (child's input is the parent's output) and retries (same parent, same input). Powers 'every iteration this asset ever produced', grouped by folder/session and ordered as a timeline.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const ASSET_LINEAGE_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  asset_id: "FK into assets.id (ON DELETE restrict) — the ancestor asset.",
  library_image_id:
    "FK into library_images.id (ON DELETE restrict) — an image that descends from the asset. Unique per (asset, image).",
  session_uuid:
    "FK into sessions.session_uuid (ON DELETE set null) — the session that produced the image, or null (e.g. prompt-only generation, or an archived session's row).",
  revision_id:
    "FK into revisions.id (ON DELETE set null) — the revision that produced the image, or null.",
  created_at: "Unix timestamp (seconds) the lineage row was written — the timeline ordering key.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const assetLineage = sqliteTable(
  "asset_lineage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    libraryImageId: text("library_image_id")
      .notNull()
      .references(() => libraryImages.id, { onDelete: "restrict" }),
    /** Provenance only — the lineage fact outlives the session. */
    sessionUuid: text("session_uuid").references(() => sessions.sessionUuid, {
      onDelete: "set null",
    }),
    revisionId: text("revision_id").references(() => revisions.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Idempotent recording: re-running propagation for the same output image is a
    // no-op rather than a duplicate timeline entry.
    uniqueIndex("uniq_asset_lineage").on(t.assetId, t.libraryImageId),
    // The asset page's timeline read: every iteration of one asset, oldest first.
    index("idx_asset_lineage_asset_created").on(t.assetId, t.createdAt),
    // The inheritance read: "which assets does this image descend from?" — hit
    // once per successful revision.
    index("idx_asset_lineage_image").on(t.libraryImageId),
  ],
);

export const insertAssetLineageSchema = createInsertSchema(assetLineage);
export const selectAssetLineageSchema = createSelectSchema(assetLineage);
export type AssetLineage = typeof assetLineage.$inferSelect;
export type NewAssetLineage = typeof assetLineage.$inferInsert;
