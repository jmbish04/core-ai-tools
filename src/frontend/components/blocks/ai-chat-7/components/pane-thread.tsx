import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/reui/code-block/code-block"
import { cn } from "@/lib/utils"

import {
  Bubble,
  BubbleContent,
  BubbleReactions,
} from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item"
import {
  Marker,
  MarkerContent,
  MarkerIcon,
} from "@/components/ui/marker"
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useClock } from "./clock"
import {
  formatContext,
  modelById,
  RATE_LIMIT,
  SEPARATOR,
  VIEWER_NAME,
  type MessagePart,
  type ModelRecord,
  type TurnRecord,
} from "./data"
import { Dot } from "./dot"
import {
  answerText,
  buildPaneView,
  formatSeconds,
  formatTokens,
  runRate,
  type PaneRecord,
  type RunView,
} from "./pane-view"
import { useScrollSync } from "./scroll-sync"
import { TriangleAlertIcon, RefreshCwIcon, CheckIcon, CopyIcon, ThumbsUpIcon, ThumbsDownIcon, FileTextIcon, ChevronsUpDownIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react"

/** Static icon nodes: the shadcn CLI cannot resolve icon names from props. */
const ICON_ERROR = (
  <TriangleAlertIcon aria-hidden="true" />
)

const ICON_RETRY = (
  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
)

const ICON_VOTED = (
  <CheckIcon className="size-3" aria-hidden="true" />
)

const ICON_COPY = (
  <CopyIcon className="size-3.5" aria-hidden="true" />
)

const ICON_COPIED = (
  <CheckIcon className="size-3.5" aria-hidden="true" />
)

const ICON_LIKE = (
  <ThumbsUpIcon className="size-3.5" aria-hidden="true" />
)

const ICON_DISLIKE = (
  <ThumbsDownIcon className="size-3.5" aria-hidden="true" />
)

const ICON_FILE = (
  <FileTextIcon className="size-3 shrink-0" aria-hidden="true" />
)

const ICON_SORT_NONE = (
  <ChevronsUpDownIcon className="size-3 opacity-40" aria-hidden="true" />
)

const ICON_SORT_ASC = (
  <ChevronUpIcon className="size-3" aria-hidden="true" />
)

const ICON_SORT_DESC = (
  <ChevronDownIcon className="size-3" aria-hidden="true" />
)

/** Confirms only once the write resolves: the clipboard is denied on an
    unfocused document, so an optimistic tick would claim a copy that failed. */
export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  function copy(text: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1400)
      })
      .catch(() => setCopied(false))
  }

  return { copied, copy }
}

function CodeArtifact({
  part,
  streaming = false,
}: {
  part: Extract<MessagePart, { kind: "code" }>
  streaming?: boolean
}) {
  return (
    // w-full so the snippet fills the pane instead of the w-fit bubble sizing
    // itself to the widest line.
    <CodeBlock
      code={part.code}
      language={part.language}
      showLineNumbers
      streaming={streaming}
      className="w-full min-w-0"
    >
      <CodeBlockHeader>
        <CodeBlockTitle className="truncate">{part.filename}</CodeBlockTitle>
        <CodeBlockCopyButton className="ms-auto" />
      </CodeBlockHeader>
      {/* The cap goes on the VIEWPORT, not the root: the viewport is height
          100% of the root, so a root level cap clips without ever scrolling. */}
      <ScrollArea className="rounded-(--code-block-radius) **:data-[slot=scroll-area-viewport]:max-h-72">
        <CodeBlockContent />
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </CodeBlock>
  )
}

type SortState = { key: string; direction: "asc" | "desc" } | null

/**
 * A table answer. Sorting is local to the artifact, so re-ranking the rows to
 * read them another way never edits the order the model actually returned.
 */
function TableArtifact({
  part,
  streaming = false,
}: {
  part: Extract<MessagePart, { kind: "table" }>
  streaming?: boolean
}) {
  const [sort, setSort] = useState<SortState>(null)
  const first = part.columns[0]

  const rows = sort
    ? [...part.rows].sort((left, right) => {
        const a = left[sort.key]
        const b = right[sort.key]
        const gap =
          typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b))
        return sort.direction === "asc" ? gap : -gap
      })
    : part.rows

  // Totals are summed from the rows on screen, so a half revealed table never
  // shows a figure its own body does not add up to.
  const totals = part.columns.map((column) =>
    column.total
      ? rows.reduce((sum, row) => sum + Number(row[column.key] ?? 0), 0)
      : null
  )

  /** Descending first: the interesting end of a count column is the top. */
  function toggle(key: string) {
    setSort((current) =>
      current?.key !== key
        ? { key, direction: "desc" }
        : current.direction === "desc"
          ? { key, direction: "asc" }
          : null
    )
  }

  return (
    <Table className="text-xs">
      <TableCaption className="sr-only">{part.caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {part.columns.map((column) => {
            const active = sort?.key === column.key
            return (
              <TableHead
                key={column.key}
                aria-sort={
                  active
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className={column.numeric ? "text-end" : undefined}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Sort by ${column.label}`}
                  onClick={() => toggle(column.key)}
                  className={cn(
                    "-mx-2 h-7 gap-1 px-2 text-xs font-medium",
                    // Glyph ahead of the label so a right aligned header keeps
                    // its word nearest the digits it counts.
                    column.numeric && "flex-row-reverse"
                  )}
                >
                  {column.label}
                  {active
                    ? sort.direction === "asc"
                      ? ICON_SORT_ASC
                      : ICON_SORT_DESC
                    : ICON_SORT_NONE}
                </Button>
              </TableHead>
            )
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={String(row[first.key])}>
            {part.columns.map((column) => (
              <TableCell
                key={column.key}
                className={
                  column.numeric
                    ? "text-end tabular-nums"
                    : "text-foreground font-medium"
                }
              >
                {row[column.key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {/* Held back mid stream: a total is only true once every row has landed. */}
      {streaming ? null : (
        <TableFooter>
          <TableRow>
            {part.columns.map((column, index) => (
              <TableCell
                key={column.key}
                className={column.numeric ? "text-end tabular-nums" : undefined}
              >
                {index === 0 ? "Total" : totals[index]}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  )
}

/**
 * Compared by content, not identity: the reveal hands every part a fresh object
 * on each tick, so a referential memo would never hit and code would re-highlight.
 */
const PartBody = memo(
  function PartBody({ part, caret }: { part: MessagePart; caret?: boolean }) {
    if (part.kind === "code")
      return <CodeArtifact part={part} streaming={caret} />

    if (part.kind === "table")
      return <TableArtifact part={part} streaming={caret} />

    // Split rather than match a closed pair: mid stream the closing backtick
    // has not arrived, and a lone one must never surface as a character.
    const segments = part.text.split("`")

    return (
      <p className="whitespace-pre-wrap">
        {segments.map((segment, index) =>
          index % 2 === 1 ? (
            <code
              key={index}
              className="bg-muted rounded-sm px-1 py-0.5 font-mono text-[0.85em]"
            >
              {segment}
            </code>
          ) : (
            segment
          )
        )}
        {caret ? (
          <span
            className="bg-foreground ms-0.5 inline-block h-[1em] w-0.5 translate-y-0.5"
            aria-hidden="true"
          />
        ) : null}
      </p>
    )
  },
  (previous, next) => {
    if (previous.caret !== next.caret) return false
    const before = previous.part
    const after = next.part
    if (before.kind === "text" && after.kind === "text")
      return before.text === after.text
    if (before.kind === "code" && after.kind === "code")
      return before.code === after.code
    // Rows arrive whole, so their count is the only thing that can change.
    if (before.kind === "table" && after.kind === "table")
      return before.rows.length === after.rows.length
    return false
  }
)

/**
 * The shared question, demoted to a quoted reference: both panes repeat it, so
 * only the two answers get full weight.
 */
function PromptRef({ turn }: { turn: TurnRecord }) {
  return (
    // A muted surface, not a bare rule: both panes repeat this line, so it has
    // to read as the shared question rather than as the top of an answer.
    <Item variant="muted" size="sm" className="items-start gap-2">
      <ItemContent className="gap-1.5">
        {/* Two lines, not one: a truncated question cannot be compared against. */}
        <ItemTitle
          title={turn.prompt}
          className="line-clamp-2 font-normal text-pretty"
        >
          <span className="sr-only">{VIEWER_NAME} asked: </span>
          {turn.prompt}
        </ItemTitle>

        {/* The line this turn is asking about, kept with the turn so scrollback
            still shows which claim the follow up was aimed at. */}
        {turn.quote ? (
          <blockquote className="border-primary/40 text-muted-foreground flex flex-col gap-0.5 border-s-2 ps-2 text-xs">
            <span className="line-clamp-2 italic">{turn.quote.text}</span>
            <span className="text-muted-foreground/70">
              from {turn.quote.from}
            </span>
          </blockquote>
        ) : null}

        {/* What this turn could read, recorded on the turn rather than on the
            composer, so scrollback still shows what each answer was given. */}
        {turn.files?.length ? (
          <ul className="flex flex-wrap items-center gap-1">
            {turn.files.map((file) => (
              <li
                key={file.id}
                className="bg-background/60 text-muted-foreground flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                {ICON_FILE}
                <span className="truncate font-mono">{file.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </ItemContent>

      <ItemActions>
        <span className="text-muted-foreground/70 text-xs tabular-nums">
          {turn.at}
        </span>
      </ItemActions>
    </Item>
  )
}

/** The rate limit, with the reset time and the one action that clears it. */
function RunError({ run, onRetry }: { run: RunView; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="items-start">
      {ICON_ERROR}
      <AlertTitle>{RATE_LIMIT.title}</AlertTitle>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {ICON_RETRY}
          Retry
        </Button>
      </AlertAction>
      <AlertDescription>
        <p>{RATE_LIMIT.detail}</p>
        <p className="flex items-center gap-1.5 text-xs">
          <Badge variant="destructive-light" className="tabular-nums">
            {RATE_LIMIT.code}
          </Badge>
          <span>{run.model.name}</span>
          <Dot />
          <span className="tabular-nums">{formatSeconds(run.elapsedMs)}</span>
        </p>
      </AlertDescription>
    </Alert>
  )
}

/** One icon action on a settled answer. Toggles carry aria-pressed; a one
    shot action like Copy must not. */
function TurnAction({
  label,
  icon,
  active = false,
  pressed = false,
  onClick,
}: {
  label: string
  icon: ReactNode
  active?: boolean
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={pressed ? active : undefined}
      onClick={onClick}
      className={active ? "text-primary" : undefined}
    >
      {icon}
    </Button>
  )
}

function AssistantTurn({
  run,
  paneModelId,
  voted,
  onRetry,
}: {
  run: RunView
  /** The pane's current model, so an older answer can name the one that wrote it. */
  paneModelId: string
  /** True when the vote for this exchange landed on this pane's answer. */
  voted: boolean
  onRetry: () => void
}) {
  // Above the phase returns: hook order has to hold for every phase.
  const [vote, setVote] = useState<"up" | "down" | null>(null)
  const { copied, copy } = useCopy()

  if (run.phase === "error") return <RunError run={run} onRetry={onRetry} />

  if (run.phase === "thinking")
    return (
      <Marker role="status">
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          {run.answer.activityLabel}
        </MarkerContent>
      </Marker>
    )

  const settled = run.phase === "done" || run.phase === "stopped"
  // A rated answer carries the reaction on the bubble, the way a teammate's
  // would, so the signal lives with the answer and not just in the toolbar.
  const reactions = Array.from(
    new Set([
      ...(run.answer.reactions ?? []),
      ...(vote === "up" ? ["\u{1F44D}"] : []),
      ...(vote === "down" ? ["\u{1F44E}"] : []),
    ])
  )

  return (
    <Message role="group" aria-label={run.model.name} className="group/turn">
      <MessageContent className="min-w-0 gap-1">
        {/* A Stop before the first token leaves nothing to draw, so the turn
            keeps only its footer note. */}
        {run.parts.length ? (
          <Bubble variant="ghost" className="w-full min-w-0">
            <BubbleContent data-answer-body className="min-w-0 space-y-3">
              {run.parts.map((part, index) => (
                <PartBody
                  key={index}
                  part={part}
                  caret={
                    run.phase === "streaming" && index === run.parts.length - 1
                  }
                />
              ))}
            </BubbleContent>

            {settled && reactions.length ? (
              <BubbleReactions
                side="bottom"
                align="start"
                role="img"
                aria-label={`Reactions: ${reactions.join(", ")}`}
              >
                {reactions.map((emoji) => (
                  <span key={emoji}>{emoji}</span>
                ))}
              </BubbleReactions>
            ) : null}
          </Bubble>
        ) : null}

        {settled ? (
          <MessageFooter
            // The reactions overlay hangs below the bubble, so the footer
            // steps down to clear it rather than colliding.
            className={cn(
              "text-muted-foreground flex-wrap gap-1.5 text-xs",
              reactions.length && "mt-3"
            )}
          >
            {/* Named only when it differs: swapping a pane's model appends a
                fresh answer, and the older ones keep their own author. */}
            {run.model.id === paneModelId ? null : (
              <>
                <span>{run.model.name}</span>
                <Dot />
              </>
            )}
            <span className="tabular-nums">{formatSeconds(run.elapsedMs)}</span>
            <Dot />
            <span className="tabular-nums">
              {formatTokens(run.outTokens)} tokens
            </span>
            <Dot />
            {run.phase === "stopped" ? (
              <span>Stopped by you</span>
            ) : (
              <span className="tabular-nums">{runRate(run)} tok/s</span>
            )}
            {voted ? (
              <Badge variant="primary-light" className="gap-1">
                {ICON_VOTED}
                Preferred
              </Badge>
            ) : null}

            {/* Mounted and pressable at rest, only the paint waits, so touch
                and keyboard never depend on a hover that cannot fire. */}
            <span className="pointer-events-none ms-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/turn:pointer-events-auto group-hover/turn:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-100">
              <TurnAction
                label={copied ? "Answer copied" : "Copy answer"}
                icon={copied ? ICON_COPIED : ICON_COPY}
                onClick={() => copy(answerText(run.parts))}
              />
              <TurnAction
                label={vote === "up" ? "Remove like" : "Like answer"}
                icon={ICON_LIKE}
                active={vote === "up"}
                pressed
                onClick={() => setVote(vote === "up" ? null : "up")}
              />
              <TurnAction
                label={vote === "down" ? "Remove dislike" : "Dislike answer"}
                icon={ICON_DISLIKE}
                active={vote === "down"}
                pressed
                onClick={() => setVote(vote === "down" ? null : "down")}
              />
            </span>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

/** The pane before it has run anything, priced so the two read differently. */
function PaneEmpty({ model }: { model: ModelRecord }) {
  return (
    // Centred while it fits, scrollable once it outgrows a short pane. m-auto
    // centres without clipping the way justify-center does.
    <div className="scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6">
      <div className="m-auto">
        <Empty className="flex-none p-0">
          <EmptyHeader className="gap-2">
            <EmptyTitle>{model.name}</EmptyTitle>
            {/* Two facts, two chips: the pane reads as a model card rather
                than a sentence with a comma doing a separator's job. */}
            <EmptyDescription className="flex flex-wrap items-center justify-center gap-1.5">
              <Badge variant="info-light" className="tabular-nums">
                {formatContext(model.contextTokens)} context
              </Badge>
              <Badge variant="secondary" className="tabular-nums">
                ${model.priceIn} per million in
              </Badge>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  )
}

export function PaneThread({
  record,
  turns,
  votes,
  onRetry,
}: {
  record: PaneRecord
  turns: TurnRecord[]
  /** Winner per exchange, so a settled answer can wear its Preferred tick. */
  votes: Record<string, "a" | "b">
  /** Addressed by run id, so Retry reruns only the answer that failed. */
  onRetry: (runId: string) => void
}) {
  const clock = useClock()
  const sync = useScrollSync()

  /** Registers this viewport for scroll sync and listens on the node itself,
      so the scroller keeps whatever handler it attaches internally. */
  const attachViewport = useCallback(
    (node: HTMLElement | null) => {
      sync?.register(record.id, node)
      if (!node || !sync) return
      const onScroll = () => sync.broadcast(record.id, node)
      node.addEventListener("scroll", onScroll, { passive: true })
      return () => {
        node.removeEventListener("scroll", onScroll)
        sync.register(record.id, null)
      }
    },
    [sync, record.id]
  )

  if (record.runs.length === 0)
    return <PaneEmpty model={modelById(record.modelId)} />

  const pane = buildPaneView(record, turns, clock)

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport ref={attachViewport} className="scrollbar">
          <MessageScrollerContent
            aria-busy={pane.busy}
            className="flex w-full min-w-0 flex-col gap-6 px-4 py-4"
          >
            {/* Panel sized: a top anchored user turn would strand the answer
                below the fold, so every item sticks to the bottom instead. */}
            <MessageScrollerItem
              scrollAnchor={false}
              className="[content-visibility:visible]"
            >
              <Marker variant="separator">
                <MarkerContent>{SEPARATOR}</MarkerContent>
              </Marker>
            </MessageScrollerItem>

            {pane.runs.map((run, index) => {
              const turn = turns.find((item) => item.id === run.turnId)
              if (!turn) return null
              // The vote belongs to the pane's LAST answer for that exchange:
              // a model swap appends a rerun, which retires the older one.
              const voted =
                votes[run.turnId] === pane.id &&
                !pane.runs.some(
                  (item, later) => later > index && item.turnId === run.turnId
                )
              return (
                <MessageScrollerItem
                  key={run.id}
                  messageId={run.id}
                  scrollAnchor={false}
                  className="animate-in fade-in-0 flex flex-col gap-3 duration-300 ease-out [content-visibility:visible] motion-reduce:animate-none"
                >
                  <PromptRef turn={turn} />
                  <AssistantTurn
                    run={run}
                    paneModelId={pane.model.id}
                    voted={voted}
                    onRetry={() => onRetry(run.id)}
                  />
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>

        {/* aria-busy silences the log, so the in-flight step is announced from
            outside it rather than not at all. */}
        <p role="status" aria-live="polite" className="sr-only">
          {pane.busy && pane.newest
            ? `${pane.model.name} ${pane.newest.answer.activityLabel}`
            : ""}
        </p>

        <MessageScrollerButton
          variant="outline"
          size="icon-sm"
          className="bottom-3 rounded-full shadow-sm"
        />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}