/**
 * @fileoverview Library image registry operations. These persist and query the
 * `library_images` rows only — the actual Cloudflare Images upload (minting a
 * direct-creator upload URL, fetching variants) lands in Phase 3. `registerImage`
 * therefore takes an already-uploaded image's identifiers as input; Phase 3 wires
 * the upload flow in front of it.
 *
 * Deletes are SOFT. `softDeleteImage` sets `deleted_at`; no operation here ever
 * issues a hard DELETE, because a revision's replayability depends on its input
 * and output image rows surviving.
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { libraryImages } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError } from "../errors";
import { requireFolder } from "./folders";

/** Provenance of a registered image. Mirrors the `kind` enum. */
export type ImageKind = "stock" | "staged" | "generated";
/** Surface that registered the image. Mirrors the `uploaded_via` enum. */
export type UploadedVia = "ui" | "api" | "mcp";

export interface RegisterImageInput {
  cfImageId: string;
  deliveryUrl: string;
  folderId?: string | null;
  originalFilename?: string | null;
  /** Optional caption / provenance (e.g. a material name); doubles as reference context. */
  description?: string | null;
  contentType?: string | null;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  kind?: ImageKind;
  uploadedVia?: UploadedVia;
}

/**
 * Register an already-uploaded Cloudflare Images object as a library row. Used
 * both by the UI/API upload completion callback and internally when a provider's
 * generated output is uploaded back (kind = 'generated').
 */
export async function registerImage(
  ctx: CoreContext,
  input: RegisterImageInput,
): Promise<LibraryImage> {
  if (input.folderId) {
    await requireFolder(ctx, input.folderId);
  }
  const [row] = await ctx.db
    .insert(libraryImages)
    .values({
      cfImageId: input.cfImageId,
      deliveryUrl: input.deliveryUrl,
      folderId: input.folderId ?? null,
      originalFilename: input.originalFilename ?? null,
      description: input.description ?? null,
      contentType: input.contentType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes ?? null,
      kind: input.kind ?? "stock",
      uploadedVia: input.uploadedVia ?? "ui",
    })
    .returning();
  return row;
}

/**
 * List live (non-soft-deleted) images, optionally scoped to a folder
 * (`folderId: null` = library root). Newest first; basic limit/offset paging.
 */
export async function listLibrary(
  ctx: CoreContext,
  input?: { folderId?: string | null; limit?: number; offset?: number },
): Promise<LibraryImage[]> {
  const live = isNull(libraryImages.deletedAt);
  let where = live;
  // Guard `undefined` (no filter) vs `null` (root folder) vs a folder id. Binding
  // `undefined` to D1 throws, so an absent query param MUST mean "no filter".
  if (input?.folderId === null) {
    where = and(live, isNull(libraryImages.folderId))!;
  } else if (input?.folderId !== undefined) {
    where = and(live, eq(libraryImages.folderId, input.folderId))!;
  }
  return ctx.db
    .select()
    .from(libraryImages)
    .where(where)
    .orderBy(desc(libraryImages.createdAt))
    .limit(input?.limit ?? 100)
    .offset(input?.offset ?? 0);
}

/** Move an image into a folder (or to root with `folderId = null`). */
export async function moveImage(
  ctx: CoreContext,
  input: { imageId: string; folderId: string | null },
): Promise<LibraryImage> {
  await requireImage(ctx, input.imageId);
  if (input.folderId) {
    await requireFolder(ctx, input.folderId);
  }
  const [row] = await ctx.db
    .update(libraryImages)
    .set({ folderId: input.folderId })
    .where(eq(libraryImages.id, input.imageId))
    .returning();
  return row;
}

/** Soft-delete an image (sets `deleted_at`). Idempotent. Never a hard delete. */
export async function softDeleteImage(ctx: CoreContext, imageId: string): Promise<LibraryImage> {
  await requireImage(ctx, imageId);
  const [row] = await ctx.db
    .update(libraryImages)
    .set({ deletedAt: new Date() })
    .where(eq(libraryImages.id, imageId))
    .returning();
  return row;
}

/**
 * Flag an image as bad (with an optional reason) so it's visibly ignored. This
 * is distinct from soft-delete: the row stays live and listable, just marked.
 * Idempotent — re-flagging updates the notes.
 */
export async function flagImageBad(
  ctx: CoreContext,
  imageId: string,
  notes?: string | null,
): Promise<LibraryImage> {
  await requireImage(ctx, imageId);
  const [row] = await ctx.db
    .update(libraryImages)
    .set({ flaggedBadAt: new Date(), badNotes: notes ?? null })
    .where(eq(libraryImages.id, imageId))
    .returning();
  return row;
}

/** Undo a bad flag — clears the marker and its notes. Idempotent. */
export async function unflagImageBad(ctx: CoreContext, imageId: string): Promise<LibraryImage> {
  await requireImage(ctx, imageId);
  const [row] = await ctx.db
    .update(libraryImages)
    .set({ flaggedBadAt: null, badNotes: null })
    .where(eq(libraryImages.id, imageId))
    .returning();
  return row;
}

/** Fetch a LIVE (non-soft-deleted) image or throw NotFound. */
export async function requireImage(ctx: CoreContext, imageId: string): Promise<LibraryImage> {
  const [row] = await ctx.db
    .select()
    .from(libraryImages)
    .where(and(eq(libraryImages.id, imageId), isNull(libraryImages.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError(`Image ${imageId} not found.`);
  return row;
}
