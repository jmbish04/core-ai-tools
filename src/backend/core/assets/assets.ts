/**
 * @fileoverview Asset library operations: create (from a directly-uploaded
 * image), promote (copy an existing library image into an asset, keeping a trace
 * back), read, update, archive.
 *
 * Promotion COPIES the `library_images` row rather than pointing at the original.
 * The copy shares the Cloudflare Images id — no bytes move, nothing is re-uploaded
 * — but it gets its own row id, its own short public id, and its own metadata, and
 * `assets.promoted_from_image_id` records where it came from. That separation is
 * what keeps lineage honest: iterations produced from the ASSET are attributed to
 * the asset, and iterations produced from the original image (in some unrelated
 * session) are not.
 *
 * Assets are never hard-deleted — `archived_at` only — because `asset_lineage`
 * rows reference them with ON DELETE RESTRICT.
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { assets, libraryImages } from "@/backend/db/schema";
import type { Asset, LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { requireImage } from "../library/images";
import { recordLineage } from "./lineage";

/** Human metadata carried by an asset (all optional, all editable). */
export interface AssetMetadataInput {
  description?: string | null;
  usageInstructions?: string | null;
  contextText?: string | null;
}

export interface CreateAssetInput extends AssetMetadataInput {
  /** An already-registered library image — the asset's backing bytes identity. */
  libraryImageId: string;
  /** Display name. Falls back to the image's title, then its filename. */
  name?: string | null;
}

/**
 * Wrap an already-registered library image as an asset. This is the path for an
 * asset that was uploaded directly: the upload registers the image, this makes it
 * an asset. Records the asset's own image as lineage depth zero, so the asset's
 * timeline starts with the asset itself.
 *
 * @param ctx   Core context.
 * @param input The backing image id, an optional name, and optional metadata.
 * @returns The new asset row.
 * @throws NotFoundError when the backing image does not exist / is soft-deleted.
 * @throws ValidationError when no name can be derived.
 * @throws ConflictError when that image is already an asset.
 * @example const asset = await createAsset(ctx, { libraryImageId: img.id, name: "Walnut slab" });
 */
export async function createAsset(ctx: CoreContext, input: CreateAssetInput): Promise<Asset> {
  const image = await requireImage(ctx, input.libraryImageId);
  const name = deriveName(input.name, image);

  const existing = await findAssetForImage(ctx, input.libraryImageId);
  if (existing) {
    throw new ConflictError(`Image ${input.libraryImageId} is already asset ${existing.id}.`, {
      assetId: existing.id,
    });
  }

  const [row] = await ctx.db
    .insert(assets)
    .values({
      name,
      libraryImageId: input.libraryImageId,
      promotedFromImageId: null,
      description: input.description ?? image.description ?? null,
      usageInstructions: input.usageInstructions ?? image.usageInstructions ?? null,
      contextText: input.contextText ?? image.contextText ?? null,
    })
    .returning();

  // The asset's own image is iteration zero of its own timeline.
  await recordLineage(ctx, { libraryImageId: row.libraryImageId, assetIds: [row.id] });
  return row;
}

export interface PromoteImageInput extends AssetMetadataInput {
  /** The existing library image to promote. */
  imageId: string;
  /** Display name for the asset. Falls back to the image's title/filename. */
  name?: string | null;
  /** Folder for the copied image row; defaults to the original's folder. */
  folderId?: string | null;
}

export interface PromoteImageResult {
  asset: Asset;
  /** The COPIED library image row backing the asset (new id, same cf_image_id). */
  libraryImage: LibraryImage;
}

/**
 * Promote an existing library image into an asset. The image row is copied (same
 * Cloudflare Images object, new row, fresh public id) and the asset records
 * `promoted_from_image_id` — the trace back to the original.
 *
 * @param ctx   Core context.
 * @param input The source image id plus optional name/metadata/folder.
 * @returns The new asset and the copied image row backing it.
 * @throws NotFoundError when the source image does not exist / is soft-deleted.
 * @throws ValidationError when no name can be derived.
 * @example const { asset } = await promoteImageToAsset(ctx, { imageId: img.id });
 */
export async function promoteImageToAsset(
  ctx: CoreContext,
  input: PromoteImageInput,
): Promise<PromoteImageResult> {
  const source = await requireImage(ctx, input.imageId);
  const name = deriveName(input.name, source);

  // Copy the row: same bytes identity, new row identity. publicId is NOT copied —
  // the column default mints a fresh one, which the unique index requires anyway.
  const [copy] = await ctx.db
    .insert(libraryImages)
    .values({
      cfImageId: source.cfImageId,
      deliveryUrl: source.deliveryUrl,
      folderId: input.folderId !== undefined ? input.folderId : source.folderId,
      originalFilename: source.originalFilename,
      title: source.title ?? name,
      description: input.description ?? source.description,
      usageInstructions: input.usageInstructions ?? source.usageInstructions,
      contextText: input.contextText ?? source.contextText,
      role: source.role,
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

  const [asset] = await ctx.db
    .insert(assets)
    .values({
      name,
      libraryImageId: copy.id,
      promotedFromImageId: source.id,
      description: input.description ?? source.description ?? null,
      usageInstructions: input.usageInstructions ?? source.usageInstructions ?? null,
      contextText: input.contextText ?? source.contextText ?? null,
    })
    .returning();

  await recordLineage(ctx, { libraryImageId: copy.id, assetIds: [asset.id] });
  return { asset, libraryImage: copy };
}

/**
 * Update an asset's name and/or metadata. Only the keys present are touched;
 * `null` clears a metadata field.
 *
 * @throws NotFoundError when the asset does not exist.
 * @throws ValidationError when nothing was supplied, or the name is blank.
 */
export async function updateAsset(
  ctx: CoreContext,
  input: { assetId: string; name?: string } & AssetMetadataInput,
): Promise<Asset> {
  await requireAsset(ctx, input.assetId);

  const trim = (v: string | null | undefined) => {
    const t = v?.trim();
    return t ? t : null;
  };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("name" in input) {
    const name = input.name?.trim();
    if (!name) throw new ValidationError("Asset name cannot be empty.");
    patch.name = name;
  }
  if ("description" in input) patch.description = trim(input.description);
  if ("usageInstructions" in input) patch.usageInstructions = trim(input.usageInstructions);
  if ("contextText" in input) patch.contextText = trim(input.contextText);

  if (Object.keys(patch).length === 1) throw new ValidationError("No asset fields supplied.");

  const [row] = await ctx.db
    .update(assets)
    .set(patch)
    .where(eq(assets.id, input.assetId))
    .returning();
  return row;
}

/**
 * Archive an asset (sets `archived_at`). Idempotent. Never a hard delete —
 * `asset_lineage` references this row with ON DELETE RESTRICT, and the iterations
 * it produced remain history.
 *
 * @throws NotFoundError when the asset does not exist.
 */
export async function archiveAsset(ctx: CoreContext, assetId: string): Promise<Asset> {
  await requireAsset(ctx, assetId, { includeArchived: true });
  const [row] = await ctx.db
    .update(assets)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .returning();
  return row;
}

/** Un-archive an asset. Idempotent. */
export async function restoreAsset(ctx: CoreContext, assetId: string): Promise<Asset> {
  await requireAsset(ctx, assetId, { includeArchived: true });
  const [row] = await ctx.db
    .update(assets)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(assets.id, assetId))
    .returning();
  return row;
}

/**
 * List assets, newest first. Archived assets are excluded unless asked for.
 *
 * @param ctx   Core context.
 * @param input Optional paging and `includeArchived`.
 * @returns Asset rows, newest first.
 */
export async function listAssets(
  ctx: CoreContext,
  input?: { includeArchived?: boolean; limit?: number; offset?: number },
): Promise<AssetWithImage[]> {
  const base = ctx.db
    .select({
      asset: assets,
      imageId: libraryImages.id,
      publicId: libraryImages.publicId,
      deliveryUrl: libraryImages.deliveryUrl,
      imageTitle: libraryImages.title,
    })
    .from(assets)
    .innerJoin(libraryImages, eq(assets.libraryImageId, libraryImages.id));
  const query = input?.includeArchived ? base : base.where(isNull(assets.archivedAt));
  const rows = await query
    .orderBy(desc(assets.createdAt))
    .limit(input?.limit ?? 100)
    .offset(input?.offset ?? 0);
  return rows.map(withImage);
}

/** An asset plus the picture it stands for. */
export interface AssetWithImage extends Asset {
  image: {
    id: string;
    publicId: string | null;
    deliveryUrl: string;
    title: string | null;
  };
}

/** Shape a joined row into the asset + image pair every surface consumes. */
function withImage(row: {
  asset: Asset;
  imageId: string;
  publicId: string | null;
  deliveryUrl: string;
  imageTitle: string | null;
}): AssetWithImage {
  return {
    ...row.asset,
    image: {
      id: row.imageId,
      publicId: row.publicId,
      deliveryUrl: row.deliveryUrl,
      title: row.imageTitle,
    },
  };
}

/**
 * The asset backed by (or promoted from) a given library image, or null. Used to
 * show "this image is asset X" in the library and to refuse a double promotion.
 */
export async function findAssetForImage(
  ctx: CoreContext,
  imageId: string,
): Promise<Asset | null> {
  const [row] = await ctx.db
    .select()
    .from(assets)
    .where(eq(assets.libraryImageId, imageId))
    .limit(1);
  return row ?? null;
}

/**
 * Fetch an asset or throw. Archived assets are hidden unless `includeArchived`.
 *
 * @throws NotFoundError when no matching asset exists.
 */
export async function requireAsset(
  ctx: CoreContext,
  assetId: string,
  opts?: { includeArchived?: boolean },
): Promise<Asset> {
  const where = opts?.includeArchived
    ? eq(assets.id, assetId)
    : and(eq(assets.id, assetId), isNull(assets.archivedAt));
  const [row] = await ctx.db.select().from(assets).where(where).limit(1);
  if (!row) throw new NotFoundError(`Asset ${assetId} not found.`);
  return row;
}

/** Name an asset from the caller's value, else the image's title, else filename. */
function deriveName(name: string | null | undefined, image: LibraryImage): string {
  const derived = name?.trim() || image.title?.trim() || image.originalFilename?.trim();
  if (!derived) {
    throw new ValidationError(
      "An asset name is required (the backing image has no title or filename to derive one from).",
    );
  }
  return derived;
}
