import { Fragment, useMemo } from "react"
import {
  Tree,
  TreeItem,
  TreeItemLabel,
} from "@/components/reui/tree"
import {
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { DRIVE_NAME, DRIVE_ROOT_ID, formatBytes, type DriveRow } from "./data"
import { FolderPlusIcon, PencilIcon, FolderIcon, ClockIcon, DownloadIcon, Trash2Icon, UsersIcon, StarIcon } from "lucide-react"

export const TREE_ROOT_ID = "drive-tree-root"
export const TREE_INDENT = 20

export type DriveScope = "recent" | "starred" | "shared" | "bin"

/** Folder operations offered from the rail's right-click menu. */
export type FolderAction =
  "new" | "rename" | "move" | "history" | "download" | "delete"

/** What the browse panel is currently showing. */
export type DriveSelection =
  { type: "folder"; id: string } | { type: "scope"; id: DriveScope }

export interface FolderTreeNode {
  name: string
  children?: string[]
}

// prettier-ignore
const FOLDER_ACTIONS: { id: FolderAction; label: string; icon: React.ReactNode; separated?: boolean; destructive?: boolean }[] = [
  { id: "new", label: "New Folder", icon: <FolderPlusIcon aria-hidden="true" /> },
  { id: "rename", label: "Rename", icon: <PencilIcon aria-hidden="true" /> },
  { id: "move", label: "Move", separated: true, icon: <FolderIcon aria-hidden="true" /> },
  { id: "history", label: "Version History", icon: <ClockIcon aria-hidden="true" /> },
  { id: "download", label: "Download", icon: <DownloadIcon aria-hidden="true" /> },
  { id: "delete", label: "Move To Trash", separated: true, destructive: true, icon: <Trash2Icon aria-hidden="true" /> },
]

// prettier-ignore
const SCOPES: { id: DriveScope; label: string; icon: React.ReactNode }[] = [
  { id: "shared", label: "Shared With Me", icon: <UsersIcon aria-hidden="true" /> },
  { id: "recent", label: "Recent", icon: <ClockIcon aria-hidden="true" /> },
  { id: "starred", label: "Starred", icon: <StarIcon aria-hidden="true" /> },
  { id: "bin", label: "Bin", icon: <Trash2Icon aria-hidden="true" /> },
]

/** Flattens the row tree into the loader's id to node map, folders only. */
export function buildFolderNodes(rows: DriveRow[]) {
  const map: Record<string, FolderTreeNode> = {
    [TREE_ROOT_ID]: { name: DRIVE_NAME, children: [DRIVE_ROOT_ID] },
    [DRIVE_ROOT_ID]: { name: "My Drive", children: [] },
  }

  function walk(current: DriveRow[], parentId: string) {
    for (const row of current) {
      if (row.node.kind !== "folder") continue

      map[row.id] = { name: row.node.name, children: [] }
      map[parentId].children?.push(row.id)

      if (row.children) walk(row.children, row.id)
    }
  }

  walk(rows, DRIVE_ROOT_ID)
  return map
}

export function FolderTree({
  rows,
  selection,
  usedBytes,
  planBytes,
  onSelect,
  onGetStorage,
  onFolderAction,
  expandedItems,
  onExpandedChange,
  className,
}: {
  rows: DriveRow[]
  selection: DriveSelection
  usedBytes: number
  planBytes: number
  onSelect: (next: DriveSelection) => void
  onGetStorage: () => void
  onFolderAction: (action: FolderAction, folderId: string) => void
  expandedItems: string[]
  onExpandedChange: (next: string[]) => void
  className?: string
}) {
  const folderNodes = useMemo(() => buildFolderNodes(rows), [rows])

  const activeFolderId = selection.type === "folder" ? selection.id : ""

  const tree = useTree<FolderTreeNode>({
    state: { selectedItems: [activeFolderId], expandedItems },
    setSelectedItems: (updater) => {
      const next =
        typeof updater === "function" ? updater([activeFolderId]) : updater
      const nextId = next[0]
      if (nextId && folderNodes[nextId]) {
        onSelect({ type: "folder", id: nextId })
      }
    },
    setExpandedItems: (updater) =>
      onExpandedChange(
        typeof updater === "function" ? updater(expandedItems) : updater
      ),
    indent: TREE_INDENT,
    rootItemId: TREE_ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData().children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (itemId) => folderNodes[itemId],
      getChildren: (itemId) => folderNodes[itemId]?.children ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  const usedPercent = Math.min(100, Math.round((usedBytes / planBytes) * 100))
  const nearLimit = usedPercent >= 80

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      {/* Main nav: the folder tree owns the rail's scroll */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-2">
          <Tree indent={TREE_INDENT} tree={tree} className="w-full gap-0.5">
            {tree.getItems().map((item) => (
              <ContextMenu key={item.getId()}>
                <ContextMenuTrigger className="block w-full">
                  <TreeItem item={item} className="block w-full">
                    <TreeItemLabel className="in-data-[selected=true]:bg-accent w-full bg-transparent px-2 py-2">
                      <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
                        {/* prettier-ignore */}
                        <FolderIcon aria-hidden="true" />
                      </span>
                      <span className="min-w-0 truncate">
                        {item.getItemName()}
                      </span>
                    </TreeItemLabel>
                  </TreeItem>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  {/* The root is a synthetic node with no entry in the data,
                    so only the actions that do not need one survive there. */}
                  {(item.getId() === DRIVE_ROOT_ID
                    ? FOLDER_ACTIONS.filter((action) => action.id === "new")
                    : FOLDER_ACTIONS
                  ).map((action) => (
                    <Fragment key={action.id}>
                      {action.separated ? <ContextMenuSeparator /> : null}
                      <ContextMenuItem
                        variant={action.destructive ? "destructive" : undefined}
                        onClick={() => onFolderAction(action.id, item.getId())}
                      >
                        {action.icon}
                        {action.label}
                      </ContextMenuItem>
                    </Fragment>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </Tree>
        </div>
      </ScrollArea>

      <Separator />

      {/* Secondary links */}
      <div className="flex shrink-0 flex-col gap-0.5 p-2">
        {SCOPES.map((scope) => {
          const active = selection.type === "scope" && selection.id === scope.id

          return (
            <Button
              key={scope.id}
              type="button"
              variant={active ? "secondary" : "ghost"}
              className="h-8 w-full justify-start gap-2 px-2 font-normal"
              aria-pressed={active}
              onClick={() => onSelect({ type: "scope", id: scope.id })}
            >
              {scope.icon}
              {scope.label}
            </Button>
          )
        })}
      </div>

      <Separator />

      {/* Storage */}
      <div className="flex shrink-0 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground text-xs font-medium">Storage</span>
          <span
            className={cn(
              "text-xs tabular-nums",
              nearLimit ? "text-warning font-medium" : "text-muted-foreground"
            )}
          >
            {usedPercent}% full
          </span>
        </div>
        <Progress value={usedPercent} className="gap-0" />
        <p className="text-muted-foreground text-xs tabular-nums">
          {formatBytes(usedBytes)} of {formatBytes(planBytes)} used
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 w-full"
          onClick={onGetStorage}
        >
          Get More Storage
        </Button>
      </div>
    </div>
  )
}