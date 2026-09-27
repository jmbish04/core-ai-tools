/**
 * @fileoverview The nested folder tree, on ReUI's `tree` component
 * (@headless-tree). Reuse, not a hand-rolled tree: it ships keyboard
 * navigation, expand/collapse state and focus handling, all of which a
 * hand-rolled list loses.
 *
 * Creating a folder happens here because this is where a user is looking at the
 * shape of the tree. It posts to the same REST route the agent's MCP tool calls,
 * so both paths produce the same event and the same live update.
 *
 * Archiving lives here for the same reason, and so does the archive itself: the
 * tree is the only surface that shows what is NOT in it. `nodes` carries live
 * folders only (the API hides archived ones), so this component fetches the
 * archive on its own rather than growing a prop — the caller needs no change to
 * gain an undo. Archiving a folder takes its whole subtree with it, which the
 * confirm copy says out loud.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { ArchiveIcon, ArchiveRestoreIcon, FolderIcon, FolderOpenIcon, PlusIcon } from "lucide-react";

import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiSend } from "@/lib/api";
import type { FolderNode, FolderRow } from "./types";

/** Synthetic root: @headless-tree wants a single root id to hang the tree from. */
const ROOT = "__root__";

interface TreeEntry {
  name: string;
  children: string[];
}

/** Flatten the nested folders into the id → item map the tree loader wants. */
function toItemMap(nodes: FolderNode[]): Record<string, TreeEntry> {
  const items: Record<string, TreeEntry> = {
    [ROOT]: { name: "Library", children: nodes.map((n) => n.id) },
  };
  const walk = (list: FolderNode[]) => {
    for (const node of list) {
      items[node.id] = { name: node.name, children: node.children.map((c) => c.id) };
      walk(node.children);
    }
  };
  walk(nodes);
  return items;
}

export function FolderTree({
  nodes,
  loading,
  selectedId,
  onSelect,
  onChanged,
}: {
  nodes: FolderNode[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Called after a mutation so the caller can refetch. */
  onChanged: () => void;
}) {
  const items = useMemo(() => toItemMap(nodes), [nodes]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState<FolderRow[] | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** The archive is a separate listing — the live tree deliberately excludes it. */
  const loadArchive = useCallback(async () => {
    const res = await apiGet<{ folders: FolderRow[] }>("library/folders", { archived: "only" });
    setArchived(res.folders);
  }, []);

  // Read it once, and again when the section is opened — an archive done by the
  // agent or another surface is then visible without costing a second request on
  // every folder mutation for a panel that is usually closed.
  useEffect(() => {
    void loadArchive();
  }, [loadArchive, showArchive]);

  /**
   * Archive / restore. No confirm dialog (browser alerts are banned here, and the
   * action is reversible from the Archived list right below), but a refusal MUST
   * be visible: restoring into a still-archived parent is a 422 with a message
   * that tells the user what to do, and swallowing it would look like a dead
   * button.
   */
  const act = async (verb: "archive" | "restore", id: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await apiSend("POST", `library/folders/${id}/${verb}`);
      if (verb === "archive") setShowArchive(true);
      onChanged();
      await loadArchive();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : `Could not ${verb} that folder.`);
    } finally {
      setBusy(false);
    }
  };

  const tree = useTree<TreeEntry>({
    rootItemId: ROOT,
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => (item.getItemData()?.children.length ?? 0) > 0,
    dataLoader: {
      getItem: (id) => items[id],
      getChildren: (id) => items[id]?.children ?? [],
    },
    indent: 16,
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  // The loader closes over `items`, so a folder created elsewhere (or by the
  // agent) only appears once the tree is told to re-read.
  useEffect(() => {
    tree.rebuildTree();
  }, [items, tree]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await apiSend("POST", "library/folders", {
        name: trimmed,
        // New folders land inside whatever is selected — the usual intent when
        // you are looking at a folder and press New.
        parentFolderId: selectedId,
      });
      setName("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-card border-border rounded-lg border p-3">
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="text-foreground text-sm font-semibold">Folders</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
        >
          <PlusIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">New folder</span>
        </Button>
      </header>

      {adding ? (
        <div className="mb-2 flex gap-2 px-1">
          <Input
            autoFocus
            value={name}
            placeholder={selectedId ? "Name — inside the selected folder" : "Name"}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setAdding(false);
            }}
            className="h-8"
          />
          <Button size="sm" className="h-8" disabled={busy || !name.trim()} onClick={() => void create()}>
            Add
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2 p-1">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-sm">
          No folders yet. Create one to start organising images.
        </p>
      ) : (
        <Tree tree={tree} indent={16} className="max-h-[60svh] overflow-auto">
          {tree.getItems().map((item) => {
            const id = item.getId();
            if (id === ROOT) return null;
            const isSelected = id === selectedId;
            return (
              <TreeItem key={id} item={item} className="group cursor-pointer">
                <TreeItemLabel
                  onClick={() => onSelect(id)}
                  className={isSelected ? "bg-accent text-accent-foreground" : undefined}
                >
                  <span className="flex w-full items-center gap-2">
                    {item.isExpanded() ? (
                      <FolderOpenIcon className="text-muted-foreground size-4" aria-hidden="true" />
                    ) : (
                      <FolderIcon className="text-muted-foreground size-4" aria-hidden="true" />
                    )}
                    <span className="truncate">{item.getItemName()}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      title="Archive this folder and everything nested inside it"
                      className="ms-auto size-6 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={(e) => {
                        // The label's click selects the folder; archiving must not.
                        e.stopPropagation();
                        void act("archive", id);
                      }}
                    >
                      <ArchiveIcon className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Archive {item.getItemName()}</span>
                    </Button>
                  </span>
                </TreeItemLabel>
              </TreeItem>
            );
          })}
        </Tree>
      )}

      {failure ? (
        <p role="alert" className="text-destructive mt-2 px-1 text-xs">
          {failure}
        </p>
      ) : null}

      {archived && archived.length > 0 ? (
        <div className="border-border/60 mt-3 border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-1 text-xs"
            aria-expanded={showArchive}
            onClick={() => setShowArchive((v) => !v)}
          >
            <ArchiveIcon className="text-muted-foreground size-3.5" aria-hidden="true" />
            Archived ({archived.length})
          </Button>

          {showArchive ? (
            <ul className="mt-1 space-y-1">
              {archived.map((folder) => (
                <li key={folder.id} className="flex items-center gap-2 px-1">
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                    {folder.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => void act("restore", folder.id)}
                  >
                    <ArchiveRestoreIcon className="size-3.5" aria-hidden="true" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
