/**
 * @fileoverview MCP serialization: attach resolvable image URLs to every image
 * reference an MCP response carries, and produce MCP `image` content blocks for
 * the vision tools. One URL-construction point (`urlsFromRow`) feeds every
 * serializer — no per-endpoint ad-hoc URL building.
 *
 * URLs are PUBLIC Cloudflare Images delivery URLs (the account's images are the
 * user's home photos / design concepts — public links are acceptable here). If
 * that ever changes, swap `urlsFromRow` to sign the URLs and every serializer
 * follows.
 */

import { eq, inArray } from "drizzle-orm";

import { libraryImages } from "@/backend/db/schema";
import type { LibraryImage, Mask, Revision, Session } from "@/backend/db/schema";
import {
  arrayBufferToBase64,
  buildVariantUrl,
  IMAGE_VARIANTS,
  listSessionReferences,
  requireImage,
  requireMask,
  requireRevision,
  variantUrl,
} from "@/backend/core";
import type { CoreContext, RevisionTreeNode, SessionTree } from "@/backend/core";
import { getImagesAccountHash } from "@/backend/utils/secrets";

export interface ImageUrls {
  /** ~512px variant for quick inspection (null for video). */
  thumbUrl: string | null;
  /** Full-size delivery URL. */
  imageUrl: string | null;
  /**
   * The short copyable handle (`img_…`), or null on a row that predates the
   * column. Carried alongside the URLs so a model can refer to the image by the
   * SAME id the user sees and copies in the UI.
   */
  publicId: string | null;
}

const EMPTY: ImageUrls = { thumbUrl: null, imageUrl: null, publicId: null };

type UrlRow = Pick<LibraryImage, "cfImageId" | "mediaType" | "deliveryUrl" | "publicId">;

/**
 * THE single URL-construction point. Images resolve to thumb+full CF Images
 * variants; video resolves to its (absolutised) worker delivery route.
 */
function urlsFromRow(hash: string, base: string, row: UrlRow): ImageUrls {
  if (row.mediaType === "video") {
    const u = row.deliveryUrl
      ? row.deliveryUrl.startsWith("http")
        ? row.deliveryUrl
        : `${base}${row.deliveryUrl}`
      : null;
    return { thumbUrl: null, imageUrl: u, publicId: row.publicId };
  }
  if (!row.cfImageId) return { ...EMPTY, publicId: row.publicId };
  return {
    thumbUrl: buildVariantUrl(hash, row.cfImageId, IMAGE_VARIANTS.THUMB),
    imageUrl: buildVariantUrl(hash, row.cfImageId, IMAGE_VARIANTS.FULL),
    publicId: row.publicId,
  };
}

/**
 * Batch-resolve a set of library-image ids to their URLs. One D1 read + one
 * account-hash lookup. A missing account hash degrades to empty URLs rather than
 * throwing — a read (e.g. get_session_tree) must still return its structure.
 */
export async function resolveImageUrls(
  ctx: CoreContext,
  ids: Array<string | null | undefined>,
  base: string,
): Promise<Map<string, ImageUrls>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, ImageUrls>();
  if (uniq.length === 0) return map;

  const rows = await ctx.db
    .select({
      id: libraryImages.id,
      cfImageId: libraryImages.cfImageId,
      mediaType: libraryImages.mediaType,
      deliveryUrl: libraryImages.deliveryUrl,
      publicId: libraryImages.publicId,
    })
    .from(libraryImages)
    .where(inArray(libraryImages.id, uniq));

  const hash = await getImagesAccountHash(ctx.env);
  // No account hash → no URLs, but the public id is stored on the row and is
  // still the caller's handle, so never drop it with the URLs.
  for (const r of rows) map.set(r.id, hash ? urlsFromRow(hash, base, r) : { ...EMPTY, publicId: r.publicId });
  return map;
}

/** reference_image_ids live inside a revision's editPayload (multi-image edits). */
function refIds(rev: Revision): string[] {
  const p = rev.editPayload as { reference_image_ids?: unknown } | null;
  return Array.isArray(p?.reference_image_ids)
    ? (p!.reference_image_ids.filter((x) => typeof x === "string") as string[])
    : [];
}

/**
 * Decorate the session tree so every image id (seed, each attempt's input +
 * output, and any multi-image reference set) carries `thumbUrl`/`imageUrl`.
 */
export async function serializeSessionTree(
  ctx: CoreContext,
  tree: SessionTree,
  base: string,
): Promise<unknown> {
  const ids: Array<string | null> = [];
  for (const n of tree.nodes)
    for (const a of n.attempts) {
      ids.push(a.inputImageId, a.outputImageId, ...refIds(a));
    }
  const map = await resolveImageUrls(ctx, ids, base);
  // Role lives on the session pool (session_images), not the revision — join it
  // so each reference surfaces its base/object/style role alongside its URL.
  const roleMap = new Map(
    (await listSessionReferences(ctx, tree.sessionUuid)).map((r) => [r.image.id, r.role]),
  );

  const decorate = (r: Revision) => ({
    ...r,
    inputImageUrls: (r.inputImageId && map.get(r.inputImageId)) || EMPTY,
    outputImageUrls: (r.outputImageId && map.get(r.outputImageId)) || EMPTY,
    referenceImageUrls: refIds(r).map((id) => ({
      imageId: id,
      role: roleMap.get(id) ?? null,
      ...(map.get(id) ?? EMPTY),
    })),
  });
  const node = (n: RevisionTreeNode): unknown => ({
    ...n,
    attempts: n.attempts.map(decorate),
    latest: decorate(n.latest),
    children: n.children.map(node),
  });

  return {
    sessionUuid: tree.sessionUuid,
    root: tree.root ? node(tree.root) : null,
    nodes: tree.nodes.map(node),
  };
}

/** Attach the origin image's URLs to each session row. */
export async function serializeSessions(
  ctx: CoreContext,
  rows: Session[],
  base: string,
): Promise<unknown[]> {
  const map = await resolveImageUrls(ctx, rows.map((s) => s.originLibraryImageId), base);
  return rows.map((s) => ({
    ...s,
    originImageUrls: (s.originLibraryImageId && map.get(s.originLibraryImageId)) || EMPTY,
  }));
}

/** Attach thumb/full URLs to each library image row (rows already in hand). */
export async function serializeLibrary(
  ctx: CoreContext,
  rows: LibraryImage[],
  base: string,
): Promise<unknown[]> {
  const hash = await getImagesAccountHash(ctx.env);
  // `public_id` is emitted in snake_case alongside the row's own camelCase
  // `publicId` because MCP callers read the snake_case contract (§4.2).
  return rows.map((r) => ({
    ...r,
    ...(hash ? urlsFromRow(hash, base, r) : { ...EMPTY, publicId: r.publicId }),
    public_id: r.publicId,
  }));
}

// ---------------------------------------------------------------------------
// Part 2: inline image content for MCP vision
// ---------------------------------------------------------------------------

export interface McpImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * The inline image block PLUS the public CF Images URLs for the same image, so
 * a client can ingest the bytes directly OR fetch the URL — whichever is more
 * native to it.
 */
export interface McpImageResult {
  image: McpImageBlock;
  imageUrl: string | null;
  thumbUrl: string | null;
}

/** Raw-byte cap so a response never blows the MCP message limit. base64 ≈ +33%. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Fetch a library image's bytes (the resized variant, thumb by default),
 * base64-encode, and return an MCP `image` content block. Fetches the public
 * variant URL server-side so the client gets pixels it can actually render.
 */
export async function imageContentBlock(
  ctx: CoreContext,
  imageId: string,
  variant: "thumb" | "full",
): Promise<McpImageResult> {
  const row = await requireImage(ctx, imageId);
  if (row.mediaType === "video") {
    throw new Error(`Asset ${imageId} is a video; these tools return still images only.`);
  }
  if (!row.cfImageId) throw new Error(`Image ${imageId} has no Cloudflare Images id.`);

  const hash = await getImagesAccountHash(ctx.env);
  if (!hash) throw new Error("CLOUDFLARE_IMAGES_ACCOUNT_HASH unresolved.");
  const imageUrl = buildVariantUrl(hash, row.cfImageId, IMAGE_VARIANTS.FULL);
  const thumbUrl = buildVariantUrl(hash, row.cfImageId, IMAGE_VARIANTS.THUMB);

  const v = variant === "full" ? IMAGE_VARIANTS.FULL : IMAGE_VARIANTS.THUMB;
  const url = variant === "full" ? imageUrl : thumbUrl;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${v} variant for image ${imageId} (HTTP ${res.status}).`);

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image ${v} variant is ${(buf.byteLength / 1e6).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / 1e6}MB MCP cap. Use variant:"thumb".`,
    );
  }
  const mimeType = res.headers.get("content-type")?.split(";")[0] || row.contentType || "image/png";
  return {
    image: { type: "image", data: arrayBufferToBase64(buf), mimeType },
    imageUrl,
    thumbUrl,
  };
}

/** A mask row decorated with its preview URLs. */
export interface McpMaskResult extends Mask {
  /** ~512px variant of the painted raster mask (null for geometry-only masks). */
  maskThumbUrl: string | null;
  /** Full-size variant of the painted raster mask. */
  maskImageUrl: string | null;
  /** URLs for the image the mask is drawn over. */
  sourceImageUrls: ImageUrls;
}

/** Decorate masks with their preview URLs (the raster mask + the source image)
 * so ids + previews are visible in list_masks. `cfImageId` on a mask is a raw CF
 * Images id (not a library row), so build variant URLs directly. */
export async function serializeMasks(
  ctx: CoreContext,
  rows: Mask[],
  base: string,
): Promise<McpMaskResult[]> {
  const hash = await getImagesAccountHash(ctx.env);
  const srcMap = await resolveImageUrls(ctx, rows.map((m) => m.sourceImageId), base);
  return rows.map((m) => ({
    ...m,
    maskThumbUrl: m.cfImageId && hash ? buildVariantUrl(hash, m.cfImageId, IMAGE_VARIANTS.THUMB) : null,
    maskImageUrl: m.cfImageId && hash ? buildVariantUrl(hash, m.cfImageId, IMAGE_VARIANTS.FULL) : null,
    sourceImageUrls: (m.sourceImageId && srcMap.get(m.sourceImageId)) || EMPTY,
  }));
}

/**
 * Return an MCP image block showing a mask for user confirmation: the source
 * image with the raster mask drawn over it (semi-transparent) via CF Images.
 * Falls back to the raw mask raster, then to the source image, so it always
 * returns something viewable.
 */
export async function maskImageBlock(ctx: CoreContext, maskId: string): Promise<McpImageResult> {
  const mask = await requireMask(ctx, maskId);
  if (!mask.cfImageId) {
    // Geometry-only mask (bbox/polygon/semantic): no raster to overlay — show the
    // source so the model has context (the geometry is in list_masks/describe_mask).
    return imageContentBlock(ctx, mask.sourceImageId, "thumb");
  }
  // Public URLs for the raw mask raster (the composite itself isn't persisted).
  const hash = await getImagesAccountHash(ctx.env);
  const imageUrl = hash ? buildVariantUrl(hash, mask.cfImageId, IMAGE_VARIANTS.FULL) : null;
  const thumbUrl = hash ? buildVariantUrl(hash, mask.cfImageId, IMAGE_VARIANTS.THUMB) : null;

  const [src] = await ctx.db
    .select({ cfImageId: libraryImages.cfImageId })
    .from(libraryImages)
    .where(eq(libraryImages.id, mask.sourceImageId))
    .limit(1);

  if (src?.cfImageId) {
    try {
      const srcStream = await ctx.env.IMAGES.hosted.image(src.cfImageId).bytes();
      const maskStream = await ctx.env.IMAGES.hosted.image(mask.cfImageId).bytes();
      if (srcStream != null && maskStream != null) {
        const result = await ctx.env.IMAGES.input(srcStream)
          .draw(ctx.env.IMAGES.input(maskStream), { opacity: 0.55 })
          .output({ format: "image/png" });
        const buf = await result.response().arrayBuffer();
        if (buf.byteLength <= MAX_IMAGE_BYTES) {
          return { image: { type: "image", data: arrayBufferToBase64(buf), mimeType: "image/png" }, imageUrl, thumbUrl };
        }
      }
    } catch (e) {
      console.error(`[mcp] mask composite failed for ${maskId}:`, e instanceof Error ? e.message : String(e));
      // Fall back to the raw mask raster below.
    }
  }
  const url = await variantUrl(ctx.env, mask.cfImageId, IMAGE_VARIANTS.FULL);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mask raster for ${maskId} (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Mask raster is ${(buf.byteLength / 1e6).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / 1e6}MB MCP cap.`,
    );
  }
  return {
    image: {
      type: "image",
      data: arrayBufferToBase64(buf),
      mimeType: res.headers.get("content-type")?.split(";")[0] || "image/png",
    },
    imageUrl,
    thumbUrl,
  };
}

/** Resolve a revision's input/output image id and return its content block + URLs. */
export async function revisionImageBlock(
  ctx: CoreContext,
  revisionId: string,
  which: "output" | "input",
  variant: "thumb" | "full",
): Promise<McpImageResult> {
  const rev = await requireRevision(ctx, revisionId);
  const imageId = which === "input" ? rev.inputImageId : rev.outputImageId;
  if (!imageId) {
    throw new Error(`Revision ${rev.id} has no ${which} image (status=${rev.status}).`);
  }
  return imageContentBlock(ctx, imageId, variant);
}
