/**
 * @fileoverview `library_images` — the registry of every image byte-blob the
 * platform knows about. Bytes live in Cloudflare Images; this row stores only
 * the CF image id, the delivery URL, and metadata (never the bytes).
 *
 * Deletes are SOFT only (`deleted_at`). A hard delete would orphan revision
 * history — a `revisions.input_image_id` / `output_image_id` could point at a
 * vanished row — so the service layer never issues DELETE against this table.
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryFolders } from "./folders";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `library_images` table for the docs UI. */
export const LIBRARY_IMAGES_TABLE_DESCRIPTION =
  "Registry of every image the platform knows about. Bytes live in Cloudflare Images; this row stores the CF image id, delivery URL, and metadata only. Deletes are soft (deleted_at) — a hard delete would orphan revision history.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const LIBRARY_IMAGES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  cf_image_id: "Cloudflare Images image id — the handle used to build variant URLs.",
  delivery_url: "Base Cloudflare Images delivery URL for this image.",
  folder_id: "FK into library_folders.id — null means the image sits at library root.",
  original_filename: "Filename as supplied at upload time.",
  content_type: "MIME type of the original upload (e.g. image/png).",
  width: "Pixel width of the original image.",
  height: "Pixel height of the original image.",
  bytes: "Size of the original image in bytes.",
  kind: "Provenance of the image: stock (user-uploaded source), staged (intermediate), or generated (model output).",
  uploaded_via: "Surface that registered the image: ui, api, or mcp.",
  created_at: "Unix timestamp (seconds) when the row was created.",
  deleted_at: "Unix timestamp (seconds) of soft deletion, or null if live. Hard deletes are never issued.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const libraryImages = sqliteTable(
  "library_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    cfImageId: text("cf_image_id").notNull(),
    deliveryUrl: text("delivery_url").notNull(),
    /** FK into library_folders.id — null means the image sits at library root. */
    folderId: text("folder_id").references(() => libraryFolders.id, {
      onDelete: "set null",
    }),
    originalFilename: text("original_filename"),
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    kind: text("kind", { enum: ["stock", "staged", "generated"] })
      .notNull()
      .default("stock"),
    uploadedVia: text("uploaded_via", { enum: ["ui", "api", "mcp"] })
      .notNull()
      .default("ui"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    /** Soft-delete marker. Null = live. The platform never hard-deletes images. */
    deletedAt: integer("deleted_at", { mode: "timestamp" }),

    // --- Phase 8: polymorphic media (this table is the de-facto asset registry;
    // generalised IN PLACE rather than renamed to library_assets to avoid the FK
    // blast radius mid-build — reversible to a rename later). ---
    /** image (bytes in Cloudflare Images) | video (bytes in R2). */
    mediaType: text("media_type", { enum: ["image", "video"] })
      .notNull()
      .default("image"),
    /** Where the bytes live. */
    storage: text("storage", { enum: ["cf_images", "r2"] })
      .notNull()
      .default("cf_images"),
    /** R2 object key for video (storage='r2'); null for CF Images. */
    r2Key: text("r2_key"),
    /** Video duration in ms, or null. */
    durationMs: integer("duration_ms"),

    // --- Video TTL (application-managed; R2 has no per-object user-mutable TTL). ---
    /** Absolute expiry. NULL = never expires. Default on video create: now + 90d. */
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    /** The TTL policy that produced expires_at (so "extend by 90" is expressible). */
    ttlDays: integer("ttl_days"),
    ttlSetBySurface: text("ttl_set_by_surface", { enum: ["ui", "api", "mcp"] }),
    ttlUpdatedAt: integer("ttl_updated_at", { mode: "timestamp" }),
    /**
     * R2 object purged by the TTL sweep — DISTINCT from `deleted_at`. The row and
     * all metadata survive (revision stays replayable AS AN INSTRUCTION); only the
     * bytes are gone. Never set by user delete; never touches CF Images.
     */
    bytesPurgedAt: integer("bytes_purged_at", { mode: "timestamp" }),
  },
  (t) => [
    // "list images in folder X" — the library grid's primary query.
    index("idx_library_images_folder").on(t.folderId),
    // TTL sweep: rows with an expiry whose bytes aren't yet purged.
    index("idx_library_images_expiry")
      .on(t.expiresAt)
      .where(sql`${t.bytesPurgedAt} is null and ${t.expiresAt} is not null`),
  ],
);

export const insertLibraryImageSchema = createInsertSchema(libraryImages);
export const selectLibraryImageSchema = createSelectSchema(libraryImages);
export type LibraryImage = typeof libraryImages.$inferSelect;
export type NewLibraryImage = typeof libraryImages.$inferInsert;
