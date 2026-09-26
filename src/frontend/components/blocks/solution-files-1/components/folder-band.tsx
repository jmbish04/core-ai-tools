import { IconTile } from "@/components/reui/icon-tile"

import { Button } from "@/components/ui/button"
import { formatBytes, formatCount, type DriveRow } from "./data"
import { FolderIcon } from "lucide-react"

export function FolderBand({
  folders,
  onOpen,
}: {
  folders: DriveRow[]
  onOpen: (row: DriveRow) => void
}) {
  if (folders.length === 0) return null

  return (
    <div className="flex flex-col gap-2 px-4">
      <p className="text-muted-foreground text-xs font-medium">
        Suggested Folders
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {folders.map((folder) => (
          <Button
            key={folder.id}
            type="button"
            variant="outline"
            className="h-auto w-full justify-start! gap-2.5 px-2.5 py-2 text-start! font-normal"
            onClick={() => onOpen(folder)}
          >
            <IconTile variant="elevated" aria-hidden="true">
              {/* prettier-ignore */}
              <FolderIcon aria-hidden="true" />
            </IconTile>
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="text-foreground w-full truncate text-sm font-medium">
                {folder.node.name}
              </span>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
                {formatBytes(folder.sizeBytes)}
                <span
                  aria-hidden
                  className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                />
                {formatCount(folder.itemCount)} items
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}