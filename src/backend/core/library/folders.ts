/**
 * @fileoverview Library folder operations: create, rename, move (with no-cycle
 * enforcement), list. Folders nest arbitrarily via `parent_folder_id`.
 *
 * SQLite cannot express "no cycles" as a constraint, so `moveFolder` walks the
 * ancestor chain of the proposed new parent and rejects the move if it would
 * make a folder its own ancestor. This is the one genuinely non-trivial folder
 * operation and is covered by a unit test.
 *
 * ---------------------------------------------------------------------------
 * ARCHIVE SEMANTICS (W2.7) — read before changing `archiveFolder`
 * ---------------------------------------------------------------------------
 * Retiring a folder is SOFT (`archived_at`), never a delete. `library_images`
 * FKs into `library_folders`, and asset lineage FKs into those images, so a hard
 * delete would either orphan history or trip a RESTRICT — the replay-integrity
 * rule in AGENTS.md. Nothing in this file issues a DELETE.
 *
 * Two questions the obvious implementation gets wrong:
 *
 * 1. **Descendant folders CASCADE.** Archiving a parent and leaving its children
 *    live is the worst option available: the children stop being reachable
 *    through the tree (their parent is gone from it) but still list as folders,
 *    so they surface at the root looking like new top-level folders. That is
 *    silent data movement — the user archived one thing and a subtree appeared
 *    somewhere else. Refusing to archive a non-empty folder was the other
 *    candidate and was rejected as user-hostile: retiring a finished project
 *    would mean archiving it leaf-first. So the whole subtree goes down, and
 *    every folder in it gets the SAME `archived_at` value. That shared timestamp
 *    is not cosmetic — it is what makes `restoreFolder` an exact undo (see 3).
 *
 * 2. **Images are NOT touched.** No `deleted_at`, no re-parenting. An archive is
 *    a statement about the tree, not about content: the rows revision replay
 *    depends on stay exactly as they were, and `listLibrary(folderId)` still
 *    resolves for an archived folder so an existing link or a lineage walk keeps
 *    working. Setting `deleted_at` on the images would also make restore lossy —
 *    we could no longer tell an image the user had deleted from one the cascade
 *    deleted. Consequence, stated rather than inferred: images inside an archived
 *    folder remain listable when addressed by that folder's id. Hiding them from
 *    a whole-library listing is a separate decision about `library_images` and is
 *    deliberately not made here.
 *
 * 3. **Restore un-archives exactly what that archive took down.** It clears the
 *    folder plus the descendants carrying the SAME `archived_at`, so a child the
 *    user had archived separately (different timestamp) stays archived. Restoring
 *    into an archived parent is REFUSED rather than quietly re-homed at the root —
 *    same reasoning as (1).
 */

import { and, eq, isNotNull, isNull, inArray } from "drizzle-orm";

import { libraryFolders } from "@/backend/db/schema";
import type { LibraryFolder } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { notifyFolder, notifyFolderBoth } from "./notify";
import { NotFoundError, ValidationError } from "../errors";

/** Create a folder. `parentFolderId = null` (default) makes it a root folder. */
export async function createFolder(
  ctx: CoreContext,
  input: { name: string; parentFolderId?: string | null },
): Promise<LibraryFolder> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Folder name cannot be empty.");

  if (input.parentFolderId) {
    const parent = await requireFolder(ctx, input.parentFolderId);
    // Creating inside an archived folder would make a live folder nobody can
    // reach through the tree — exactly the orphan shape the cascade avoids.
    if (parent.archivedAt) {
      throw new ValidationError(`Folder ${parent.id} is archived; restore it before adding to it.`);
    }
  }

  const [row] = await ctx.db
    .insert(libraryFolders)
    .values({ name, parentFolderId: input.parentFolderId ?? null })
    .returning();
  // Into its own channel, and into the parent's — an open parent view gains a child.
  await notifyFolder(ctx, {
    type: "folder_created",
    folderId: row.id,
    name: row.name,
    parentFolderId: row.parentFolderId,
  });
  if (row.parentFolderId) {
    await notifyFolder(ctx, {
      type: "folder_created",
      folderId: row.parentFolderId,
      name: row.name,
      parentFolderId: row.parentFolderId,
    });
  }
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
  await notifyFolder(ctx, { type: "folder_renamed", folderId: row.id, name: row.name });
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
  // Read BEFORE the write: the updated row carries only the new parent, and the
  // old parent's open view needs to hear about losing the child.
  const before = await requireFolder(ctx, input.folderId);

  if (input.newParentId !== null) {
    if (input.newParentId === input.folderId) {
      throw new ValidationError("A folder cannot be moved into itself.");
    }
    const newParent = await requireFolder(ctx, input.newParentId);
    // Same reason as createFolder: a live folder under an archived one is
    // unreachable through the tree.
    if (newParent.archivedAt) {
      throw new ValidationError(`Folder ${newParent.id} is archived; restore it before moving into it.`);
    }
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
  const moved = {
    type: "folder_moved" as const,
    fromParentId: before.parentFolderId,
    toParentId: row.parentFolderId,
  };
  await notifyFolderBoth(ctx, before.parentFolderId, row.parentFolderId, (folderId) => ({
    ...moved,
    folderId,
  }));
  await notifyFolder(ctx, { ...moved, folderId: row.id });
  return row;
}

/**
 * List folders, optionally scoped to the direct children of one parent (null =
 * roots).
 *
 * Archived folders are HIDDEN unless asked for: `archived: "exclude"` (the
 * default, and what every pre-W2.7 caller gets), `"only"` for the archive view,
 * `"include"` for both.
 *
 * @example await listFolders(ctx);                          // live tree
 * @example await listFolders(ctx, { archived: "only" });    // the archive
 */
export async function listFolders(
  ctx: CoreContext,
  input?: { parentFolderId?: string | null; archived?: "exclude" | "include" | "only" },
): Promise<LibraryFolder[]> {
  const filters = [];
  // undefined = all folders; null = roots only; else children of that folder.
  if (input?.parentFolderId === null) {
    filters.push(isNull(libraryFolders.parentFolderId));
  } else if (input?.parentFolderId !== undefined) {
    filters.push(eq(libraryFolders.parentFolderId, input.parentFolderId));
  }
  if (input?.archived === "only") filters.push(isNotNull(libraryFolders.archivedAt));
  else if (input?.archived !== "include") filters.push(isNull(libraryFolders.archivedAt));

  const q = ctx.db.select().from(libraryFolders);
  return filters.length ? q.where(and(...filters)) : q;
}

/**
 * Every folder in `rootId`'s subtree, `rootId` first. One query plus an in-memory
 * walk — a library holds tens of folders, so a recursive CTE buys nothing.
 */
async function subtree(
  ctx: CoreContext,
  rootId: string,
): Promise<Array<{ id: string; parentFolderId: string | null; archivedAt: Date | null }>> {
  const rows = await ctx.db
    .select({
      id: libraryFolders.id,
      parentFolderId: libraryFolders.parentFolderId,
      archivedAt: libraryFolders.archivedAt,
    })
    .from(libraryFolders);
  const byParent = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.parentFolderId) continue;
    const bucket = byParent.get(row.parentFolderId);
    if (bucket) bucket.push(row);
    else byParent.set(row.parentFolderId, [row]);
  }
  const out = rows.filter((r) => r.id === rootId);
  for (let i = 0; i < out.length; i++) {
    out.push(...(byParent.get(out[i].id) ?? []));
  }
  return out;
}

/**
 * Archive (retire) a folder and its whole subtree. Soft only — see the archive
 * section of this file's header for why descendants cascade and images do not.
 *
 * Idempotent: an already-archived folder is returned untouched. Descendants that
 * were archived earlier keep their own `archived_at`, so this archive's restore
 * will not resurrect them.
 *
 * @param ctx      Core context.
 * @param folderId The folder to retire.
 * @returns The archived folder row.
 * @throws NotFoundError when the folder does not exist.
 * @example await archiveFolder(ctx, finishedProject.id);
 */
export async function archiveFolder(ctx: CoreContext, folderId: string): Promise<LibraryFolder> {
  const folder = await requireFolder(ctx, folderId);
  if (folder.archivedAt) return folder;

  const affected = (await subtree(ctx, folderId)).filter((r) => !r.archivedAt);
  const at = new Date();
  await ctx.db
    .update(libraryFolders)
    .set({ archivedAt: at, updatedAt: at })
    .where(and(inArray(libraryFolders.id, affected.map((r) => r.id)), isNull(libraryFolders.archivedAt)));

  // Every folder that went down announces itself, so a view open on a descendant
  // updates too — not just the one the user clicked.
  for (const row of affected) {
    await notifyFolder(ctx, { type: "folder_archived", folderId: row.id });
  }
  // The parent's open view loses a child.
  if (folder.parentFolderId) {
    await notifyFolder(ctx, { type: "folder_archived", folderId: folder.parentFolderId });
  }
  return requireFolder(ctx, folderId);
}

/**
 * Restore an archived folder, plus exactly the descendants that the SAME archive
 * took down (matched on `archived_at`) — so a child archived separately stays
 * archived.
 *
 * Idempotent on a live folder. Refuses to restore into an archived parent rather
 * than silently re-homing the folder at the root.
 *
 * Emits `folder_restored` (added to the union for this): a restore is not a
 * creation, and reusing `folder_created` would be a lie of provenance in the log
 * and would make a client animate a restore as a brand-new folder. It carries the
 * name and parent a client needs to re-insert the row.
 *
 * @param ctx      Core context.
 * @param folderId The archived folder to bring back.
 * @returns The restored folder row.
 * @throws NotFoundError when the folder does not exist.
 * @throws ValidationError when its parent is still archived.
 * @example await restoreFolder(ctx, archived.id);
 */
export async function restoreFolder(ctx: CoreContext, folderId: string): Promise<LibraryFolder> {
  const folder = await requireFolder(ctx, folderId);
  if (!folder.archivedAt) return folder;

  if (folder.parentFolderId) {
    const parent = await requireFolder(ctx, folder.parentFolderId);
    if (parent.archivedAt) {
      throw new ValidationError(
        `Parent folder ${parent.id} is archived; restore it first (restoring it brings this folder back with it).`,
      );
    }
  }

  const stamp = folder.archivedAt.getTime();
  const affected = (await subtree(ctx, folderId)).filter((r) => r.archivedAt?.getTime() === stamp);
  await ctx.db
    .update(libraryFolders)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(inArray(libraryFolders.id, affected.map((r) => r.id)));

  const restored = await ctx.db
    .select()
    .from(libraryFolders)
    .where(inArray(libraryFolders.id, affected.map((r) => r.id)));
  for (const row of restored) {
    await notifyFolder(ctx, {
      type: "folder_restored",
      folderId: row.id,
      name: row.name,
      parentFolderId: row.parentFolderId,
    });
  }
  if (folder.parentFolderId) {
    await notifyFolder(ctx, {
      type: "folder_restored",
      folderId: folder.parentFolderId,
      name: folder.name,
      parentFolderId: folder.parentFolderId,
    });
  }
  return restored.find((r) => r.id === folderId) ?? requireFolder(ctx, folderId);
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
