/**
 * @fileoverview Lightweight image ingest — register an image into the library
 * from a URL or base64 and get back a library id. Three sources:
 *   - a Cloudflare Images delivery URL (imagedelivery.net/<hash>/<id>/<variant>):
 *     parse the id and register it directly (no re-upload); dedup on cf_image_id.
 *   - any other http(s) image URL: fetch the bytes and re-host to Cloudflare Images.
 *   - a base64 blob (e.g. supplied over MCP): decode and upload.
 *
 * This is the on-ramp for reference images (a raw slab URL → an id `submit_edit`
 * can reference). Keeps `registerImage` (pure persist) underneath.
 */

import { and, eq, isNull } from "drizzle-orm";

import { libraryImages } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ValidationError } from "../errors";
import { uploadImageBytes } from "../images/hosted";
import { variantUrl } from "../images/variants";
import { registerImage, type UploadedVia } from "./images";

/** Extract the cf image id from an imagedelivery.net URL, or null if not one. */
export function parseCfImagesUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "imagedelivery.net") return null;
  // Path is /<accountHash>/<imageId>/<variant>. The id is the 2nd segment.
  const segments = u.pathname.split("/").filter(Boolean);
  return segments.length >= 2 ? segments[1] : null;
}

/** Decode a base64 string (with or without a data: prefix) to bytes. */
function base64ToBytes(b64: string): ArrayBuffer {
  const comma = b64.indexOf(",");
  const raw = b64.startsWith("data:") && comma >= 0 ? b64.slice(comma + 1) : b64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface IngestImageInput {
  /** Exactly one of these three identifies the source. */
  cfImagesUrl?: string | null;
  imageUrl?: string | null;
  base64?: string | null;
  /** Caption / provenance stored on the library row and used as reference context. */
  description?: string | null;
  folderId?: string | null;
  uploadedVia?: UploadedVia;
}

/**
 * Register an image from a URL or base64 and return its library row. A
 * Cloudflare Images URL is registered by id (deduped, no re-upload); any other
 * URL or a base64 blob is re-hosted to Cloudflare Images first.
 */
export async function registerImageFromSource(
  ctx: CoreContext,
  input: IngestImageInput,
): Promise<LibraryImage> {
  const uploadedVia = input.uploadedVia ?? "mcp";

  // 1. Cloudflare Images URL — register by id, deduping on an existing live row.
  if (input.cfImagesUrl) {
    const cfImageId = parseCfImagesUrl(input.cfImagesUrl);
    if (!cfImageId) {
      throw new ValidationError(
        `Not a Cloudflare Images delivery URL: ${input.cfImagesUrl}. Use imageUrl for arbitrary hosts.`,
      );
    }
    const [existing] = await ctx.db
      .select()
      .from(libraryImages)
      .where(and(eq(libraryImages.cfImageId, cfImageId), isNull(libraryImages.deletedAt)))
      .limit(1);
    if (existing) return existing;

    return registerImage(ctx, {
      cfImageId,
      deliveryUrl: await variantUrl(ctx.env, cfImageId, "full"),
      description: input.description ?? null,
      folderId: input.folderId ?? null,
      kind: "stock",
      uploadedVia,
    });
  }

  // 2. Arbitrary URL — fetch and re-host.
  if (input.imageUrl) {
    let res: Response;
    try {
      res = await fetch(input.imageUrl);
    } catch (err) {
      throw new ValidationError(`Failed to fetch ${input.imageUrl}: ${(err as Error)?.message ?? err}`);
    }
    if (!res.ok) throw new ValidationError(`Fetch ${input.imageUrl} returned ${res.status}.`);
    const contentType = res.headers.get("content-type");
    if (contentType && !contentType.startsWith("image/")) {
      throw new ValidationError(`${input.imageUrl} is not an image (content-type: ${contentType}).`);
    }
    const bytes = await res.arrayBuffer();
    const up = await uploadImageBytes(ctx.env, bytes, { filename: input.description ?? undefined });
    return registerImage(ctx, {
      cfImageId: up.cfImageId,
      deliveryUrl: await variantUrl(ctx.env, up.cfImageId, "full"),
      description: input.description ?? null,
      contentType: contentType ?? null,
      bytes: bytes.byteLength,
      folderId: input.folderId ?? null,
      kind: "stock",
      uploadedVia,
    });
  }

  // 3. Base64 blob.
  if (input.base64) {
    const bytes = base64ToBytes(input.base64);
    const up = await uploadImageBytes(ctx.env, bytes, { filename: input.description ?? undefined });
    return registerImage(ctx, {
      cfImageId: up.cfImageId,
      deliveryUrl: await variantUrl(ctx.env, up.cfImageId, "full"),
      description: input.description ?? null,
      bytes: bytes.byteLength,
      folderId: input.folderId ?? null,
      kind: "stock",
      uploadedVia,
    });
  }

  throw new ValidationError("Provide one of cfImagesUrl, imageUrl, or base64.");
}
