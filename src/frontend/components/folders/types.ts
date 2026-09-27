/**
 * @fileoverview Shared types for the folder organiser, mirrored from what the
 * API actually returns (`GET /api/library/folders`, `/api/library`,
 * `/api/library/folders/:id/settings`). Kept in one file so the tree, the
 * contents grid and the settings panel cannot drift apart.
 */

/** A folder row as the API returns it. */
export interface FolderRow {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  defaultPrompt: string | null;
  contextText: string | null;
  useCase: string | null;
  preferredModels: string[] | null;
  approvalPolicy: "auto" | "masked_only" | "always" | null;
}

/** An image row as the API returns it. */
export interface ImageRow {
  id: string;
  publicId: string | null;
  title: string | null;
  description: string | null;
  role: "base" | "reference" | "inject" | null;
  kind: "stock" | "staged" | "generated";
  folderId: string | null;
  deliveryUrl: string;
  contentType: string | null;
  bytes: number | null;
  createdAt: string;
}

/**
 * One resolved setting: the value in force here, and where it came from.
 * `inherited: false` with a non-null `fromFolderId` means this folder sets it
 * itself — which is what lets the UI say "inherited from Kitchen remodel"
 * instead of showing a value with no explanation.
 */
export interface ResolvedSetting<T> {
  value: T | null;
  fromFolderId: string | null;
  inherited: boolean;
}

/** `GET /api/library/folders/:id/settings`. */
export interface ResolvedFolderSettings {
  folderId: string;
  defaultPrompt: ResolvedSetting<string>;
  contextText: ResolvedSetting<string>;
  useCase: ResolvedSetting<string>;
  preferredModels: ResolvedSetting<string[]>;
  approvalPolicy: ResolvedSetting<"auto" | "masked_only" | "always">;
  /** This folder first, root last. */
  ancestorPath: string[];
}

/** A folder plus its children, built client-side from the flat list. */
export interface FolderNode extends FolderRow {
  children: FolderNode[];
}

/**
 * Build the nesting from the flat rows the API returns.
 *
 * @param rows Every folder the caller can see.
 * @returns Root folders, each carrying its descendants. Rows whose parent is
 *   missing from `rows` are treated as roots, so a partial fetch still renders
 *   rather than silently dropping a subtree.
 * @example const roots = buildFolderTree(await apiGet("library/folders"))
 */
export function buildFolderTree(rows: FolderRow[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentFolderId ? byId.get(node.parentFolderId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name);
  const sort = (list: FolderNode[]) => {
    list.sort(byName);
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}
