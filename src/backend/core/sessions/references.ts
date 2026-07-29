/**
 * @fileoverview Session reference-image pool — the session-scoped palette of
 * additional images (beyond the base) fed to a multi-reference edit. Roles
 * (base | object | style) live on the `session_images` join; a revision records
 * WHICH refs it used, ordered, in `editPayload.reference_image_ids`.
 *
 * ponytail: role is read from this (mutable) pool, not snapshotted per-revision.
 * If a role changes after submit, a later replay reorders. Acceptable for the
 * session-scoped model; snapshot into editPayload if strict replay is needed.
 */

import { and, eq, inArray } from "drizzle-orm";

import { libraryImages, sessionImages } from "@/backend/db/schema";
import type { LibraryImage } from "@/backend/db/schema";
import type { ModelEntry } from "@/backend/ai/registry";
import type { CoreContext } from "../context";
import { ValidationError } from "../errors";
import { requireImage } from "../library/images";

export type ReferenceRole = "base" | "object" | "style";
export interface ReferenceInput {
  imageId: string;
  role: ReferenceRole;
}

/** Assembly order: base first, then object refs, then style refs. */
const ROLE_ORDER: Record<ReferenceRole, number> = { base: 0, object: 1, style: 2 };

/**
 * Validate per-model reference caps BEFORE dispatch → a clear error, never a
 * provider 400. Enforces object/style sub-caps and the total.
 */
export function assertReferenceCaps(model: ModelEntry, references: ReferenceInput[]): void {
  if (references.length === 0) return;
  const c = model.capabilities;
  if (!c.multi_reference_image || c.max_reference_images === 0) {
    throw new ValidationError(
      `Model ${model.id} does not accept reference images. Use a multi-reference model (e.g. gemini-3-pro-image).`,
    );
  }
  const objects = references.filter((r) => r.role === "object").length;
  const styles = references.filter((r) => r.role === "style").length;
  if (objects > c.max_object_refs) {
    throw new ValidationError(
      `Too many object references for ${model.id}: ${objects} > ${c.max_object_refs}.`,
    );
  }
  if (styles > c.max_style_refs) {
    throw new ValidationError(
      `Too many style references for ${model.id}: ${styles} > ${c.max_style_refs}.`,
    );
  }
  if (references.length > c.max_reference_images) {
    throw new ValidationError(
      `Too many references for ${model.id}: ${references.length} > ${c.max_reference_images} total.`,
    );
  }
}

/**
 * Upsert references into the session pool and return their library ids ordered
 * base → object → style (the provider assembly order). Validates each image
 * exists. One role per (session, image) — re-adding updates the role.
 */
export async function upsertSessionReferences(
  ctx: CoreContext,
  sessionUuid: string,
  references: ReferenceInput[],
): Promise<string[]> {
  if (references.length === 0) return [];
  // Validate existence up front (each throws NotFound if missing/soft-deleted).
  for (const ref of references) await requireImage(ctx, ref.imageId);

  for (const ref of references) {
    await ctx.db
      .insert(sessionImages)
      .values({ sessionUuid, libraryImageId: ref.imageId, role: ref.role })
      .onConflictDoUpdate({
        target: [sessionImages.sessionUuid, sessionImages.libraryImageId],
        set: { role: ref.role },
      });
  }

  return [...references]
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    .map((r) => r.imageId);
}

/** A session-pool reference joined with its library image (for pickers + serialization). */
export interface SessionReference {
  role: ReferenceRole;
  image: LibraryImage;
}

/** List a session's reference pool, each with its library image row. */
export async function listSessionReferences(
  ctx: CoreContext,
  sessionUuid: string,
): Promise<SessionReference[]> {
  const rows = await ctx.db
    .select({ role: sessionImages.role, image: libraryImages })
    .from(sessionImages)
    .innerJoin(libraryImages, eq(sessionImages.libraryImageId, libraryImages.id))
    .where(eq(sessionImages.sessionUuid, sessionUuid));
  return rows.map((r) => ({ role: r.role as ReferenceRole, image: r.image }));
}

/**
 * Resolve the roles for a set of image ids within a session (order preserved as
 * given). Used to tag a revision's reference_image_ids with their pool roles.
 */
export async function resolveReferenceRoles(
  ctx: CoreContext,
  sessionUuid: string,
  imageIds: string[],
): Promise<Array<{ imageId: string; role: ReferenceRole | null }>> {
  if (imageIds.length === 0) return [];
  const rows = await ctx.db
    .select({ imageId: sessionImages.libraryImageId, role: sessionImages.role })
    .from(sessionImages)
    .where(
      and(eq(sessionImages.sessionUuid, sessionUuid), inArray(sessionImages.libraryImageId, imageIds)),
    );
  const roleById = new Map(rows.map((r) => [r.imageId, r.role as ReferenceRole]));
  return imageIds.map((imageId) => ({ imageId, role: roleById.get(imageId) ?? null }));
}
