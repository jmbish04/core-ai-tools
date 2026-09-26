import { formatBytes } from "@/hooks/use-file-upload"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChevronDownIcon, ChevronUpIcon, XIcon, CircleCheckIcon, CircleAlertIcon, RefreshCwIcon, FileIcon } from "lucide-react"

export type UploadStatus = "uploading" | "error" | "done" | "rejected"

export interface UploadEntry {
  id: string
  name: string
  sizeBytes: number
  progress: number
  status: UploadStatus
}

// Icon names must stay static literals; prettier-ignore keeps the table flat.
// prettier-ignore
const PANEL_ICONS = {
  collapse: <ChevronDownIcon className="size-4" aria-hidden="true" />,
  expand: <ChevronUpIcon className="size-4" aria-hidden="true" />,
  close: <XIcon className="size-4" aria-hidden="true" />,
  done: <CircleCheckIcon className="size-4" aria-hidden="true" />,
  failed: <CircleAlertIcon className="size-4" aria-hidden="true" />,
  retry: <RefreshCwIcon aria-hidden="true" />,
  rowClose: <XIcon aria-hidden="true" />,
  file: <FileIcon className="size-4" aria-hidden="true" />,
}

/**
 * One line per transfer. The trailing cluster is a single toolbar rather than
 * loose siblings: every slot is the same 28px box as an `icon-sm` button, on
 * one tight gap, so the controls line up down the panel no matter which state
 * each row is in.
 */
function UploadRow({
  entry,
  onCancel,
  onRetry,
}: {
  entry: UploadEntry
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}) {
  const meta =
    entry.status === "uploading"
      ? `${Math.round(entry.progress)}% of ${formatBytes(entry.sizeBytes)}`
      : entry.status === "error"
        ? "Upload failed"
        : entry.status === "rejected"
          ? "Not uploaded"
          : formatBytes(entry.sizeBytes)

  const detail =
    entry.status === "uploading"
      ? `Uploading ${entry.name}, ${Math.round(entry.progress)}% of ${formatBytes(entry.sizeBytes)}`
      : entry.status === "error"
        ? "Upload failed. Retry, or discard it from the list."
        : entry.status === "rejected"
          ? entry.name
          : `Uploaded, ${formatBytes(entry.sizeBytes)}`

  return (
    <li className="flex items-center gap-2.5 py-2 ps-3 pe-1.5">
      <span className="text-muted-foreground shrink-0">{PANEL_ICONS.file}</span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{entry.name}</span>
        <span className="text-muted-foreground truncate text-xs">{meta}</span>
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        {/* Status shares the button footprint so the column reads as one rail. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex size-7 items-center justify-center" />
            }
          >
            {entry.status === "uploading" ? (
              <svg
                aria-hidden="true"
                className="size-4 -rotate-90"
                viewBox="0 0 16 16"
              >
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-muted-foreground/20"
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
                  strokeDashoffset={
                    2 * Math.PI * 6 * (1 - entry.progress / 100)
                  }
                  className="text-primary transition-[stroke-dashoffset] duration-300"
                />
              </svg>
            ) : entry.status === "done" ? (
              <span className="text-success">{PANEL_ICONS.done}</span>
            ) : (
              <span className="text-destructive">{PANEL_ICONS.failed}</span>
            )}
          </TooltipTrigger>
          <TooltipContent>{detail}</TooltipContent>
        </Tooltip>

        {entry.status === "error" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Retry upload of ${entry.name}`}
            onClick={() => onRetry(entry.id)}
          >
            {PANEL_ICONS.retry}
          </Button>
        ) : null}

        {entry.status === "done" ? null : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              entry.status === "uploading"
                ? `Cancel upload of ${entry.name}`
                : `Dismiss ${entry.name}`
            }
            onClick={() => onCancel(entry.id)}
          >
            {PANEL_ICONS.rowClose}
          </Button>
        )}
      </span>
    </li>
  )
}

export function UploadPanel({
  entries,
  collapsed,
  onToggleCollapsed,
  onClose,
  onCancel,
  onRetry,
}: {
  entries: UploadEntry[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onClose: () => void
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}) {
  if (entries.length === 0) return null

  const active = entries.filter((e) => e.status === "uploading").length
  const failed = entries.filter(
    (e) => e.status === "error" || e.status === "rejected"
  ).length
  // One honest headline: what is still running wins, then what broke, then the
  // finished count. Drive reads the same way.
  const heading =
    active > 0
      ? `Uploading ${active} ${active === 1 ? "item" : "items"}`
      : failed > 0
        ? `${failed} ${failed === 1 ? "upload" : "uploads"} failed`
        : `${entries.length} ${entries.length === 1 ? "upload" : "uploads"} complete`

  return (
    <TooltipProvider delay={300}>
      <section
        aria-label="Uploads"
        className="bg-popover text-popover-foreground absolute end-4 bottom-4 z-20 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-lg border shadow-lg"
      >
        <header className="flex items-center gap-1 border-b py-1.5 ps-3 pe-1.5">
          <h2 className="flex-1 truncate text-sm font-medium">{heading}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand uploads" : "Collapse uploads"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? PANEL_ICONS.expand : PANEL_ICONS.collapse}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close uploads"
            onClick={onClose}
          >
            {PANEL_ICONS.close}
          </Button>
        </header>

        {/* Collapsed keeps the header as a live status bar rather than hiding the
          panel, so a long transfer stays visible without holding the space. */}
        {/* ScrollArea rather than a raw overflow: the panel is a floating
            surface, so it gets the styled thin scrollbar the rest of the block
            uses. The max height belongs on the viewport, not the root. */}
        <ScrollArea
          className={cn(
            "**:data-[slot=scroll-area-viewport]:max-h-56",
            collapsed && "hidden"
          )}
        >
          <ul className="divide-y">
            {entries.map((entry) => (
              <UploadRow
                key={entry.id}
                entry={entry}
                onCancel={onCancel}
                onRetry={onRetry}
              />
            ))}
          </ul>
        </ScrollArea>
      </section>
    </TooltipProvider>
  )
}