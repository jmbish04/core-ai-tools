/**
 * @fileoverview `masks` — first-class, addressable, reusable edit regions.
 *
 * A mask is a stored object with its own id, never an inline blob. This is what
 * makes masking work over MCP (a client with no canvas references a mask by id)
 * and what lets a browser-authored mask be re-used from Claude and vice versa.
 *
 * Geometry is stored in normalised 0–1 coordinates so a mask survives
 * resolution changes on the source image. `derived_from_mask_id` records the
 * lineage when a user corrects a proposed mask — the delta between proposed and
 * corrected is the signal that tells us whether the HITL gate still earns its
 * keep (§4.3), so corrections create a NEW row, never mutate the original.
 *
 * DELETES ARE SOFT ONLY (`deleted_at`), for the same reason as `library_images`:
 * a mask can be library-scoped and REUSED across sessions (`session_uuid` is
 * nullable). If a hard delete were allowed, deleting session A would take a mask
 * that session B's revision reuses, and B's revision could no longer be replayed
 * exactly — violating the spec's replayability guarantee. The service layer must
 * NEVER issue DELETE against this table; it sets `deleted_at` instead. The FK
 * `masks.session_uuid -> sessions` is therefore `SET NULL` (a mask outlives the
 * session it was born in), never `CASCADE`.
 */

import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";
import { sessions } from "./sessions";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `masks` table for the docs UI. */
export const MASKS_TABLE_DESCRIPTION =
  "First-class, addressable, reusable edit regions. Geometry is normalised 0–1 so masks survive resolution changes. Four authoring kinds (bbox, polygon, raster, semantic). derived_from_mask_id records proposed->corrected lineage; corrections create a new row rather than mutating the proposal.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const MASKS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  session_uuid:
    "FK into sessions.session_uuid (ON DELETE SET NULL) — null when the mask is library-scoped and reusable across sessions. A mask outlives the session it was born in.",
  source_image_id: "FK into library_images.id — the image the mask is drawn over.",
  kind: "Authoring kind: bbox, polygon, raster (uploaded PNG w/ alpha), or semantic (NL region resolved by segmentation).",
  geometry: "JSON geometry in normalised 0–1 coordinates (shape depends on kind).",
  cf_image_id: "Cloudflare Images id of the rasterised/uploaded mask PNG, or null for purely geometric masks.",
  feather_px: "Edge feather radius in pixels applied when rasterising.",
  label: "Optional human/model label (e.g. 'the kitchen island').",
  state: "HITL state: proposed (blind estimate, gated), confirmed, or rejected.",
  derived_from_mask_id:
    "Self-FK into masks.id — set when this mask is a correction of an earlier proposal. Never null-overwritten; lineage is preserved.",
  coverage_ratio: "Fraction of the frame (0–1) covered by the mask. >0.6 auto-escalates to approval.",
  created_via: "Surface that authored the mask: ui, api, or mcp.",
  created_at: "Unix timestamp (seconds) when the mask was created.",
  confirmed_at: "Unix timestamp (seconds) when the mask was confirmed, or null.",
  deleted_at: "Unix timestamp (seconds) of soft deletion, or null if live. Hard deletes are never issued (would break replay of revisions that reuse this mask).",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const masks = sqliteTable(
  "masks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /**
     * Null = library-scoped mask, reusable across sessions. SET NULL (not
     * cascade) on session delete: a mask outlives the session it was born in so
     * revisions in OTHER sessions that reuse it stay replayable.
     */
    sessionUuid: text("session_uuid").references(() => sessions.sessionUuid, {
      onDelete: "set null",
    }),
    sourceImageId: text("source_image_id")
      .notNull()
      .references(() => libraryImages.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["bbox", "polygon", "raster", "semantic"] }).notNull(),
    geometry: text("geometry", { mode: "json" }).$type<unknown>().notNull(),
    cfImageId: text("cf_image_id"),
    featherPx: integer("feather_px").notNull().default(0),
    label: text("label"),
    state: text("state", { enum: ["proposed", "confirmed", "rejected"] })
      .notNull()
      .default("proposed"),
    /**
     * Self-referential lineage. Set when a user corrects a proposed mask in the
     * brush tool; points at the original proposal. On proposal delete the child
     * is orphaned (`set null`) so a correction is never destroyed with it.
     */
    derivedFromMaskId: text("derived_from_mask_id").references(
      (): AnySQLiteColumn => masks.id,
      { onDelete: "set null" },
    ),
    coverageRatio: real("coverage_ratio"),
    createdVia: text("created_via", { enum: ["ui", "api", "mcp"] })
      .notNull()
      .default("ui"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
    /** Soft-delete marker. Null = live. The platform never hard-deletes masks. */
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (t) => [
    // Proposed->corrected accuracy stat walks this lineage edge.
    index("idx_masks_derived_from").on(t.derivedFromMaskId),
    // "list masks for this session" (list_masks).
    index("idx_masks_session").on(t.sessionUuid),
  ],
);

export const insertMaskSchema = createInsertSchema(masks);
export const selectMaskSchema = createSelectSchema(masks);
export type Mask = typeof masks.$inferSelect;
export type NewMask = typeof masks.$inferInsert;
