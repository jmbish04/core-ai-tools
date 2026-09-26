/**
 * @fileoverview `assets` — the curated asset library: the source images a user
 * comes BACK to (a product shot, a material swatch, a room they keep restyling),
 * as opposed to every byte-blob the platform has ever seen (`library_images`).
 *
 * Every asset is backed by exactly one `library_images` row — the asset table
 * carries the human metadata, the image row carries the bytes' identity — so
 * nothing about Cloudflare Images is duplicated here.
 *
 * Two ways in:
 *   - UPLOADED DIRECTLY: the upload registers a library image, then the asset
 *     wraps it. `promoted_from_image_id` is null.
 *   - PROMOTED from an existing library image: the image row is COPIED (same
 *     cf_image_id, new row, its own metadata and public id) and
 *     `promoted_from_image_id` records the original — the trace back.
 *
 * Both image FKs are `ON DELETE RESTRICT`: `library_images` is soft-delete-only,
 * and an asset whose backing row vanished could neither render nor replay. A
 * hard delete fails loudly instead of silently nulling the pointer.
 *
 * Assets themselves are never hard-deleted either — `archived_at` is the only
 * removal, because `asset_lineage` rows point here.
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `assets` table for the docs UI. */
export const ASSETS_TABLE_DESCRIPTION =
  "The curated asset library: reusable source images a user returns to. Each asset is backed by one library_images row (bytes stay in Cloudflare Images) and carries its own human metadata. An asset is either uploaded directly or promoted from an existing library image, in which case the image row is copied and promoted_from_image_id traces back to the original. Removal is archive-only (archived_at).";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const ASSETS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  name: "Human name of the asset — what the user looks for in the asset list.",
  library_image_id:
    "FK into library_images.id (ON DELETE restrict) — the image row backing this asset. Unique: one asset per backing image.",
  promoted_from_image_id:
    "FK into library_images.id (ON DELETE restrict) — the original image this asset was promoted (copied) from, or null when the asset was uploaded directly. This is the promotion trace.",
  description: "What the asset is.",
  usage_instructions: "How the asset should be used in an edit (carried into prompts).",
  context_text: "Background a model needs about the asset.",
  archived_at:
    "Unix timestamp (seconds) when the asset was archived, or null if live. Assets are never hard-deleted — asset_lineage points here.",
  created_at: "Unix timestamp (seconds) when the asset was created.",
  updated_at: "Unix timestamp (seconds) of the last modification.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const assets = sqliteTable(
  "assets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    /** The image row backing this asset. RESTRICT — soft-delete-only target. */
    libraryImageId: text("library_image_id")
      .notNull()
      .references(() => libraryImages.id, { onDelete: "restrict" }),
    /** The original this asset was promoted from, or null for a direct upload. */
    promotedFromImageId: text("promoted_from_image_id").references(() => libraryImages.id, {
      onDelete: "restrict",
    }),
    description: text("description"),
    usageInstructions: text("usage_instructions"),
    contextText: text("context_text"),
    /** Archive marker. Null = live. Assets are never hard-deleted. */
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // One asset per backing image — makes "is this image an asset?" a point read
    // and stops two assets claiming the same bytes identity.
    uniqueIndex("uniq_assets_library_image").on(t.libraryImageId),
    // "was this library image ever promoted into an asset?" — shown on the
    // library detail pane so the user does not promote the same photo twice.
    index("idx_assets_promoted_from").on(t.promotedFromImageId),
  ],
);

export const insertAssetSchema = createInsertSchema(assets);
export const selectAssetSchema = createSelectSchema(assets);
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
