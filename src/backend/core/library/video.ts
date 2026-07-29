/**
 * @fileoverview Video assets on R2 + application-managed TTL. Video bytes live in
 * `R2_VIDEO_BUCKET` (Cloudflare Images can't store video); the `library_images`
 * row (media_type='video') holds the metadata + R2 key + TTL.
 *
 * TWO-STATE deletion (preserves the replay guarantee):
 *  - `deleted_at` — soft delete (unchanged semantics). Never set by the sweep.
 *  - `bytes_purged_at` — the R2 object is gone, the row + all metadata survive, so
 *    the revision stays replayable AS AN INSTRUCTION (regenerate) even though the
 *    artifact is gone. The purge sweep sets only this; it never touches CF Images.
 *
 * TTL is application-managed in D1 (R2 lifecycle rules are prefix-scoped and can't
 * express per-object user-mutable expiry). Absolute, not sliding. Pinning a
 * revision protects its video (clears expiry). The delivery URL is the Worker
 * route `/api/video/:asset_id` (Range-capable, 410 on purge — see the API phase).
 */

import { and, between, eq, isNotNull, isNull, lt } from "drizzle-orm";

import { libraryImages, revisions } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { EventType } from "../events";
import { NotFoundError, ValidationError } from "../errors";

/** Default video TTL. Null TTL = never expires. */
export const DEFAULT_VIDEO_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UploadVideoInput {
  folderId?: string | null;
  originalFilename?: string | null;
  contentType?: string | null;
  durationMs?: number | null;
  bytes?: number | null;
  /** TTL in days; null = never expires; omitted = DEFAULT_VIDEO_TTL_DAYS. */
  ttlDays?: number | null;
  uploadedVia?: "ui" | "api" | "mcp";
}

/** Store video bytes in R2 and register the asset row. */
export async function uploadVideoAsset(
  ctx: CoreContext,
  videoBytes: ArrayBuffer | ReadableStream<Uint8Array>,
  input: UploadVideoInput = {},
): Promise<LibraryImage> {
  const r2Key = `videos/${crypto.randomUUID()}`;
  await ctx.env.R2_VIDEO_BUCKET.put(r2Key, videoBytes);

  const ttlDays = input.ttlDays === undefined ? DEFAULT_VIDEO_TTL_DAYS : input.ttlDays;
  const expiresAt = ttlDays === null ? null : new Date(Date.now() + ttlDays * DAY_MS);

  const [row] = await ctx.db
    .insert(libraryImages)
    .values({
      cfImageId: "", // not applicable to video (bytes in R2)
      deliveryUrl: "", // patched to the worker route below (needs the id)
      folderId: input.folderId ?? null,
      originalFilename: input.originalFilename ?? null,
      contentType: input.contentType ?? "video/mp4",
      bytes: input.bytes ?? null,
      kind: "generated",
      uploadedVia: input.uploadedVia ?? "api",
      mediaType: "video",
      storage: "r2",
      r2Key,
      durationMs: input.durationMs ?? null,
      expiresAt,
      ttlDays,
    })
    .returning();

  const [patched] = await ctx.db
    .update(libraryImages)
    .set({ deliveryUrl: `/api/video/${row.id}` })
    .where(eq(libraryImages.id, row.id))
    .returning();
  return patched;
}

/** Set/clear a video's TTL from any surface. `ttlDays = null` clears expiry (never). */
export async function setAssetTtl(
  ctx: CoreContext,
  input: { assetId: string; ttlDays: number | null; surface?: "ui" | "api" | "mcp" },
): Promise<LibraryImage> {
  const asset = await requireVideoAsset(ctx, input.assetId);
  if (input.ttlDays !== null && input.ttlDays <= 0) {
    throw new ValidationError("ttlDays must be a positive number or null (never).");
  }
  const now = new Date();
  const expiresAt = input.ttlDays === null ? null : new Date(now.getTime() + input.ttlDays * DAY_MS);
  const [row] = await ctx.db
    .update(libraryImages)
    .set({
      ttlDays: input.ttlDays,
      expiresAt,
      ttlSetBySurface: input.surface ?? null,
      ttlUpdatedAt: now,
    })
    .where(eq(libraryImages.id, asset.id))
    .returning();
  return row;
}

/** Pinning a revision protects its video output — clears expiry (see spec §8). */
export async function clearVideoExpiryForOutput(
  ctx: CoreContext,
  outputImageId: string,
): Promise<void> {
  await ctx.db
    .update(libraryImages)
    .set({ expiresAt: null, ttlDays: null, ttlUpdatedAt: new Date() })
    .where(and(eq(libraryImages.id, outputImageId), eq(libraryImages.mediaType, "video")));
}

/** Videos expiring within `days` (default 7) and not yet purged — the warn band. */
export async function videosExpiringSoon(
  ctx: CoreContext,
  days = 7,
  now: Date = new Date(),
): Promise<LibraryImage[]> {
  const soon = new Date(now.getTime() + days * DAY_MS);
  return ctx.db
    .select()
    .from(libraryImages)
    .where(
      and(
        eq(libraryImages.mediaType, "video"),
        isNull(libraryImages.bytesPurgedAt),
        isNotNull(libraryImages.expiresAt),
        between(libraryImages.expiresAt, now, soon),
      ),
    );
}

/**
 * Purge sweep (rides the cron): delete the R2 object of every expired, unpurged
 * video, set `bytes_purged_at`, and log a purge event to `revision_events` for
 * each revision that output it. Never touches `deleted_at` or CF Images. Returns
 * the count purged.
 */
export async function sweepExpiredVideos(ctx: CoreContext, now: Date = new Date()): Promise<number> {
  const expired = await ctx.db
    .select()
    .from(libraryImages)
    .where(
      and(
        eq(libraryImages.mediaType, "video"),
        isNull(libraryImages.bytesPurgedAt),
        isNotNull(libraryImages.expiresAt),
        lt(libraryImages.expiresAt, now),
      ),
    );

  for (const asset of expired) {
    if (asset.r2Key) await ctx.env.R2_VIDEO_BUCKET.delete(asset.r2Key).catch(() => undefined);
    await ctx.db
      .update(libraryImages)
      .set({ bytesPurgedAt: now })
      .where(eq(libraryImages.id, asset.id));

    // Audit: emit a purge event to every session whose revision output this asset.
    const outputs = await ctx.db
      .select({ id: revisions.id, sessionUuid: revisions.sessionUuid })
      .from(revisions)
      .where(eq(revisions.outputImageId, asset.id));
    for (const rev of outputs) {
      await ctx.events
        .appendEvent(rev.sessionUuid, {
          type: EventType.RevisionStatusChanged,
          revisionId: rev.id,
          payload: { assetId: asset.id, event: "video_bytes_purged", purgedAt: now.getTime() },
        })
        .catch(() => undefined);
    }
  }
  return expired.length;
}

async function requireVideoAsset(ctx: CoreContext, assetId: string): Promise<LibraryImage> {
  const [row] = await ctx.db
    .select()
    .from(libraryImages)
    .where(and(eq(libraryImages.id, assetId), eq(libraryImages.mediaType, "video")))
    .limit(1);
  if (!row) throw new NotFoundError(`Video asset ${assetId} not found.`);
  return row;
}
