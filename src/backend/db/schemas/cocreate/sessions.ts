/**
 * @fileoverview `cocreate_sessions` — one prompt-refinement workspace (the
 * "Proactive Co-Creator" flow): a prompt is mapped into a belief graph, the model
 * asks clarifying questions, answers are folded into a new prompt version, and
 * images are generated from a chosen version.
 *
 * Revisitable by construction: everything the workspace shows is stored —
 * versions in `cocreate_prompt_versions`, questions/answers in `cocreate_answers`,
 * images (Cloudflare Images, via `library_images`) in `cocreate_generations`.
 *
 * Not an image-edit `sessions` row: those are keyed to an origin image and a
 * revision tree whose rows require an input image. A co-creator session usually
 * starts from text alone, so it is its own table and links to library images by
 * FK. DELETES ARE SOFT ONLY (`archived_at`) — answers here are reused by other
 * sessions through the consultant.
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryFolders } from "../library/folders";
import { libraryImages } from "../library/images";

export const COCREATE_SESSIONS_TABLE_DESCRIPTION =
  "Prompt-refinement workspaces (belief graph + clarifying questions + prompt versions + generations). Soft-archived, never hard-deleted.";

export const COCREATE_SESSIONS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  title: "Short display name.",
  goal: "What the user is trying to achieve, in their words. Feeds the consultant.",
  current_prompt: "The prompt text of the current version (denormalised for the list view).",
  current_version_id: "Soft ref to cocreate_prompt_versions.id — no FK, to avoid a sessions↔versions cycle.",
  belief_graph: "JSON belief graph (entities, attributes, relationships) from the last analysis.",
  proactiveness: "low | medium | high — how much the model may infer.",
  aspect_ratio: "Aspect ratio for generation, e.g. 16:9.",
  image_model: "Explicit image model id, or null for the image_generate task default.",
  reference_image_id: "FK library_images.id — optional starting image (analysis + image-to-image).",
  folder_id: "FK library_folders.id — where generated images are filed (SET NULL on folder delete).",
  created_at: "Unix timestamp (seconds).",
  updated_at: "Unix timestamp (seconds).",
  archived_at: "Soft-archive marker, or null.",
};

/** One entity / attribute / relationship graph, shape mirrored from the demo. */
export interface BeliefGraph {
  entities: Array<{
    name: string;
    presence_in_prompt: boolean;
    description: string;
    attributes: Array<{ name: string; presence_in_prompt: boolean; value: string[] }>;
  }>;
  relationships: Array<{ source: string; target: string; label: string; presence_in_prompt: boolean; alternatives?: string[] }>;
}

export const cocreateSessions = sqliteTable(
  "cocreate_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    goal: text("goal"),
    currentPrompt: text("current_prompt").notNull().default(""),
    /** Soft ref (no FK): versions reference the session, so an FK back would be a cycle. */
    currentVersionId: text("current_version_id"),
    beliefGraph: text("belief_graph", { mode: "json" }).$type<BeliefGraph>(),
    proactiveness: text("proactiveness", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    aspectRatio: text("aspect_ratio").notNull().default("16:9"),
    imageModel: text("image_model"),
    referenceImageId: text("reference_image_id").references(() => libraryImages.id, { onDelete: "restrict" }),
    folderId: text("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
  },
  (t) => [
    // List view: live sessions, newest activity first.
    index("idx_cocreate_sessions_updated").on(t.archivedAt, t.updatedAt),
  ],
);

export const insertCocreateSessionSchema = createInsertSchema(cocreateSessions);
export const selectCocreateSessionSchema = createSelectSchema(cocreateSessions);
export type CocreateSession = typeof cocreateSessions.$inferSelect;
export type NewCocreateSession = typeof cocreateSessions.$inferInsert;
