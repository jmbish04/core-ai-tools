/**
 * @fileoverview The nested folder tree, on ReUI's `tree` component
 * (@headless-tree). Reuse, not a hand-rolled tree: it ships keyboard
 * navigation, expand/collapse state and focus handling, all of which a
 * hand-rolled list loses.
 *
 * Creating a folder happens here because this is where a user is looking at the
 * shape of the tree. It posts to the same REST route the agent's MCP tool calls,
 * so both paths produce the same event and the same live update.
 */

import { useEffect, useMemo, useState } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { FolderIcon, FolderOpenIcon, PlusIcon } from "lucide-react";

import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiSend } from "@/lib/api";
import type { FolderNode } from "./types";

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
              <TreeItem key={id} item={item} className="cursor-pointer">
                <TreeItemLabel
                  onClick={() => onSelect(id)}
                  className={isSelected ? "bg-accent text-accent-foreground" : undefined}
                >
                  <span className="flex items-center gap-2">
                    {item.isExpanded() ? (
                      <FolderOpenIcon className="text-muted-foreground size-4" aria-hidden="true" />
                    ) : (
                      <FolderIcon className="text-muted-foreground size-4" aria-hidden="true" />
                    )}
                    {item.getItemName()}
                  </span>
                </TreeItemLabel>
              </TreeItem>
            );
          })}
        </Tree>
      )}
    </section>
  );
}
