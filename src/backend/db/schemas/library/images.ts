/**
 * @fileoverview `library_images` — the registry of every image byte-blob the
 * platform knows about. Bytes live in Cloudflare Images; this row stores only
 * the CF image id, the delivery URL, and metadata (never the bytes).
 *
 * Deletes are SOFT only (`deleted_at`). A hard delete would orphan revision
 * history — a `revisions.input_image_id` / `output_image_id` could point at a
 * vanished row — so the service layer never issues DELETE against this table.
 *
 * `public_id` is the SHORT, human-copyable handle (`img_<10 chars>`): what a user
 * copies to the clipboard and pastes into a prompt, as opposed to the UUID `id`.
 * It is generated per row by `shortPublicId()` and guarded by a unique index.
 * Rows created before the column existed carry NULL (SQLite permits many NULLs
 * in a unique index); `backfillPublicIds` fills them in.
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryFolders } from "./folders";

// ---------------------------------------------------------------------------
// Short public id
// ---------------------------------------------------------------------------

/**
 * Base-32 alphabet with the visually ambiguous letters (i, l, o, u) removed, so
 * a public id survives being read aloud or retyped from a screenshot.
 */
const PUBLIC_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Generate a short, URL-safe, human-copyable public id (`img_` + 10 base-32
 * characters ≈ 50 bits of entropy). Applied automatically as the column default
 * on insert, so every new row gets one without the call site knowing.
 *
 * @param length Number of random characters after the prefix (default 10).
 * @returns A new id such as `img_7k2qp9xw3b`.
 * @example const id = shortPublicId(); // "img_7k2qp9xw3b"
 */
export function shortPublicId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "img_";
  // 32-char alphabet → 5 bits per byte; the discarded high bits cost nothing.
  for (const b of bytes) out += PUBLIC_ID_ALPHABET[b & 31];
  return out;
}

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `library_images` table for the docs UI. */
export const LIBRARY_IMAGES_TABLE_DESCRIPTION =
  "Registry of every image the platform knows about. Bytes live in Cloudflare Images; this row stores the CF image id, delivery URL, and metadata only. Deletes are soft (deleted_at) — a hard delete would orphan revision history.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const LIBRARY_IMAGES_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  public_id:
    "Short, URL-safe, human-copyable handle (img_<10 base-32 chars>), unique. This is what a user copies to the clipboard and pastes into a prompt. NULL only on rows predating the column.",
  title: "Short human-authored name for the image, distinct from original_filename.",
  usage_instructions:
    "How a model or a person should use this image (e.g. 'use only the countertop texture, ignore the lighting').",
  context_text: "Background a model needs about the image (what it is, where it came from, what matters in it).",
  role:
    "Default role this image plays when pulled into an edit: base (the thing being edited), reference (look/style/object to draw from), or inject (composited into the output). NULL = unspecified; session_images.role still overrides per session.",
  cf_image_id: "Cloudflare Images image id — the handle used to build variant URLs.",
  delivery_url: "Base Cloudflare Images delivery URL for this image.",
  folder_id: "FK into library_folders.id — null means the image sits at library root.",
  original_filename: "Filename as supplied at upload time.",
  description: "Optional caption / provenance note supplied at ingest (e.g. a material name). Also used as reference-image context.",
  flagged_bad_at: "Unix timestamp (seconds) when the image was flagged as bad, or null if good. A flagged image is dimmed in the grid and should be ignored for editing.",
  bad_notes: "Why the image was flagged bad (free text), or null.",
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
    /**
     * Short human-copyable handle (see `shortPublicId`). Generated per row so no
     * call site has to remember to set it; unique index below is the backstop.
     */
    publicId: text("public_id").$defaultFn(() => shortPublicId()),
    cfImageId: text("cf_image_id").notNull(),
    deliveryUrl: text("delivery_url").notNull(),
    /** FK into library_folders.id — null means the image sits at library root. */
    folderId: text("folder_id").references(() => libraryFolders.id, {
      onDelete: "set null",
    }),
    originalFilename: text("original_filename"),
    /** Short human-authored name, distinct from the upload filename. */
    title: text("title"),
    /** Optional caption / provenance (material name, etc.); doubles as reference-image context. */
    description: text("description"),
    /** How this image should be used by a model or a person. */
    usageInstructions: text("usage_instructions"),
    /** Background a model needs about the image. */
    contextText: text("context_text"),
    /** Default role in an edit. `session_images.role` overrides per session. */
    role: text("role", { enum: ["base", "reference", "inject"] }),
    /** Non-null = flagged bad (ignore for editing); the value is when it was flagged. Undo sets it null. */
    flaggedBadAt: integer("flagged_bad_at", { mode: "timestamp" }),
    /** Why it was flagged bad, or null. */
    badNotes: text("bad_notes"),
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
    // The copyable handle must resolve to exactly one image. SQLite allows many
    // NULLs here, which is what lets pre-existing rows survive the migration.
    uniqueIndex("uniq_library_images_public_id").on(t.publicId),
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
