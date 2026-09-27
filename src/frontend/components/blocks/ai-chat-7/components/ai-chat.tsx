import { useEffect, useState } from "react"
import { Badge } from "@/components/reui/badge"

import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ClockProvider,
  useClockSelector,
  useClockStore,
  useStoreSelector,
} from "./clock"
import {
  LEFT_MODEL_ID,
  modelById,
  RIGHT_MODEL_ID,
  SEED_TURNS,
  type AttachmentRecord,
  type TurnRecord,
} from "./data"
import { ModelPane } from "./model-pane"
import { paneBusyAt, type PaneRecord, type RunRecord } from "./pane-view"
import { PromptBar } from "./prompt-bar"
import { ScrollSyncProvider } from "./scroll-sync"
import { VerdictStrip } from "./verdict-strip"
import { LinkIcon, PlusIcon } from "lucide-react"

/** Reveal tick. Only clock subscribers re-render on it, never this root. */
const TICK_MS = 40

/** Longer than any recorded latency: a run offset this far back is finished. */
const SETTLE_MS = 20000

/** First paint shows a working comparison: exchange one settled with the vote
    cast, exchange two still streaming in both panes at their own speeds. */
const INITIAL_PANES: PaneRecord[] = [
  {
    id: "a",
    modelId: LEFT_MODEL_ID,
    runs: [
      {
        id: "turn_1:a:0",
        turnId: "turn_1",
        modelId: LEFT_MODEL_ID,
        variant: 0,
        startedAt: -SETTLE_MS,
        stoppedAt: null,
        cleared: false,
      },
      {
        id: "turn_2:a:1",
        turnId: "turn_2",
        modelId: LEFT_MODEL_ID,
        variant: 1,
        startedAt: 0,
        stoppedAt: null,
        cleared: false,
      },
    ],
  },
  {
    id: "b",
    modelId: RIGHT_MODEL_ID,
    runs: [
      {
        id: "turn_1:b:0",
        turnId: "turn_1",
        modelId: RIGHT_MODEL_ID,
        variant: 0,
        startedAt: -SETTLE_MS,
        stoppedAt: null,
        cleared: false,
      },
      {
        id: "turn_2:b:1",
        turnId: "turn_2",
        modelId: RIGHT_MODEL_ID,
        variant: 1,
        startedAt: 0,
        stoppedAt: null,
        cleared: false,
      },
    ],
  },
]

/** Under reduced motion a run starts already finished. */
function runStart(clock: number) {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? clock - SETTLE_MS
    : clock
}

/**
 * Local twin of the shared hook, seeded from matchMedia instead of undefined
 * so the first frame at phone width never flashes the desktop split.
 */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
  )

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)")
    const onChange = () => setMobile(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return mobile
}

/** Tab spinner as a clock leaf, so the tab bar itself stays off the ticks. */
function TabBusy({
  record,
  turns,
}: {
  record: PaneRecord
  turns: TurnRecord[]
}) {
  const busy = useClockSelector((clock) => paneBusyAt(record, turns, clock))
  return busy ? <Spinner aria-hidden="true" /> : null
}

export function AiChat() {
  const isMobile = useIsMobile()
  const store = useClockStore()
  const [turns, setTurns] = useState<TurnRecord[]>(SEED_TURNS)
  const [panes, setPanes] = useState<PaneRecord[]>(INITIAL_PANES)
  /** Winner per exchange. A model swap retires the vote it argued about. */
  const [votes, setVotes] = useState<Record<string, "a" | "b">>({
    turn_1: "a",
  })
  /** True once a retry has carried the workspace past the Google quota. */
  const [limitCleared, setLimitCleared] = useState(false)
  const [activeTab, setActiveTab] = useState("a")
  /** Locks the two transcripts to one scroll position, which is how you read
      two answers at the same depth instead of chasing them separately. */
  const [syncScroll, setSyncScroll] = useState(true)
  /** A line lifted out of one answer, waiting to be asked about. */
  const [quote, setQuote] = useState<TurnRecord["quote"]>(undefined)

  // Busy is the only clock fact the root reads, and only its flips re-render
  // here: the header, prompt bar and both selects stay off the tick.
  const busy = useStoreSelector(store, (clock) =>
    panes.some((pane) => paneBusyAt(pane, turns, clock))
  )

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => {
      store.set(store.read() + TICK_MS)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [busy, store])

  // The seeded pair opens mid stream, which reduced motion must skip past.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    store.set(store.read() + SETTLE_MS)
  }, [store])

  /** Appends one run to a pane; runs are never replaced, so meters only grow. */
  function appendRun(
    pane: PaneRecord,
    turnId: string,
    modelId: string,
    variant: number,
    startedAt: number
  ): PaneRecord {
    const run: RunRecord = {
      id: `${turnId}:${pane.id}:${pane.runs.length}`,
      turnId,
      modelId,
      variant,
      startedAt,
      stoppedAt: null,
      cleared: limitCleared,
    }
    return { ...pane, runs: [...pane.runs, run] }
  }

  function startExchange(
    prompt: string,
    variant: number,
    files?: AttachmentRecord[]
  ) {
    const turn: TurnRecord = {
      id: `turn_${turns.length + 1}`,
      prompt,
      at: "Now",
      files: files?.length ? files : undefined,
      quote,
    }
    const startedAt = runStart(store.read())
    setTurns((current) => [...current, turn])
    setPanes((current) =>
      current.map((pane) =>
        appendRun(pane, turn.id, pane.modelId, variant, startedAt)
      )
    )
  }

  function handleSend(text: string, files: AttachmentRecord[]) {
    startExchange(text, turns.length, files)
    setQuote(undefined)
  }

  /** Arena style: running again appends a fresh exchange for the same prompt,
      so no earlier answer, vote or meter reading ever gets rewritten. */
  function handleRerun() {
    const newest = turns[turns.length - 1]
    if (!newest) return
    const lastVariant = panes[0].runs[panes[0].runs.length - 1]?.variant ?? 0
    startExchange(newest.prompt, lastVariant + 1, newest.files)
  }

  /** Freezes every live answer where it got to, rather than dropping it. */
  function handleStop() {
    const now = store.read()
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        runs: pane.runs.map((run, index) =>
          index === pane.runs.length - 1 && run.stoppedAt === null
            ? { ...run, stoppedAt: now }
            : run
        ),
      }))
    )
  }

  /** A vote argues about two specific answers, so anything that puts a new
      answer under the newest prompt retires it. */
  function retireVote(turnId: string) {
    setVotes((current) => {
      if (!(turnId in current)) return current
      const next = { ...current }
      delete next[turnId]
      return next
    })
  }

  /** A model swap appends its answer to the newest prompt beside the old one
      (meters stay monotonic) and retires that exchange's now-stale vote. */
  function handleModelChange(paneId: "a" | "b", modelId: string) {
    const newest = turns[turns.length - 1]
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== paneId || pane.modelId === modelId) return pane
        const swapped = { ...pane, modelId }
        if (!newest) return swapped
        const variant =
          pane.runs[pane.runs.length - 1]?.variant ?? turns.length - 1
        return appendRun(
          swapped,
          newest.id,
          modelId,
          variant,
          runStart(store.read())
        )
      })
    )
    if (newest) retireVote(newest.id)
  }

  /** Reruns one pane against the newest prompt, leaving the other answer
      standing so there is still something to compare against. */
  function handleRegenerate(paneId: "a" | "b") {
    const newest = turns[turns.length - 1]
    if (!newest) return
    setPanes((current) =>
      current.map((pane) =>
        pane.id === paneId
          ? appendRun(
              pane,
              newest.id,
              pane.modelId,
              (pane.runs[pane.runs.length - 1]?.variant ?? 0) + 1,
              runStart(store.read())
            )
          : pane
      )
    )
    retireVote(newest.id)
  }

  /** Puts one model in both panes, which is how run to run variance in a
      single model gets read. */
  function handleMatch(paneId: "a" | "b") {
    const source = panes.find((pane) => pane.id === paneId)
    const other = panes.find((pane) => pane.id !== paneId)
    if (source && other) handleModelChange(other.id, source.modelId)
  }

  /** Both models change at once, so it is one update rather than two that
      would each read the other's half applied state. */
  function handleSwapModels() {
    const newest = turns[turns.length - 1]
    const startedAt = runStart(store.read())
    setPanes((current) => {
      const [left, right] = current
      if (!left || !right || left.modelId === right.modelId) return current
      const move = (pane: PaneRecord, modelId: string) => {
        const swapped = { ...pane, modelId }
        if (!newest) return swapped
        const variant =
          pane.runs[pane.runs.length - 1]?.variant ?? turns.length - 1
        return appendRun(swapped, newest.id, modelId, variant, startedAt)
      }
      return [move(left, right.modelId), move(right, left.modelId)]
    })
    if (newest) retireVote(newest.id)
  }

  /** Drops one model's history and leaves the other's standing. */
  function handleClearPane(paneId: "a" | "b") {
    setPanes((current) =>
      current.map((pane) => (pane.id === paneId ? { ...pane, runs: [] } : pane))
    )
  }

  /** The quota has reset, so the one run whose alert was clicked goes again.
      A settled answer beside it, from an earlier model, is left where it was. */
  function handleRetry(paneId: "a" | "b", runId: string) {
    setLimitCleared(true)
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== paneId) return pane
        return {
          ...pane,
          runs: pane.runs.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  startedAt: runStart(store.read()),
                  stoppedAt: null,
                  cleared: true,
                }
              : run
          ),
        }
      })
    )
  }

  function handleVote(turnId: string, winner: "a" | "b" | null) {
    setVotes((current) => {
      const next = { ...current }
      if (winner === null) delete next[turnId]
      else next[turnId] = winner
      return next
    })
  }

  function handleNewComparison() {
    setTurns([])
    setPanes((current) => current.map((pane) => ({ ...pane, runs: [] })))
    setVotes({})
  }

  function renderPane(record: PaneRecord) {
    return (
      <ModelPane
        record={record}
        turns={turns}
        limitCleared={limitCleared}
        compact={isMobile}
        votes={votes}
        canAct={turns.length > 0}
        onModelChange={(modelId) => handleModelChange(record.id, modelId)}
        onRetry={(runId) => handleRetry(record.id, runId)}
        onRegenerate={() => handleRegenerate(record.id)}
        onMatch={() => handleMatch(record.id)}
        onSwap={handleSwapModels}
        onClear={() => handleClearPane(record.id)}
        onQuote={(text, from) => setQuote({ text, from })}
      />
    )
  }

  return (
    // Every tooltip in the block needs this ancestor to open.
    <TooltipProvider>
      <ClockProvider value={store}>
        {/* Sync is a split view idea: the tabbed layout shows one pane. */}
        <ScrollSyncProvider enabled={syncScroll && !isMobile}>
          <div className="bg-background text-foreground flex h-svh w-full flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
              <h1 className="shrink-0 text-sm font-medium">Compare Models</h1>
              {turns.length ? (
                <Badge
                  variant="success-light"
                  className="shrink-0 tabular-nums"
                >
                  {turns.length === 1
                    ? "1 exchange"
                    : `${turns.length} exchanges`}
                </Badge>
              ) : null}

              <div className="ms-auto flex items-center gap-1">
                {/* Only the split view has two scrollbars to lock, so the tabbed
                  layout below md never offers a control that does nothing. */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={syncScroll ? "secondary" : "ghost"}
                        size="icon-sm"
                        aria-label="Lock both transcripts to one scroll position"
                        aria-pressed={syncScroll}
                        onClick={() => setSyncScroll((locked) => !locked)}
                        className="max-md:hidden"
                      />
                    }
                  >
                    <LinkIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {syncScroll ? "Scroll locked" : "Scroll unlocked"}
                  </TooltipContent>
                </Tooltip>

                <Button
                  disabled={turns.length === 0}
                  onClick={handleNewComparison}
                  className="ms-1"
                >
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  <span className="max-sm:sr-only">New comparison</span>
                </Button>
              </div>
            </header>

            {/* Two panes side by side need about 280px each. Below md they become
              tabs; keepMounted keeps the hidden pane streaming and scrolled. */}
            {isMobile ? (
              <Tabs
                value={activeTab}
                onValueChange={(value) => value && setActiveTab(String(value))}
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList className="mx-3 mt-3 grid shrink-0 grid-cols-2">
                  {panes.map((record) => (
                    <TabsTrigger
                      key={record.id}
                      value={record.id}
                      className="min-w-0 gap-1.5"
                    >
                      <span className="truncate">
                        {modelById(record.modelId).name}
                      </span>
                      <TabBusy record={record} turns={turns} />
                    </TabsTrigger>
                  ))}
                </TabsList>
                {panes.map((record) => (
                  <TabsContent
                    key={record.id}
                    value={record.id}
                    keepMounted
                    // inert lands synchronously on deselect; hidden waits a
                    // frame. The variant closes that gap so panes never stack.
                    className="min-h-0 flex-1 inert:hidden"
                  >
                    {renderPane(record)}
                  </TabsContent>
                ))}
              </Tabs>
            ) : (
              <ResizablePanelGroup
                orientation="horizontal"
                className="min-h-0 flex-1"
              >
                <ResizablePanel
                  defaultSize="50"
                  minSize={280}
                  className="min-h-0"
                >
                  {renderPane(panes[0])}
                </ResizablePanel>
                {/* No grip: it sat over the pane's scrollbar. The separator
                    still drags through its own widened hit strip. */}
                <ResizableHandle
                  title="Drag to resize the panes"
                  className="hover:bg-primary data-[separator=hover]:bg-primary data-[separator=active]:bg-primary relative z-10 cursor-col-resize transition-colors after:w-4"
                />
                <ResizablePanel
                  defaultSize="50"
                  minSize={280}
                  className="min-h-0"
                >
                  {renderPane(panes[1])}
                </ResizablePanel>
              </ResizablePanelGroup>
            )}

            <VerdictStrip
              panes={panes}
              turns={turns}
              votes={votes}
              labeled={isMobile}
              onVote={handleVote}
            />

            <PromptBar
              busy={busy}
              canRerun={turns.length > 0}
              showSaved={turns.length === 0}
              quote={quote}
              onClearQuote={() => setQuote(undefined)}
              onSend={handleSend}
              onRerun={handleRerun}
              onStop={handleStop}
            />
          </div>
        </ScrollSyncProvider>
      </ClockProvider>
    </TooltipProvider>
  )
}