/**
 * @fileoverview Nested folder tree for the library. Builds a headless-tree data
 * record from the flat folder list via parentFolderId. Selecting a node calls
 * onSelectFolder; the synthetic "__all__" root means "All images".
 */
import { useMemo } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Folder, FolderOpen, Images } from "lucide-react";

import { Tree, TreeItem, TreeItemLabel } from "@/components/ui/tree";

export interface FolderTreeFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
}
export interface FolderTreeProps {
  folders: FolderTreeFolder[];
  counts: Record<string, number>;
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
}

const ROOT = "__all__";
const indent = 20;

interface Node {
  name: string;
  children?: string[];
}

export function FolderTree({ folders, counts, activeFolderId, onSelectFolder }: FolderTreeProps) {
  const items = useMemo<Record<string, Node>>(() => {
    const childrenOf = (parent: string | null) =>
      folders.filter((f) => f.parentFolderId === parent).map((f) => f.id);
    const rec: Record<string, Node> = {
      [ROOT]: { name: "All images", children: childrenOf(null) },
    };
    for (const f of folders) rec[f.id] = { name: f.name, children: childrenOf(f.id) };
    return rec;
  }, [folders]);

  const tree = useTree<Node>({
    rootItemId: ROOT,
    initialState: { expandedItems: [ROOT] },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (id) => items[id],
      getChildren: (id) => items[id]?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  return (
    <Tree indent={indent} tree={tree}>
      {tree.getItems().map((item) => {
        const id = item.getId();
        const selectedId = activeFolderId ?? ROOT;
        const isActive = id === selectedId;
        const count = counts[id] ?? 0;
        const isRoot = id === ROOT;
        return (
          <TreeItem key={id} item={item}>
            <TreeItemLabel
              onClick={() => onSelectFolder(isRoot ? null : id)}
              className={`relative flex items-center justify-between ${
                isActive ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                {isRoot ? (
                  <Images className="size-4 text-primary" />
                ) : item.isExpanded() ? (
                  <FolderOpen className="size-4 text-amber-500" />
                ) : (
                  <Folder className="size-4 text-amber-500" />
                )}
                <span className="truncate">{item.getItemName()}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{count}</span>
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );
}
