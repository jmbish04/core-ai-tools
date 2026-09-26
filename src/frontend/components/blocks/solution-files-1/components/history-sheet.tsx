import { useRef } from "react"
import { Badge } from "@/components/reui/badge"
import { IconTile } from "@/components/reui/icon-tile"
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline"
import { cn } from "cn"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  FILE_KIND_ICONS,
  formatBytes,
  getInitials,
  type DriveRow,
  type FileVersion,
  type VersionKind,
} from "./data"
import { PlusIcon, PencilIcon, RotateCcwIcon, Share2Icon, XIcon, DownloadIcon } from "lucide-react"

// prettier-ignore
const KIND_ICON: Record<VersionKind, React.ReactNode> = {
  created: <PlusIcon aria-hidden="true" />,
  edited: <PencilIcon aria-hidden="true" />,
  restored: <RotateCcwIcon aria-hidden="true" />,
  shared: <Share2Icon aria-hidden="true" />,
}

// prettier-ignore
const SHEET_ICONS = {
  close: <XIcon aria-hidden="true" />,
  download: <DownloadIcon data-icon="inline-start" aria-hidden="true" />,
}

function VersionRow({
  version,
  step,
  onRestore,
  onDownload,
}: {
  version: FileVersion
  step: number
  onRestore: (version: FileVersion) => void
  onDownload: (version: FileVersion) => void
}) {
  return (
    <TimelineItem
      step={step}
      className="group-data-[orientation=vertical]/timeline:ms-9 group-data-[orientation=vertical]/timeline:not-last:pb-4"
    >
      <TimelineHeader className="flex min-w-0 items-start justify-between gap-2.5">
        <TimelineSeparator className="bg-border! group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.5rem)] group-data-[orientation=vertical]/timeline:w-px! group-data-[orientation=vertical]/timeline:translate-y-7" />
        <TimelineIndicator className="border-border! group-data-completed/timeline-item:border-border! bg-background text-muted-foreground flex size-6 items-center justify-center rounded-full border group-data-[orientation=vertical]/timeline:-left-7 [&_svg]:size-3">
          {KIND_ICON[version.kind]}
        </TimelineIndicator>

        <TimelineTitle className="flex min-w-0 items-center gap-2 text-sm leading-5">
          <span className="text-foreground font-medium">{version.label}</span>
          {version.current ? (
            <Badge variant="primary-light">Current</Badge>
          ) : null}
        </TimelineTitle>

        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatBytes(version.sizeBytes)}
        </span>
      </TimelineHeader>

      <TimelineContent className="flex min-w-0 flex-col items-start gap-2 pb-1">
        <p className="text-muted-foreground text-sm leading-5">
          {version.summary}
        </p>
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <Avatar className="size-5 shrink-0">
              {version.actor.avatar ? (
                <AvatarImage src={version.actor.avatar} alt="" />
              ) : null}
              <AvatarFallback className="text-[9px]">
                {getInitials(version.actor.name)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate">{version.actor.name}</span>
            <span
              aria-hidden
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="shrink-0 tabular-nums">{version.timeLabel}</span>
          </span>

          {/* The head revision has nothing to restore to */}
          <span className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onDownload(version)}
            >
              Download
            </Button>
            {version.current ? null : (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onRestore(version)}
              >
                Restore
              </Button>
            )}
          </span>
        </div>
      </TimelineContent>
    </TimelineItem>
  )
}

export function HistorySheet({
  target,
  versions,
  onOpenChange,
  onRestore,
  onDownload,
}: {
  target: DriveRow | null
  versions: FileVersion[]
  onOpenChange: (open: boolean) => void
  onRestore: (version: FileVersion) => void
  onDownload: (version: FileVersion) => void
}) {
  const focusRef = useRef<HTMLDivElement | null>(null)

  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent
        ref={focusRef}
        side="right"
        showCloseButton={false}
        initialFocus={focusRef}
        tabIndex={-1}
        className="inset-y-4 right-4 left-auto flex h-[calc(100svh-2rem)] w-[min(28rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 outline-none"
      >
        {target ? (
          <>
            <SheetHeader className="shrink-0 gap-3 border-b px-4 pt-4 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <IconTile variant="elevated" aria-hidden="true">
                    {FILE_KIND_ICONS[target.node.kind]}
                  </IconTile>
                  <div className="min-w-0">
                    <SheetTitle className="truncate text-sm">
                      {target.node.name}
                    </SheetTitle>
                    <SheetDescription className="truncate text-xs">
                      {versions.length} revisions
                    </SheetDescription>
                  </div>
                </div>
                <SheetClose
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close"
                      className="-me-1.5 -mt-1.5"
                    >
                      {SHEET_ICONS.close}
                    </Button>
                  }
                />
              </div>
            </SheetHeader>

            {/* min-h-0 lets the body shrink so the footer stays pinned */}
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="px-4 py-4">
                  <Timeline defaultValue={versions.length}>
                    {versions.map((version, index) => (
                      <VersionRow
                        key={version.id}
                        version={version}
                        step={versions.length - index}
                        onRestore={onRestore}
                        onDownload={onDownload}
                      />
                    ))}
                  </Timeline>
                </div>
              </ScrollArea>
            </div>

            <SheetFooter className="shrink-0 border-t px-4 py-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onDownload(versions[0])}
              >
                {SHEET_ICONS.download}
                Download Current
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}