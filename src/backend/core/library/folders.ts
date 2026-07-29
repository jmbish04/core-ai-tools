/**
 * @fileoverview Library folder operations: create, rename, move (with no-cycle
 * enforcement), list. Folders nest arbitrarily via `parent_folder_id`.
 *
 * SQLite cannot express "no cycles" as a constraint, so `moveFolder` walks the
 * ancestor chain of the proposed new parent and rejects the move if it would
 * make a folder its own ancestor. This is the one genuinely non-trivial folder
 * operation and is covered by a unit test.
 */

import { eq, isNull } from "drizzle-orm";

import { libraryFolders } from "@/backend/db/schema";
import type { LibraryFolder } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";

/** Create a folder. `parentFolderId = null` (default) makes it a root folder. */
export async function createFolder(
  ctx: CoreContext,
  input: { name: string; parentFolderId?: string | null },
): Promise<LibraryFolder> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Folder name cannot be empty.");

  if (input.parentFolderId) {
    await requireFolder(ctx, input.parentFolderId);
  }

  const [row] = await ctx.db
    .insert(libraryFolders)
    .values({ name, parentFolderId: input.parentFolderId ?? null })
    .returning();
  return row;
}

/** Rename a folder in place. */
export async function renameFolder(
  ctx: CoreContext,
  input: { folderId: string; name: string },
): Promise<LibraryFolder> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Folder name cannot be empty.");
  await requireFolder(ctx, input.folderId);

  const [row] = await ctx.db
    .update(libraryFolders)
    .set({ name, updatedAt: new Date() })
    .where(eq(libraryFolders.id, input.folderId))
    .returning();
  return row;
}

/**
 * Move a folder under a new parent (or to root with `newParentId = null`).
 * Rejects any move that would create a cycle — i.e. moving a folder into itself
 * or into one of its own descendants.
 */
export async function moveFolder(
  ctx: CoreContext,
  input: { folderId: string; newParentId: string | null },
): Promise<LibraryFolder> {
  await requireFolder(ctx, input.folderId);

  if (input.newParentId !== null) {
    if (input.newParentId === input.folderId) {
      throw new ValidationError("A folder cannot be moved into itself.");
    }
    await requireFolder(ctx, input.newParentId);
    // Walk up from the proposed parent; if we reach folderId, the move would put
    // the folder inside its own subtree — a cycle.
    let cursor: string | null = input.newParentId;
    while (cursor !== null) {
      if (cursor === input.folderId) {
        throw new ValidationError(
          "Move would create a folder cycle (target is a descendant of the folder being moved).",
        );
      }
      const [parent] = await ctx.db
        .select({ parentFolderId: libraryFolders.parentFolderId })
        .from(libraryFolders)
        .where(eq(libraryFolders.id, cursor))
        .limit(1);
      cursor = parent?.parentFolderId ?? null;
    }
  }

  const [row] = await ctx.db
    .update(libraryFolders)
    .set({ parentFolderId: input.newParentId, updatedAt: new Date() })
    .where(eq(libraryFolders.id, input.folderId))
    .returning();
  return row;
}

/** List folders, optionally scoped to the direct children of one parent (null = roots). */
export async function listFolders(
  ctx: CoreContext,
  input?: { parentFolderId?: string | null },
): Promise<LibraryFolder[]> {
  // undefined = all folders; null = roots only; else children of that folder.
  if (input?.parentFolderId === null) {
    return ctx.db.select().from(libraryFolders).where(isNull(libraryFolders.parentFolderId));
  }
  if (input?.parentFolderId !== undefined) {
    return ctx.db.select().from(libraryFolders).where(eq(libraryFolders.parentFolderId, input.parentFolderId));
  }
  return ctx.db.select().from(libraryFolders);
}

/** Fetch a folder or throw NotFound. Exposed for callers that need existence + row. */
export async function requireFolder(ctx: CoreContext, folderId: string): Promise<LibraryFolder> {
  const [row] = await ctx.db
    .select()
    .from(libraryFolders)
    .where(eq(libraryFolders.id, folderId))
    .limit(1);
  if (!row) throw new NotFoundError(`Folder ${folderId} not found.`);
  return row;
}
