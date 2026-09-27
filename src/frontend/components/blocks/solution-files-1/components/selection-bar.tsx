import { Button } from "@/components/ui/button"
import { formatBytes, formatCount } from "./data"
import { DownloadIcon, Share2Icon, Trash2Icon } from "lucide-react"

// Icon names must stay static literals; prettier-ignore keeps the table flat.
// prettier-ignore
const ACTION_ICONS = {
  download: <DownloadIcon data-icon="inline-start" aria-hidden="true" />,
  share: <Share2Icon data-icon="inline-start" aria-hidden="true" />,
  remove: <Trash2Icon data-icon="inline-start" aria-hidden="true" />,
}

export function DriveSelectionBar({
  selectedCount,
  selectedBytes,
  onDownload,
  onShare,
  onRemove,
  onClear,
}: {
  selectedCount: number
  selectedBytes: number
  onDownload: () => void
  onShare: () => void
  onRemove: () => void
  onClear: () => void
}) {
  return (
    <div className="bg-muted/25 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
      <span className="shrink-0 text-sm font-medium">
        {formatCount(selectedCount)} selected
        <span className="text-muted-foreground ms-2 font-normal tabular-nums">
          {formatBytes(selectedBytes)}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDownload}>
          {ACTION_ICONS.download}
          Download
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onShare}>
          {ACTION_ICONS.share}
          Share
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onRemove}
        >
          {ACTION_ICONS.remove}
          Remove
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}