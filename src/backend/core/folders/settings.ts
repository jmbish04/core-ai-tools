/**
 * @fileoverview Inheritable folder settings: write them, and resolve the
 * effective value for a folder together with the folder it was inherited FROM.
 *
 * Folders nest to unlimited depth (`library_folders.parent_folder_id`; cycles are
 * refused by `core/library/folders.ts#moveFolder`, which is the one cycle check —
 * this module does not repeat it). Every settings column is nullable, and NULL
 * means "inherit from the nearest ancestor that sets it", never "off".
 *
 * `resolveSettings` walks the whole ancestor chain in ONE `WITH RECURSIVE` query
 * rather than a read per level, because the resolution runs on every library and
 * compose render and a deep tree would otherwise cost N round trips to D1.
 *
 * It reports provenance (`fromFolderId`) alongside every value, because the UI
 * shows "inherited from Kitchens" next to a field the user did not set here.
 */

import { eq, sql } from "drizzle-orm";

import { libraryFolders } from "@/backend/db/schema";
import type { LibraryFolder } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { requireFolder } from "../library/folders";

/** HITL gate policy a folder can impose on sessions spawned beneath it. */
export type FolderApprovalPolicy = "auto" | "masked_only" | "always";

/** The inheritable settings, as stored on one folder row (null = inherit). */
export interface FolderSettings {
  defaultPrompt: string | null;
  contextText: string | null;
  useCase: string | null;
  preferredModels: string[] | null;
  approvalPolicy: FolderApprovalPolicy | null;
}

/** One resolved setting: the effective value plus where it came from. */
export interface ResolvedSetting<T> {
  /** Effective value, or null when no folder in the chain sets it. */
  value: T | null;
  /**
   * The folder the value came from — the queried folder itself when set locally,
   * an ancestor when inherited, null when nothing in the chain sets it.
   */
  fromFolderId: string | null;
  /** True when `fromFolderId` is an ancestor rather than the queried folder. */
  inherited: boolean;
}

/** Every inheritable setting, resolved with provenance. */
export interface ResolvedFolderSettings {
  folderId: string;
  /** The queried folder first, then each ancestor up to the root. */
  ancestorPath: string[];
  defaultPrompt: ResolvedSetting<string>;
  contextText: ResolvedSetting<string>;
  useCase: ResolvedSetting<string>;
  preferredModels: ResolvedSetting<string[]>;
  approvalPolicy: ResolvedSetting<FolderApprovalPolicy>;
}

/**
 * Hard stop on the recursive walk. The service layer refuses cycles, so this can
 * only be hit by a tree corrupted outside it — in which case a bounded query
 * failing to resolve beats an unbounded one hanging the request.
 *
 * ponytail: fixed depth cap; make it a real cycle-detecting CTE only if folders
 * ever legitimately nest deeper than this.
 */
const MAX_FOLDER_DEPTH = 64;

/** Shape of one row of the ancestor-chain CTE (raw snake_case from D1). */
interface ChainRow {
  id: string;
  depth: number;
  default_prompt: string | null;
  context_text: string | null;
  use_case: string | null;
  preferred_models: string | null;
  approval_policy: string | null;
}

/**
 * Resolve every inheritable setting for a folder, walking from the folder up
 * through its ancestors and taking the first non-null value for each setting.
 *
 * @param ctx      Core context (D1 + events).
 * @param folderId The folder to resolve settings for.
 * @returns Each setting's effective value, the folder it came from, and the full
 *          ancestor path (folder first, root last).
 * @throws NotFoundError when the folder does not exist.
 * @example
 * const s = await resolveSettings(ctx, leafId);
 * s.approvalPolicy; // { value: "always", fromFolderId: rootId, inherited: true }
 */
export async function resolveSettings(
  ctx: CoreContext,
  folderId: string,
): Promise<ResolvedFolderSettings> {
  // One query for the whole chain. `depth` orders nearest-first, which is exactly
  // the precedence order, so the pick below is a single pass over the rows.
  const query = sql`
    with recursive chain(id, parent_folder_id, default_prompt, context_text, use_case, preferred_models, approval_policy, depth) as (
      select id, parent_folder_id, default_prompt, context_text, use_case, preferred_models, approval_policy, 0
        from library_folders where id = ${folderId}
      union all
      select f.id, f.parent_folder_id, f.default_prompt, f.context_text, f.use_case, f.preferred_models, f.approval_policy, c.depth + 1
        from library_folders f
        join chain c on f.id = c.parent_folder_id
       where c.depth < ${MAX_FOLDER_DEPTH}
    )
    select id, depth, default_prompt, context_text, use_case, preferred_models, approval_policy
      from chain order by depth asc`;

  const chain = (await ctx.db.all(query)) as unknown as ChainRow[];
  if (chain.length === 0) throw new NotFoundError(`Folder ${folderId} not found.`);

  /** First non-null value in the chain, with the folder it came from. */
  const pick = <T>(read: (row: ChainRow) => T | null | undefined): ResolvedSetting<T> => {
    for (const row of chain) {
      const value = read(row);
      if (value !== null && value !== undefined && value !== "") {
        return { value, fromFolderId: row.id, inherited: row.depth > 0 };
      }
    }
    return { value: null, fromFolderId: null, inherited: false };
  };

  return {
    folderId,
    ancestorPath: chain.map((r) => r.id),
    defaultPrompt: pick((r) => r.default_prompt),
    contextText: pick((r) => r.context_text),
    useCase: pick((r) => r.use_case),
    // The raw CTE bypasses drizzle's json codec, so parse here. A row written
    // outside drizzle could hold junk; treat unparseable as unset rather than 500.
    preferredModels: pick((r) => parseModelList(r.preferred_models)),
    approvalPolicy: pick((r) => r.approval_policy as FolderApprovalPolicy | null),
  };
}

/** Parse the stored JSON model list; null for absent, empty, or malformed. */
function parseModelList(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Write a folder's own settings. Only the keys present in `settings` are touched;
 * passing `null` for a key CLEARS it, which re-enables inheritance for that
 * setting — that is the only way to "unset" one.
 *
 * @param ctx      Core context.
 * @param folderId The folder to write.
 * @param settings Partial settings; `null` clears, absent leaves unchanged.
 * @returns The updated folder row.
 * @throws NotFoundError when the folder does not exist.
 * @throws ValidationError when no settings key was supplied.
 * @example await updateFolderSettings(ctx, id, { approvalPolicy: "always", useCase: null });
 */
export async function updateFolderSettings(
  ctx: CoreContext,
  folderId: string,
  settings: Partial<FolderSettings>,
): Promise<LibraryFolder> {
  await requireFolder(ctx, folderId);

  const patch: Partial<FolderSettings> & { updatedAt: Date } = { updatedAt: new Date() };
  // Explicit key-by-key so an unrelated field can never ride in from a surface.
  if ("defaultPrompt" in settings) patch.defaultPrompt = emptyToNull(settings.defaultPrompt);
  if ("contextText" in settings) patch.contextText = emptyToNull(settings.contextText);
  if ("useCase" in settings) patch.useCase = emptyToNull(settings.useCase);
  if ("approvalPolicy" in settings) patch.approvalPolicy = settings.approvalPolicy ?? null;
  if ("preferredModels" in settings) {
    const list = settings.preferredModels;
    patch.preferredModels = list && list.length > 0 ? list : null;
  }

  if (Object.keys(patch).length === 1) {
    throw new ValidationError("No folder settings supplied.");
  }

  const [row] = await ctx.db
    .update(libraryFolders)
    .set(patch)
    .where(eq(libraryFolders.id, folderId))
    .returning();
  return row;
}

/** Blank strings are a UI artefact of clearing a field — store them as NULL. */
function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
