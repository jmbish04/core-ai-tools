import { Fragment, type ReactNode } from "react"
import { Badge } from "@/components/reui/badge"
import { type DataGridFeatures } from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import {
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
} from "@/components/reui/data-grid/data-grid-table"
import { type ColumnDef } from "@tanstack/react-table"
import { cn } from "cn"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  FILE_KIND_ICONS,
  formatBytes,
  formatCount,
  getInitials,
  type DriveRow,
  type FileKind,
} from "./data"
import { RotateCcwIcon, Trash2Icon, Share2Icon, LinkIcon, PencilIcon, StarIcon, FolderIcon, ClockIcon, DownloadIcon, EllipsisVerticalIcon } from "lucide-react"

// Type sorts by glyph family first and only then by the exact format, so a sort
// on Type lands folders above files the way a drive reads.
const TYPE_RANK: Record<FileKind, number> = {
  folder: 0,
  document: 1,
  image: 2,
  video: 3,
  archive: 4,
  code: 5,
  file: 6,
}

// Icon names must stay static literals, so each whole node lives in the table.
// prettier-ignore
// Icon names must stay static literals; prettier-ignore keeps the table flat.
// prettier-ignore
const BIN_ICONS = {
  restore: <RotateCcwIcon aria-hidden="true" />,
  deleteForever: <Trash2Icon aria-hidden="true" />,
}

const ROW_ACTIONS: {
  id: string
  label: string
  icon: ReactNode
  destructive?: boolean
}[] = [
  {
    id: "share",
    label: "Share",
    icon: (
      <Share2Icon aria-hidden="true" />
    ),
  },
  {
    id: "link",
    label: "Copy Link",
    icon: (
      <LinkIcon aria-hidden="true" />
    ),
  },
  {
    id: "rename",
    label: "Rename",
    icon: (
      <PencilIcon aria-hidden="true" />
    ),
  },
  {
    id: "star",
    label: "Star",
    icon: (
      <StarIcon aria-hidden="true" />
    ),
  },
  {
    id: "move",
    label: "Move",
    icon: (
      <FolderIcon aria-hidden="true" />
    ),
  },
  {
    id: "history",
    label: "Version History",
    icon: (
      <ClockIcon aria-hidden="true" />
    ),
  },
  {
    id: "download",
    label: "Download",
    icon: (
      <DownloadIcon aria-hidden="true" />
    ),
  },
  {
    id: "remove",
    label: "Move To Trash",
    destructive: true,
    icon: (
      <Trash2Icon aria-hidden="true" />
    ),
  },
]

function DriveNameCell({
  row,
  onOpen,
  onToggleStar,
  upload,
}: {
  row: DriveRow
  onOpen: (row: DriveRow) => void
  onToggleStar: (row: DriveRow) => void
  /** Present only while the transfer is running or has failed. */
  upload?: { progress: number; status: "uploading" | "error" | "done" }
}) {
  const { node } = row
  const isFolder = node.kind === "folder"

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* Glyph stays bare: at row density a tile around every icon reads as a
          second checkbox column. While a file is uploading the slot shows the
          ring INSTEAD of the file icon, not around it: one slot carries one
          signal, and the icon returns the moment the transfer settles. */}
      <span
        aria-hidden={upload?.status === "uploading" ? undefined : "true"}
        role={upload?.status === "uploading" ? "progressbar" : undefined}
        aria-valuenow={
          upload?.status === "uploading"
            ? Math.round(upload.progress)
            : undefined
        }
        aria-valuemin={upload?.status === "uploading" ? 0 : undefined}
        aria-valuemax={upload?.status === "uploading" ? 100 : undefined}
        aria-label={
          upload?.status === "uploading" ? `Uploading ${node.name}` : undefined
        }
        className={cn(
          "flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
          isFolder ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {upload?.status === "uploading" ? (
          <svg className="size-4 -rotate-90" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground/25"
            />
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 6}
              strokeDashoffset={2 * Math.PI * 6 * (1 - upload.progress / 100)}
              className="text-primary transition-[stroke-dashoffset] duration-300"
            />
          </svg>
        ) : (
          FILE_KIND_ICONS[node.kind]
        )}
      </span>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className="hover:text-primary text-foreground min-w-0 truncate text-start text-sm transition-colors"
      >
        <span
          className={cn("truncate", isFolder ? "font-semibold" : "font-medium")}
        >
          {node.name}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-pressed={node.starred}
        aria-label={node.starred ? `Unstar ${node.name}` : `Star ${node.name}`}
        className={cn(
          "-ms-1 shrink-0 transition-opacity",
          !node.starred &&
            "text-muted-foreground/60 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        )}
        onClick={() => onToggleStar(row)}
      >
        {/* prettier-ignore */}
        <StarIcon className={cn( "size-3.5", node.starred && "text-warning fill-current" )} aria-hidden="true" />
      </Button>
    </div>
  )
}

function DriveOwnerCell({ row }: { row: DriveRow }) {
  const { owner } = row.node

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-5 shrink-0">
        {owner.avatar ? <AvatarImage src={owner.avatar} alt="" /> : null}
        <AvatarFallback className="text-[9px]">
          {getInitials(owner.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-foreground min-w-0 truncate text-sm">
        {owner.name}
      </span>
    </div>
  )
}

function DriveSizeCell({ row }: { row: DriveRow }) {
  const isFolder = row.node.kind === "folder"

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground text-sm tabular-nums">
        {formatBytes(row.sizeBytes)}
      </span>
      {isFolder ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatCount(row.itemCount)} items
        </span>
      ) : null}
    </div>
  )
}

function DriveActionsCell({
  row,
  onAction,
}: {
  row: DriveRow
  onAction: (action: string, row: DriveRow) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${row.node.name}`}
          >
            {/* prettier-ignore */}
            <EllipsisVerticalIcon className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        {ROW_ACTIONS.map((action) => (
          <Fragment key={action.id}>
            {action.destructive ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : undefined}
              onClick={() => onAction(action.id, row)}
            >
              {action.icon}
              {action.id === "star" && row.node.starred
                ? "Unstar"
                : action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DriveModifiedCell({ row }: { row: DriveRow }) {
  const { owner, modifiedLabel } = row.node

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground text-sm">{modifiedLabel}</span>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
        <Avatar className="size-3.5 shrink-0">
          {owner.avatar ? <AvatarImage src={owner.avatar} alt="" /> : null}
          <AvatarFallback className="text-[8px]">
            {getInitials(owner.name)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">{owner.name}</span>
      </span>
    </div>
  )
}

/** Sorting/hiding/resizing are uniform, so only the varying bits are passed. */
type ColSpec = Partial<ColumnDef<DataGridFeatures, DriveRow>> & {
  id: string
  headerTitle: string
}

function col(spec: ColSpec): ColumnDef<DataGridFeatures, DriveRow> {
  const { headerTitle, meta, ...rest } = spec
  return {
    header: ({ column }) => (
      <DataGridColumnHeader column={column} visibility={true} />
    ),
    enableSorting: true,
    enableHiding: true,
    enableResizing: false,
    ...rest,
    meta: { headerTitle, ...meta },
  } as ColumnDef<DataGridFeatures, DriveRow>
}

export function createDriveColumns({
  onOpen,
  onAction,
  onToggleStar,
  uploads,
  binMode = false,
  onRestore,
  onDeleteForever,
}: {
  onOpen: (row: DriveRow) => void
  onAction: (action: string, row: DriveRow) => void
  onToggleStar: (row: DriveRow) => void
  /** Transfer state per node id. Absent ids are settled files and render plain. */
  uploads?: Record<
    string,
    { progress: number; status: "uploading" | "error" | "done" }
  >
  /** Bin rows are deleted items: they restore or go for good, nothing else. */
  binMode?: boolean
  onRestore?: (id: string) => void
  onDeleteForever?: (id: string) => void
}): ColumnDef<DataGridFeatures, DriveRow>[] {
  return [
    {
      id: "select",
      header: () => <DataGridTableRowSelectAll />,
      cell: ({ row }) => <DataGridTableRowSelect row={row} />,
      size: 32,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
    },
    col({
      id: "name",
      headerTitle: "Name",
      accessorFn: (row) => row.node.name,
      cell: ({ row }) => (
        <DriveNameCell
          row={row.original}
          onOpen={onOpen}
          onToggleStar={onToggleStar}
          upload={uploads?.[row.original.node.id]}
        />
      ),
      size: 300,
      minSize: 140,
      enableHiding: false,
      // Name absorbs the free width, so long names ellipsize instead of
      // squeezing every other column.
      meta: { autoSize: true },
    }),
    col({
      id: "owner",
      headerTitle: "Owner",
      accessorFn: (row) => row.node.owner.name,
      cell: ({ row }) => <DriveOwnerCell row={row.original} />,
      size: 160,
    }),
    col({
      id: "type",
      headerTitle: "Type",
      accessorFn: (row) => row.node.typeLabel,
      cell: ({ row }) => (
        <Badge variant="outline" className="font-normal">
          {row.original.node.typeLabel}
        </Badge>
      ),
      size: 84,
      sortFn: (rowA, rowB) => {
        const delta =
          TYPE_RANK[rowA.original.node.kind] -
          TYPE_RANK[rowB.original.node.kind]
        return delta !== 0
          ? delta
          : rowA.original.node.typeLabel.localeCompare(
              rowB.original.node.typeLabel
            )
      },
    }),
    col({
      id: "size",
      headerTitle: "Size",
      accessorFn: (row) => row.sizeBytes,
      cell: ({ row }) => <DriveSizeCell row={row.original} />,
      size: 92,
      sortFn: "basic",
    }),
    col({
      id: "modified",
      headerTitle: "Modified",
      accessorFn: (row) => row.node.modifiedAt,
      cell: ({ row }) => <DriveModifiedCell row={row.original} />,
      size: 128,
      sortFn: "text",
    }),
    {
      id: "actions",
      header: "",
      // A bin row is a deleted item, not a live file: the usual row menu does
      // not apply to it, so the same column carries restore and delete-forever
      // instead of swapping the whole table out.
      cell: ({ row }) =>
        binMode ? (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Restore ${row.original.node.name}`}
              onClick={() => onRestore?.(row.original.id)}
            >
              {BIN_ICONS.restore}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${row.original.node.name} forever`}
              onClick={() => onDeleteForever?.(row.original.id)}
            >
              {BIN_ICONS.deleteForever}
            </Button>
          </div>
        ) : (
          <DriveActionsCell row={row.original} onAction={onAction} />
        ),
      size: binMode ? 96 : 56,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
    },
  ]
}