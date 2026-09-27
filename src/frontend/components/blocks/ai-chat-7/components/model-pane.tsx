"use client"

import { useRef } from "react"
import { Badge } from "@/components/reui/badge"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useClock } from "./clock"
import {
  formatContext,
  modelById,
  MODELS,
  modelsByProvider,
  type TurnRecord,
} from "./data"
import { Dot } from "./dot"
import { PaneThread, useCopy } from "./pane-thread"
import {
  answerText,
  buildPaneView,
  formatSeconds,
  formatTokens,
  formatUsd,
  type PaneRecord,
} from "./pane-view"
import { QuoteReplyPill } from "./quote-pill"
import { CheckIcon, CopyIcon, RefreshCwIcon, EllipsisVerticalIcon, Trash2Icon } from "lucide-react"

/** Static icon nodes: the shadcn CLI cannot resolve icon names from props. */
const ICON_CHECK = (
  <CheckIcon data-icon="inline-start" aria-hidden="true" />
)

const ICON_COPY = (
  <CopyIcon data-icon="inline-start" aria-hidden="true" />
)

const ICON_REGENERATE = (
  <RefreshCwIcon aria-hidden="true" />
)

const ICON_MORE = (
  <EllipsisVerticalIcon aria-hidden="true" />
)

const ICON_CLEAR = (
  <Trash2Icon data-icon="inline-start" aria-hidden="true" />
)

/** Base UI renders the trigger value from this list when the popup is closed. */
const MODEL_OPTIONS = MODELS.map((model) => ({
  value: model.id,
  label: model.name,
}))

function CopyAnswer({ text, disabled }: { text: string; disabled: boolean }) {
  const { copied, copy } = useCopy()

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={() => copy(text)}
    >
      {copied ? ICON_CHECK : ICON_COPY}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/**
 * The pane's live state: a running clock while the answer arrives, the 429
 * flag when it never will, and nothing at all once it has settled.
 */
function PaneTimer({
  record,
  turns,
}: {
  record: PaneRecord
  turns: TurnRecord[]
}) {
  const clock = useClock()
  const newest = buildPaneView(record, turns, clock).newest
  if (!newest) return null

  if (newest.phase === "thinking" || newest.phase === "streaming")
    return (
      <Badge variant="primary-light" className="shrink-0 tabular-nums">
        <Spinner aria-hidden="true" />
        {formatSeconds(newest.elapsedMs)}
      </Badge>
    )

  if (newest.phase === "error")
    return (
      <Badge variant="destructive-light" className="shrink-0">
        Rate limited
      </Badge>
    )

  return null
}

/**
 * Copy plus the pane's running session meter, which only ever grows because
 * reruns append instead of replacing.
 */
function PaneFooter({
  record,
  turns,
}: {
  record: PaneRecord
  turns: TurnRecord[]
}) {
  const clock = useClock()
  const pane = buildPaneView(record, turns, clock)
  const newest = pane.newest
  const hasAnswer = (newest?.parts.length ?? 0) > 0

  // The empty pane keeps its zero state clean: no dead Copy, no zero meter.
  if (record.runs.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2">
      <CopyAnswer
        text={newest ? answerText(newest.parts) : ""}
        disabled={!hasAnswer}
      />
      <span className="text-muted-foreground ms-auto flex min-w-0 items-center gap-1.5 text-xs">
        <span className="shrink-0 tabular-nums">
          {pane.answers === 1 ? "1 answer" : `${pane.answers} answers`}
        </span>
        <Dot />
        <span className="truncate tabular-nums">
          {formatTokens(pane.outTokens)} tokens
        </span>
        <Dot />
        <span className="shrink-0 tabular-nums">{formatUsd(pane.costUsd)}</span>
      </span>
    </div>
  )
}

export function ModelPane({
  record,
  turns,
  limitCleared,
  compact,
  votes,
  canAct,
  onModelChange,
  onRetry,
  onRegenerate,
  onMatch,
  onSwap,
  onClear,
  onQuote,
}: {
  record: PaneRecord
  turns: TurnRecord[]
  /** False while the workspace is still over quota, which flags the picker. */
  limitCleared: boolean
  /** Mobile tabs own the model name, so the trigger drops down to provider. */
  compact?: boolean
  votes: Record<string, "a" | "b">
  /** False before the first prompt, when there is nothing to act on. */
  canAct: boolean
  onModelChange: (modelId: string) => void
  /** Addressed by run id, so Retry reruns only the answer that failed. */
  onRetry: (runId: string) => void
  /** Reruns this pane alone, leaving the other answer to compare against. */
  onRegenerate: () => void
  /** Puts this pane's model in both, which is how you read run to run variance. */
  onMatch: () => void
  onSwap: () => void
  onClear: () => void
  /** A line selected inside this pane, handed up to seed the next prompt. */
  onQuote: (quote: string, from: string) => void
}) {
  const model = modelById(record.modelId)
  const thread = useRef<HTMLDivElement>(null)

  return (
    <section
      aria-label={`${model.name} answers`}
      className="bg-background flex h-full min-h-0 min-w-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Select
          value={model.id}
          items={MODEL_OPTIONS}
          onValueChange={(next) => next && onModelChange(next)}
        >
          <SelectTrigger
            size="sm"
            aria-label={`Model, ${model.name}`}
            className={
              compact
                ? "min-w-0 font-medium"
                : "w-full max-w-56 min-w-0 font-medium"
            }
          >
            <SelectValue>
              {compact ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{model.provider}</span>
                  <Dot />
                  <span className="tabular-nums">
                    {formatContext(model.contextTokens)}
                  </span>
                </span>
              ) : (
                <span className="truncate">{model.name}</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            align="start"
            alignItemWithTrigger={false}
            className="w-72 min-w-(--anchor-width)!"
          >
            {/* Grouped by provider: the group heading carries the maker, so
                every row drops a segment and its separator. */}
            {modelsByProvider().map((group) => (
              <SelectGroup key={group.provider}>
                <SelectLabel>{group.provider}</SelectLabel>
                {group.models.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {option.name}
                      </span>
                      {option.rateLimited && !limitCleared ? (
                        <Badge variant="warning-light">Limited</Badge>
                      ) : null}
                      <Badge variant="info-light" className="tabular-nums">
                        {formatContext(option.contextTokens)}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          <PaneTimer record={record} turns={turns} />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Regenerate the ${model.name} answer`}
                  disabled={!canAct}
                  onClick={onRegenerate}
                />
              }
            >
              {ICON_REGENERATE}
            </TooltipTrigger>
            <TooltipContent>Regenerate</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More actions for ${model.name}`}
                />
              }
            >
              {ICON_MORE}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={!canAct} onClick={onMatch}>
                Match other pane
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSwap}>Swap panes</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={record.runs.length === 0}
                onClick={onClear}
              >
                {ICON_CLEAR}
                Clear this pane
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Positioned, because the quote pill is placed inside this pane's own
          box rather than over the page. */}
      <div ref={thread} className="relative flex min-h-0 flex-1 flex-col">
        <PaneThread
          record={record}
          turns={turns}
          votes={votes}
          onRetry={onRetry}
        />
        <QuoteReplyPill
          host={thread}
          modelName={model.name}
          onQuote={onQuote}
        />
      </div>

      <PaneFooter record={record} turns={turns} />
    </section>
  )
}