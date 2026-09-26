import { Badge } from "@/components/reui/badge"
import { IconTile } from "@/components/reui/icon-tile"
import { cn } from "@/lib/utils"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Item, ItemContent, ItemFooter } from "@/components/ui/item"
import {
  FILE_KIND_ICONS,
  formatBytes,
  formatCount,
  getInitials,
  type DriveRow,
} from "./data"
import { type DriveProperty } from "./view-settings"
import { StarIcon } from "lucide-react"

function FileTile({
  row,
  visibleProperties,
  selected,
  onOpen,
  onSelectChange,
  onToggleStar,
}: {
  row: DriveRow
  visibleProperties: Record<DriveProperty, boolean>
  selected: boolean
  onOpen: (row: DriveRow) => void
  onSelectChange: (row: DriveRow, next: boolean) => void
  onToggleStar: (row: DriveRow) => void
}) {
  const { node } = row
  const isFolder = node.kind === "folder"
  const showMeta = visibleProperties.type || visibleProperties.size
  const showFooter = visibleProperties.owner || visibleProperties.modified

  return (
    <Item
      variant="outline"
      className={cn(
        "group/tile h-full min-w-0 flex-col flex-nowrap items-stretch gap-0! overflow-hidden p-0!",
        selected && "border-primary"
      )}
    >
      {/* Preview. No rule under it: the tint already reads as its own band,
          and a border there cut the tile into two boxes. */}
      <div className="bg-muted/30 relative flex min-h-28 items-center justify-center">
        {/* Always visible: a hover-only checkbox is unreachable on touch. */}
        <span className="absolute start-2 top-2">
          <Checkbox
            checked={selected}
            onCheckedChange={(next) => onSelectChange(row, next === true)}
            aria-label={`Select ${node.name}`}
          />
        </span>
        <IconTile variant="elevated" aria-hidden="true">
          {FILE_KIND_ICONS[node.kind]}
        </IconTile>
      </div>

      <ItemContent className="min-w-0 gap-1.5 p-3">
        {/* Two lines are reserved whether the name needs them or not, so the
            meta line below starts at one y across the whole row. */}
        <div className="flex min-h-10 min-w-0 items-start gap-0.5">
          <button
            type="button"
            onClick={() => onOpen(row)}
            className="hover:text-primary text-foreground min-w-0 text-start text-sm transition-colors"
          >
            <span
              className={cn(
                "line-clamp-2 leading-5",
                isFolder ? "font-semibold" : "font-medium"
              )}
            >
              {node.name}
            </span>
          </button>
          {/* Rides with the label rather than the tile's right edge */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-pressed={node.starred}
            aria-label={
              node.starred ? `Unstar ${node.name}` : `Star ${node.name}`
            }
            className={cn(
              "-mt-0.5 shrink-0",
              !node.starred &&
                "text-muted-foreground/50 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
            )}
            onClick={() => onToggleStar(row)}
          >
            {/* prettier-ignore */}
            <StarIcon className={cn( "size-3.5", node.starred && "text-warning fill-current" )} aria-hidden="true" />
          </Button>
        </div>

        {/* One meta line: the badge carries the format, the rest is plain text
            so the row never wraps into a second, ragged line. */}
        {showMeta ? (
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            {visibleProperties.type ? (
              <Badge variant="outline" className="shrink-0 font-normal">
                {node.typeLabel}
              </Badge>
            ) : null}
            {visibleProperties.size ? (
              <span className="flex min-w-0 items-center gap-1.5 truncate tabular-nums">
                {formatBytes(row.sizeBytes)}
                {isFolder ? (
                  <>
                    <span
                      aria-hidden
                      className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                    />
                    {formatCount(row.itemCount)} items
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
        ) : null}
      </ItemContent>

      {showFooter ? (
        <ItemFooter className="mt-auto basis-auto! items-center justify-between gap-2 border-t px-3 py-2">
          {visibleProperties.owner ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <Avatar className="size-5 shrink-0">
                {node.owner.avatar ? (
                  <AvatarImage src={node.owner.avatar} alt="" />
                ) : null}
                <AvatarFallback className="text-[9px]">
                  {getInitials(node.owner.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {node.owner.name}
              </span>
            </div>
          ) : (
            <span />
          )}
          {visibleProperties.modified ? (
            <span className="text-muted-foreground shrink-0 text-xs">
              {node.modifiedLabel}
            </span>
          ) : null}
        </ItemFooter>
      ) : null}
    </Item>
  )
}

export function FileCardGrid({
  rows,
  visibleProperties,
  selectedIds,
  onOpen,
  onSelectChange,
  onToggleStar,
}: {
  rows: DriveRow[]
  visibleProperties: Record<DriveProperty, boolean>
  selectedIds: ReadonlySet<string>
  onOpen: (row: DriveRow) => void
  onSelectChange: (row: DriveRow, next: boolean) => void
  onToggleStar: (row: DriveRow) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => (
        <FileTile
          key={row.id}
          row={row}
          visibleProperties={visibleProperties}
          selected={selectedIds.has(row.id)}
          onOpen={onOpen}
          onSelectChange={onSelectChange}
          onToggleStar={onToggleStar}
        />
      ))}
    </div>
  )
}