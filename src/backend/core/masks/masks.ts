/**
 * @fileoverview Mask operations. A mask is a first-class, addressable, reusable
 * row — never an inline blob. `create_mask` / `list_masks` / `describe_mask` all
 * live here.
 *
 * Phase 2 persists and queries mask rows for all four authoring kinds. Two pieces
 * are explicitly deferred:
 *   - SEMANTIC resolution (running a segmentation pass to turn a natural-language
 *     region into a raster) — Phase 5. Until then a `semantic` mask stores its
 *     label + geometry hint and stays `proposed`.
 *   - `describe_mask` PREVIEW compositing (mask over source image) — Phase 5,
 *     once Cloudflare Images transforms are wired (Phase 3). `describeMask`
 *     returns the row with `previewUrl: null` for now.
 *
 * Deletes are SOFT (`deleted_at`); a revision may reuse a mask across sessions,
 * so a hard delete would break replay.
 */

import { and, eq, isNull } from "drizzle-orm";

import { masks } from "@/backend/db/schema";
import type { Mask } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { EventType } from "../events";
import { NotFoundError, ValidationError } from "../errors";
import { requireImage } from "../library/images";

export type MaskKind = "bbox" | "polygon" | "raster" | "semantic";
export type MaskState = "proposed" | "confirmed" | "rejected";

export interface CreateMaskInput {
  /** Null = library-scoped, reusable across sessions. */
  sessionUuid?: string | null;
  sourceImageId: string;
  kind: MaskKind;
  /** Normalised 0–1 geometry; shape depends on kind. */
  geometry: unknown;
  /** CF Images id of a rasterised/uploaded mask PNG (raster kind, or resolved semantic). */
  cfImageId?: string | null;
  featherPx?: number;
  label?: string | null;
  /** Fraction of frame covered (0–1); drives auto-escalation to approval. */
  coverageRatio?: number | null;
  /** Lineage — set when this mask corrects an earlier proposal (brush tool). */
  derivedFromMaskId?: string | null;
  /** Defaults to 'proposed' (MCP-authored masks are blind estimates, gated). */
  state?: MaskState;
  createdVia?: "ui" | "api" | "mcp";
}

/** Create (persist) a mask row. Returns the row with its `mask_id`. */
export async function createMask(ctx: CoreContext, input: CreateMaskInput): Promise<Mask> {
  await requireImage(ctx, input.sourceImageId);
  if (input.derivedFromMaskId) {
    await requireMask(ctx, input.derivedFromMaskId);
  }
  if (input.coverageRatio != null && (input.coverageRatio < 0 || input.coverageRatio > 1)) {
    throw new ValidationError("coverage_ratio must be between 0 and 1.");
  }

  const [row] = await ctx.db
    .insert(masks)
    .values({
      sessionUuid: input.sessionUuid ?? null,
      sourceImageId: input.sourceImageId,
      kind: input.kind,
      geometry: input.geometry,
      cfImageId: input.cfImageId ?? null,
      featherPx: input.featherPx ?? 0,
      label: input.label ?? null,
      coverageRatio: input.coverageRatio ?? null,
      derivedFromMaskId: input.derivedFromMaskId ?? null,
      state: input.state ?? "proposed",
      createdVia: input.createdVia ?? "ui",
    })
    .returning();

  if (row.sessionUuid) {
    await ctx.events.appendEvent(row.sessionUuid, {
      type: EventType.MaskCreated,
      payload: { maskId: row.id, kind: row.kind, state: row.state },
    });
  }
  return row;
}

/** List live masks scoped to a session (or, with `sessionUuid: null`, library-scoped). */
export async function listMasks(
  ctx: CoreContext,
  input?: { sessionUuid?: string | null },
): Promise<Mask[]> {
  const live = isNull(masks.deletedAt);
  let where = live;
  // undefined = no filter; null = library-scoped; else a session id.
  if (input?.sessionUuid === null) {
    where = and(live, isNull(masks.sessionUuid))!;
  } else if (input?.sessionUuid !== undefined) {
    where = and(live, eq(masks.sessionUuid, input.sessionUuid))!;
  }
  return ctx.db.select().from(masks).where(where);
}

export interface DescribeMaskResult {
  mask: Mask;
  /**
   * Preview of the mask composited over its source image, for blind-mask
   * confirmation over MCP. Compositing needs Cloudflare Images transforms
   * (Phase 3) and lands in Phase 5 — null until then.
   */
  previewUrl: string | null;
}

/** Return a mask plus (Phase 5) a composited preview URL. */
export async function describeMask(ctx: CoreContext, maskId: string): Promise<DescribeMaskResult> {
  const mask = await requireMask(ctx, maskId);
  return { mask, previewUrl: null };
}

/** Mark a mask confirmed (used by the approval flow when a proposal is accepted). */
export async function confirmMask(ctx: CoreContext, maskId: string): Promise<Mask> {
  await requireMask(ctx, maskId);
  const [row] = await ctx.db
    .update(masks)
    .set({ state: "confirmed", confirmedAt: new Date() })
    .where(eq(masks.id, maskId))
    .returning();
  if (row.sessionUuid) {
    await ctx.events.appendEvent(row.sessionUuid, {
      type: EventType.MaskConfirmed,
      payload: { maskId: row.id },
    });
  }
  return row;
}

/** Fetch a LIVE mask or throw NotFound. */
export async function requireMask(ctx: CoreContext, maskId: string): Promise<Mask> {
  const [row] = await ctx.db
    .select()
    .from(masks)
    .where(and(eq(masks.id, maskId), isNull(masks.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError(`Mask ${maskId} not found.`);
  return row;
}
