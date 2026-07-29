/**
 * @fileoverview `library_folders` — arbitrarily-nested folders for the image
 * library. Each folder may have a parent (self-FK); a `null` parent marks a
 * root-level folder. Cycle prevention on move is enforced in the service layer
 * (`backend/core/`), not at the database level — SQLite cannot express "no
 * cycles" as a constraint.
 */

import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `library_folders` table for the docs UI. */
export const LIBRARY_FOLDERS_TABLE_DESCRIPTION =
  "Arbitrarily-nested folders organising the image library. parent_folder_id is a self-FK; null marks a root folder. No-cycles-on-move is enforced by the service layer.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const LIBRARY_FOLDERS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  name: "Display name of the folder.",
  parent_folder_id:
    "Self-referential FK into library_folders.id — null means a root-level folder. On parent delete the child is orphaned (set null) so folders are never silently destroyed.",
  created_at: "Unix timestamp (seconds) when the folder was created.",
  updated_at: "Unix timestamp (seconds) of the last modification.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const libraryFolders = sqliteTable(
  "library_folders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    /**
     * Self-referential parent folder. `null` marks a root-level folder. On
     * parent deletion the child is orphaned (`set null`) rather than
     * cascade-deleted.
     */
    parentFolderId: text("parent_folder_id").references(
      (): AnySQLiteColumn => libraryFolders.id,
      { onDelete: "set null" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Tree traversal ("list children of folder X") hits this on every render.
    index("idx_library_folders_parent").on(t.parentFolderId),
  ],
);

export const insertLibraryFolderSchema = createInsertSchema(libraryFolders);
export const selectLibraryFolderSchema = createSelectSchema(libraryFolders);
export type LibraryFolder = typeof libraryFolders.$inferSelect;
export type NewLibraryFolder = typeof libraryFolders.$inferInsert;
