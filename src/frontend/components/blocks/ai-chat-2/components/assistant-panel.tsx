import { Badge } from "@/components/reui/badge"
import { IconTile } from "@/components/reui/icon-tile"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChatEmpty, ChatThread } from "./chat-thread"
import { Composer } from "./composer"
import {
  ASSISTANT_NAME,
  THREADS,
  type DraftPayload,
  type TranscriptRecord,
} from "./data"
import { PanelRightIcon, XIcon, SparklesIcon, PlusIcon } from "lucide-react"

/** Static icon nodes: the shadcn CLI cannot resolve icon names from props. */
const ICON_UNDOCK = (
  <PanelRightIcon aria-hidden="true" />
)

const ICON_CLOSE = (
  <XIcon aria-hidden="true" />
)

export function AssistantPanel({
  showEmpty,
  transcript,
  streaming,
  stopped,
  stoppedIds,
  arrivingId,
  drafted,
  modelId,
  onModelChange,
  onToggleDraft,
  onSend,
  onStop,
  onNewChat,
  onOpenThread,
  onRetry,
  onArrived,
  threadTitle,
  overlay,
  onClose,
}: {
  /** True right after New chat, when the panel is showing its zero state. */
  showEmpty: boolean
  transcript: TranscriptRecord
  streaming: boolean
  stopped: boolean
  /** Settled replies that were stopped, so their note is not lost. */
  stoppedIds: string[]
  arrivingId: string | null
  drafted: boolean
  modelId: string
  onModelChange: (id: string) => void
  onToggleDraft: (draft: DraftPayload) => void
  onSend: (text: string) => void
  onStop: () => void
  onNewChat: () => void
  onOpenThread: (id: string) => void
  onRetry: () => void
  /** Fired once by the reveal when the arriving reply finishes typing. */
  onArrived: () => void
  /** Names the open conversation in the header. */
  threadTitle: string
  /** True in the sheet, where dismissing reads as close, not as undock. */
  overlay: boolean
  onClose: () => void
}) {
  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconTile variant="elevated" size="sm" aria-hidden="true">
          <SparklesIcon aria-hidden="true" />
        </IconTile>
        <h2 className="min-w-0 truncate text-sm font-medium">
          {showEmpty ? ASSISTANT_NAME : threadTitle}
        </h2>
        {streaming ? (
          <Badge variant="primary-light" className="shrink-0">
            Working
          </Badge>
        ) : null}

        <div className="ms-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New chat"
                  onClick={onNewChat}
                />
              }
            >
              <PlusIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={overlay ? "Close assistant" : "Collapse panel"}
                  onClick={onClose}
                />
              }
            >
              {overlay ? ICON_CLOSE : ICON_UNDOCK}
            </TooltipTrigger>
            <TooltipContent>
              {overlay ? "Close assistant" : "Collapse panel"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {showEmpty ? (
        <ChatEmpty
          threads={THREADS}
          onStart={onSend}
          onOpenThread={onOpenThread}
        />
      ) : (
        <ChatThread
          transcript={transcript}
          streaming={streaming}
          stopped={stopped}
          stoppedIds={stoppedIds}
          arrivingId={arrivingId}
          drafted={drafted}
          onToggleDraft={onToggleDraft}
          onSend={onSend}
          onRetry={onRetry}
          onArrived={onArrived}
        />
      )}

      <Composer
        streaming={streaming}
        modelId={modelId}
        onModelChange={onModelChange}
        onSend={onSend}
        onStop={onStop}
      />
    </div>
  )
}