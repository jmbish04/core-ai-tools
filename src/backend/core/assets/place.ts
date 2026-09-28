/**
 * @fileoverview Placing an asset into a folder.
 *
 * The inverse of promotion. Promotion takes a folder's image and makes it a
 * reusable asset; this takes a reusable asset and drops a working copy into a
 * folder so a session can be started from it there.
 *
 * It COPIES the image row for the same reason promotion does: the copy shares the
 * Cloudflare Images object (no bytes move, nothing is re-uploaded) but gets its
 * own row id and its own short public id. Moving the asset's own backing row into
 * the folder would move the ASSET — the asset page would follow the image around
 * the tree, and two projects could not work from one asset at the same time.
 *
 * The copy is recorded as descending from the asset, plus every asset the asset's
 * own image already descended from, so `list_asset_iterations` picks up
 * everything later generated from this copy without any tree walking. That is the
 * same one rule `markSucceeded` follows.
 */

import { eq } from "drizzle-orm";

import { libraryImages } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { notifyFolder } from "../library/notify";
import { requireFolder } from "../library/folders";
import { requireAsset } from "./assets";
import { assetIdsForImage, recordLineage } from "./lineage";

export interface PlaceAssetInput {
  assetId: string;
  /** Destination folder. `null` is the library root, which has no realtime channel. */
  folderId: string | null;
  /** Override the copy's role in this folder. Defaults to the asset image's own. */
  role?: "base" | "reference" | "inject" | null;
  /** What this copy is for here — the note the prompt builder reads. */
  usageInstructions?: string | null;
}

export interface PlaceAssetResult {
  /** The new `library_images` row: same bytes, new identity, in the folder. */
  image: LibraryImage;
  /** The assets the new row descends from, the placed asset included. */
  assetIds: string[];
}

/**
 * Drop a working copy of an asset into a folder.
 *
 * @param ctx   Core context.
 * @param input The asset, the destination folder, and optional per-copy metadata.
 * @returns The new image row and the assets it descends from.
 * @throws NotFoundError when the asset is missing or archived, or the folder does
 *   not exist.
 * @example const { image } = await placeAssetInFolder(ctx, { assetId, folderId });
 */
export async function placeAssetInFolder(
  ctx: CoreContext,
  input: PlaceAssetInput,
): Promise<PlaceAssetResult> {
  const asset = await requireAsset(ctx, input.assetId);
  if (input.folderId) await requireFolder(ctx, input.folderId);

  const [source] = await ctx.db
    .select()
    .from(libraryImages)
    .where(eq(libraryImages.id, asset.libraryImageId))
    .limit(1);

  // `publicId` is deliberately NOT copied: the column default mints a fresh one,
  // which the unique index requires anyway, and the short handle is how a user
  // refers to THIS copy in a prompt.
  const [image] = await ctx.db
    .insert(libraryImages)
    .values({
      cfImageId: source.cfImageId,
      deliveryUrl: source.deliveryUrl,
      folderId: input.folderId,
      originalFilename: source.originalFilename,
      title: source.title ?? asset.name,
      description: source.description,
      usageInstructions:
        input.usageInstructions !== undefined
          ? (input.usageInstructions?.trim() || null)
          : (asset.usageInstructions ?? source.usageInstructions),
      contextText: asset.contextText ?? source.contextText,
      role: input.role !== undefined ? input.role : source.role,
      contentType: source.contentType,
      width: source.width,
      height: source.height,
      bytes: source.bytes,
      kind: source.kind,
      uploadedVia: source.uploadedVia,
      mediaType: source.mediaType,
      storage: source.storage,
      r2Key: source.r2Key,
      durationMs: source.durationMs,
    })
    .returning();

  // Everything the asset's own image descends from, plus the asset itself. The
  // asset is added explicitly rather than relied upon: `createAsset` records the
  // asset's image at depth zero, but a promoted asset's copy is only reachable
  // through the asset id.
  const assetIds = [...new Set([...(await assetIdsForImage(ctx, asset.libraryImageId)), asset.id])];
  await recordLineage(ctx, { libraryImageId: image.id, assetIds });

  if (image.folderId) {
    await notifyFolder(ctx, {
      type: "image_added",
      folderId: image.folderId,
      imageId: image.id,
    });
  }

  return { image, assetIds };
}
