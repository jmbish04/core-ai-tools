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

import { libraryImages, shortPublicId } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { notifyFolder, notifyFolderBoth } from "./notify";
import { NotFoundError, ValidationError } from "../errors";
import { requireFolder } from "./folders";

/** Provenance of a registered image. Mirrors the `kind` enum. */
export type ImageKind = "stock" | "staged" | "generated";
/** Surface that registered the image. Mirrors the `uploaded_via` enum. */
export type UploadedVia = "ui" | "api" | "mcp";
/**
 * Default role the image plays when pulled into an edit. `session_images.role`
 * still overrides it per session — this is the library-level default.
 */
export type ImageRole = "base" | "reference" | "inject";

export interface RegisterImageInput {
  cfImageId: string;
  deliveryUrl: string;
  folderId?: string | null;
  originalFilename?: string | null;
  /** Optional caption / provenance (e.g. a material name); doubles as reference context. */
  description?: string | null;
  /** Short human-authored name, distinct from the upload filename. */
  title?: string | null;
  /** How a model or a person should use this image. */
  usageInstructions?: string | null;
  /** Background a model needs about the image. */
  contextText?: string | null;
  /** Default role in an edit. */
  role?: ImageRole | null;
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
      title: input.title ?? null,
      usageInstructions: input.usageInstructions ?? null,
      contextText: input.contextText ?? null,
      role: input.role ?? null,
      contentType: input.contentType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      bytes: input.bytes ?? null,
      kind: input.kind ?? "stock",
      uploadedVia: input.uploadedVia ?? "ui",
    })
    .returning();
  if (row.folderId) {
    await notifyFolder(ctx, { type: "image_added", folderId: row.folderId, imageId: row.id });
  }
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
  // Read BEFORE the write: the updated row carries only the destination folder,
  // so without this the source view never hears that it lost the image.
  const before = await requireImage(ctx, input.imageId);
  if (input.folderId) {
    await requireFolder(ctx, input.folderId);
  }
  const [row] = await ctx.db
    .update(libraryImages)
    .set({ folderId: input.folderId })
    .where(eq(libraryImages.id, input.imageId))
    .returning();
  await notifyFolderBoth(ctx, before.folderId, row.folderId, (folderId) => ({
    type: "image_moved",
    folderId,
    imageId: row.id,
    fromFolderId: before.folderId,
    toFolderId: row.folderId,
  }));
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
  if (row.folderId) {
    await notifyFolder(ctx, { type: "image_removed", folderId: row.folderId, imageId: row.id });
  }
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

// ---------------------------------------------------------------------------
// Rich metadata + the short copyable public id
// ---------------------------------------------------------------------------

/** Fields a user (or an agent) may edit on a registered image. */
export interface ImageMetadataInput {
  title?: string | null;
  description?: string | null;
  usageInstructions?: string | null;
  contextText?: string | null;
  role?: ImageRole | null;
}

/**
 * Update an image's human metadata. Only the keys present are touched; `null`
 * clears a field. Bytes, provenance, and the public id are never touched here.
 *
 * @param ctx   Core context.
 * @param input The image id plus the fields to write.
 * @returns The updated image row.
 * @throws NotFoundError when the image does not exist or is soft-deleted.
 * @throws ValidationError when no metadata field was supplied.
 * @example await updateImageMetadata(ctx, { imageId, title: "Walnut slab", role: "reference" });
 */
export async function updateImageMetadata(
  ctx: CoreContext,
  input: { imageId: string } & ImageMetadataInput,
): Promise<LibraryImage> {
  await requireImage(ctx, input.imageId);

  const patch: ImageMetadataInput = {};
  const trim = (v: string | null | undefined) => {
    const t = v?.trim();
    return t ? t : null;
  };
  if ("title" in input) patch.title = trim(input.title);
  if ("description" in input) patch.description = trim(input.description);
  if ("usageInstructions" in input) patch.usageInstructions = trim(input.usageInstructions);
  if ("contextText" in input) patch.contextText = trim(input.contextText);
  if ("role" in input) patch.role = input.role ?? null;

  if (Object.keys(patch).length === 0) {
    throw new ValidationError("No image metadata fields supplied.");
  }

  const [row] = await ctx.db
    .update(libraryImages)
    .set(patch)
    .where(eq(libraryImages.id, input.imageId))
    .returning();
  if (row.folderId) {
    await notifyFolder(ctx, {
      type: "image_metadata_changed",
      folderId: row.folderId,
      imageId: row.id,
      changed: Object.keys(patch),
    });
  }
  return row;
}

/**
 * Resolve a short public id (`img_...`) to its live image row. This is the lookup
 * behind "paste the id the user copied into a prompt".
 *
 * @param ctx      Core context.
 * @param publicId The short handle, case-insensitive and tolerant of surrounding
 *                 whitespace (it arrives pasted).
 * @returns The image row, or null when no live image carries that id.
 * @example const img = await findImageByPublicId(ctx, "img_7k2qp9xw3b");
 */
export async function findImageByPublicId(
  ctx: CoreContext,
  publicId: string,
): Promise<LibraryImage | null> {
  const normalised = publicId.trim().toLowerCase();
  if (!normalised) return null;
  const [row] = await ctx.db
    .select()
    .from(libraryImages)
    .where(and(eq(libraryImages.publicId, normalised), isNull(libraryImages.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a short public id or throw. Surfaces that accept a pasted id use this
 * so a typo becomes a 404 with the id echoed, not a silent empty result.
 *
 * @throws NotFoundError when no live image carries that public id.
 */
export async function requireImageByPublicId(
  ctx: CoreContext,
  publicId: string,
): Promise<LibraryImage> {
  const row = await findImageByPublicId(ctx, publicId);
  if (!row) throw new NotFoundError(`No image with public id '${publicId}'.`);
  return row;
}

/**
 * Give a public id to rows that predate the column. New rows get one from the
 * column default, so this only ever has work to do once per pre-existing row.
 *
 * ponytail: one UPDATE per row, called from a backfill/admin path, not a request.
 * Batch it if the library ever holds enough legacy rows for that to matter.
 *
 * @param ctx   Core context.
 * @param limit Maximum rows to fill in one call (default 500).
 * @returns How many rows were given an id.
 * @example await backfillPublicIds(ctx); // → 37
 */
export async function backfillPublicIds(ctx: CoreContext, limit = 500): Promise<number> {
  const rows = await ctx.db
    .select({ id: libraryImages.id })
    .from(libraryImages)
    .where(isNull(libraryImages.publicId))
    .limit(limit);
  for (const row of rows) {
    await ctx.db
      .update(libraryImages)
      .set({ publicId: shortPublicId() })
      .where(eq(libraryImages.id, row.id));
  }
  return rows.length;
}
