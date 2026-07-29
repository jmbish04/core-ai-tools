/**
 * @fileoverview Upload orchestration — the ctx-level flow that ties Cloudflare
 * Images (env-level, `core/images`) to the `library_images` registry (D1).
 * Replaces the Phase-2 row-only registration path with real uploads.
 *
 * Three entry points:
 *   - `createUploadIntent` — mint a direct creator upload URL (browser uploads
 *     straight to Cloudflare Images; bytes never touch the Worker).
 *   - `completeUpload` — after the client finishes, register the library row with
 *     a real delivery URL derived from the account hash + variant.
 *   - `uploadGeneratedImage` — push a provider's output bytes to Images and
 *     register the row (kind = 'generated'). Used by the Phase-4 dispatch layer.
 */

import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { IMAGE_VARIANTS, mintDirectUploadUrl, uploadImageBytes, variantUrl } from "../images";
import type { DirectUploadIntent, MintOptions } from "../images";
import { registerImage } from "./images";
import type { ImageKind, UploadedVia } from "./images";

/** Mint a direct creator upload URL. Bytes go browser → Cloudflare Images. */
export async function createUploadIntent(
  ctx: CoreContext,
  opts?: MintOptions,
): Promise<DirectUploadIntent> {
  return mintDirectUploadUrl(ctx.env, opts);
}

export interface CompleteUploadInput {
  /** The id returned by `createUploadIntent`, now populated with bytes. */
  cfImageId: string;
  folderId?: string | null;
  originalFilename?: string | null;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  kind?: ImageKind;
  uploadedVia?: UploadedVia;
}

/** Register a completed browser upload as a library image (full-variant delivery URL). */
export async function completeUpload(
  ctx: CoreContext,
  input: CompleteUploadInput,
): Promise<LibraryImage> {
  const deliveryUrl = await variantUrl(ctx.env, input.cfImageId, IMAGE_VARIANTS.FULL);
  return registerImage(ctx, { ...input, deliveryUrl, kind: input.kind ?? "stock" });
}

export interface UploadGeneratedInput {
  folderId?: string | null;
  originalFilename?: string | null;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  uploadedVia?: UploadedVia;
}

/** Push provider output bytes to Cloudflare Images and register the row. */
export async function uploadGeneratedImage(
  ctx: CoreContext,
  imageBytes: ArrayBuffer | ReadableStream<Uint8Array>,
  input: UploadGeneratedInput = {},
): Promise<LibraryImage> {
  const { cfImageId } = await uploadImageBytes(ctx.env, imageBytes, {
    filename: input.originalFilename ?? undefined,
  });
  const deliveryUrl = await variantUrl(ctx.env, cfImageId, IMAGE_VARIANTS.FULL);
  return registerImage(ctx, {
    cfImageId,
    deliveryUrl,
    folderId: input.folderId ?? null,
    originalFilename: input.originalFilename ?? null,
    contentType: input.contentType ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    bytes: input.bytes ?? null,
    kind: "generated",
    uploadedVia: input.uploadedVia ?? "api",
  });
}
