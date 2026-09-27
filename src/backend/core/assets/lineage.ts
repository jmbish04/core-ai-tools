/**
 * @fileoverview Asset lineage: "every iteration this asset ever produced."
 *
 * ONE rule does all the work. When a revision succeeds, its output image inherits
 * every asset the revision's INPUT image descends from (`propagateLineage`).
 * Because `revisions.input_image_id` is derived as
 * `parent.output_image_id ?? parent.input_image_id`, that rule already covers the
 * two ways the tree branches:
 *
 *   - FORK  — the child's input is the forked-from node's output, which carries the
 *             lineage, so the fork's output inherits it too.
 *   - RETRY — a retry shares the parent, therefore the same input image, therefore
 *             the same lineage.
 *
 * Nothing here walks the revision tree, and nothing needs to know which kind of
 * node it is looking at. That is deliberate: a tree walk would have to decide what
 * a failed intermediate node means, and it would break the moment a new branching
 * mode is added.
 *
 * Rows are written idempotently (unique `(asset_id, library_image_id)`), so
 * re-running propagation for the same output image cannot duplicate a timeline
 * entry.
 */

import { asc, eq, inArray } from "drizzle-orm";

import { assetLineage, assets, libraryImages, revisions } from "@/backend/db/schema";
import type { AssetLineage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { isUniqueViolation } from "../errors";

/**
 * Which assets does this image descend from? Union of "this image backs an asset"
 * and "this image has recorded lineage".
 *
 * @param ctx     Core context.
 * @param imageId A library image id.
 * @returns Distinct asset ids, in no particular order. Empty when the image has
 *          no asset ancestry (the normal case for an ad-hoc upload).
 * @example const ids = await assetIdsForImage(ctx, revision.inputImageId);
 */
export async function assetIdsForImage(ctx: CoreContext, imageId: string): Promise<string[]> {
  const [own, inherited] = await Promise.all([
    ctx.db.select({ id: assets.id }).from(assets).where(eq(assets.libraryImageId, imageId)),
    ctx.db
      .select({ id: assetLineage.assetId })
      .from(assetLineage)
      .where(eq(assetLineage.libraryImageId, imageId)),
  ]);
  return [...new Set([...own.map((r) => r.id), ...inherited.map((r) => r.id)])];
}

export interface RecordLineageInput {
  /** The produced image. */
  libraryImageId: string;
  /** Ancestor asset ids. An empty array is a no-op. */
  assetIds: string[];
  sessionUuid?: string | null;
  revisionId?: string | null;
}

/**
 * Record that an image descends from the given assets. Idempotent: a row that
 * already exists is left alone (the unique index is the arbiter, so two surfaces
 * recording concurrently cannot produce duplicates).
 *
 * @param ctx   Core context.
 * @param input The produced image, its ancestor assets, and optional provenance.
 * @returns How many NEW lineage rows were written.
 * @example await recordLineage(ctx, { libraryImageId: out.id, assetIds, revisionId });
 */
export async function recordLineage(
  ctx: CoreContext,
  input: RecordLineageInput,
): Promise<number> {
  if (input.assetIds.length === 0) return 0;

  let written = 0;
  for (const assetId of new Set(input.assetIds)) {
    try {
      await ctx.db.insert(assetLineage).values({
        assetId,
        libraryImageId: input.libraryImageId,
        sessionUuid: input.sessionUuid ?? null,
        revisionId: input.revisionId ?? null,
      });
      written += 1;
    } catch (err) {
      // Already recorded — the whole point of the unique index. Anything else is
      // a real failure (e.g. a RESTRICT violation) and must surface.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return written;
}

export interface PropagateLineageInput {
  /** The revision's input image — where the lineage is read from. */
  fromImageId: string;
  /** The revision's output image — where the lineage is written to. */
  toImageId: string;
  sessionUuid?: string | null;
  revisionId?: string | null;
}

/**
 * Carry an input image's asset ancestry onto the output image it produced. Called
 * from `markSucceeded`; safe to call when the input has no ancestry (no-op).
 *
 * @param ctx   Core context.
 * @param input Input image, output image, and optional session/revision provenance.
 * @returns The asset ids propagated (empty when the input had no ancestry).
 * @example
 * await propagateLineage(ctx, {
 *   fromImageId: rev.inputImageId, toImageId: rev.outputImageId,
 *   sessionUuid: rev.sessionUuid, revisionId: rev.id,
 * });
 */
export async function propagateLineage(
  ctx: CoreContext,
  input: PropagateLineageInput,
): Promise<string[]> {
  if (input.fromImageId === input.toImageId) return [];
  const assetIds = await assetIdsForImage(ctx, input.fromImageId);
  if (assetIds.length === 0) return [];
  await recordLineage(ctx, {
    libraryImageId: input.toImageId,
    assetIds,
    sessionUuid: input.sessionUuid ?? null,
    revisionId: input.revisionId ?? null,
  });
  return assetIds;
}

/** One entry on an asset's timeline: the image, where it lives, what made it. */
export interface AssetIteration {
  lineageId: string;
  libraryImageId: string;
  /** Short copyable handle of the produced image, or null on a legacy row. */
  publicId: string | null;
  deliveryUrl: string;
  /** The folder the produced image sits in — the grouping key. Null = library root. */
  folderId: string | null;
  /** The session that produced it, or null (prompt-only generation / archived). */
  sessionUuid: string | null;
  revisionId: string | null;
  /** The revision's display label ("rev2.1"), or null when there is no revision. */
  revLabel: string | null;
  /** Timeline ordering key. */
  createdAt: Date;
}

/**
 * Every iteration an asset ever produced, oldest first — the asset page's timeline.
 * Callers group by `folderId` (and/or `sessionUuid`) for display; the order within
 * any grouping is already the timeline order.
 *
 * @param ctx     Core context.
 * @param assetId The asset.
 * @param input   Optional paging (default 200 rows).
 * @returns Iteration rows, oldest first.
 * @example const timeline = await listAssetIterations(ctx, asset.id);
 */
export async function listAssetIterations(
  ctx: CoreContext,
  assetId: string,
  input?: { limit?: number; offset?: number },
): Promise<AssetIteration[]> {
  return ctx.db
    .select({
      lineageId: assetLineage.id,
      libraryImageId: assetLineage.libraryImageId,
      publicId: libraryImages.publicId,
      deliveryUrl: libraryImages.deliveryUrl,
      folderId: libraryImages.folderId,
      sessionUuid: assetLineage.sessionUuid,
      revisionId: assetLineage.revisionId,
      revLabel: revisions.revLabel,
      createdAt: assetLineage.createdAt,
    })
    .from(assetLineage)
    .innerJoin(libraryImages, eq(libraryImages.id, assetLineage.libraryImageId))
    .leftJoin(revisions, eq(revisions.id, assetLineage.revisionId))
    .where(eq(assetLineage.assetId, assetId))
    .orderBy(asc(assetLineage.createdAt))
    .limit(input?.limit ?? 200)
    .offset(input?.offset ?? 0);
}

/**
 * Raw lineage rows for several assets at once — for a list view that shows an
 * iteration count per asset without N queries.
 *
 * @param ctx      Core context.
 * @param assetIds The assets to fetch lineage for. Empty → empty result.
 * @returns All lineage rows for those assets, oldest first.
 */
export async function listLineageForAssets(
  ctx: CoreContext,
  assetIds: string[],
): Promise<AssetLineage[]> {
  if (assetIds.length === 0) return [];
  return ctx.db
    .select()
    .from(assetLineage)
    .where(inArray(assetLineage.assetId, assetIds))
    .orderBy(asc(assetLineage.createdAt));
}
