import { Badge } from "@/components/reui/badge"
import { cn } from "@/lib/utils"

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

import { useClock } from "./clock"
import { modelById, type TurnRecord } from "./data"
import { Dot } from "./dot"
import {
  buildPaneView,
  formatSeconds,
  formatUsd,
  runCostUsd,
  runRate,
  type PaneRecord,
  type RunView,
} from "./pane-view"

/** The verdict surface: a mirrored live scoreboard meeting at the divider
    that collapses, on settle, to one delta line with the A or B vote. */

type MeterRow = {
  label: string
  a: number
  b: number
  format: (value: number) => string
  /** Which side of a pair reads as ahead: latency and cost want less. */
  lowerLeads: boolean
}

function meterRows(a: RunView | null, b: RunView | null): MeterRow[] {
  return [
    {
      label: "latency",
      a: a?.elapsedMs ?? 0,
      b: b?.elapsedMs ?? 0,
      format: formatSeconds,
      lowerLeads: true,
    },
    {
      label: "tok/s",
      a: a ? runRate(a) : 0,
      b: b ? runRate(b) : 0,
      format: (value) => String(value),
      lowerLeads: false,
    },
    {
      label: "cost",
      a: a ? runCostUsd(a) : 0,
      b: b ? runCostUsd(b) : 0,
      format: formatUsd,
      lowerLeads: true,
    },
  ]
}

/** One half of a paired meter: value outside, bar anchored at the divider and
    filling outward via scaleX so the fill never touches layout. */
function MeterCell({
  side,
  value,
  fill,
  leads,
}: {
  side: "a" | "b"
  value: string
  fill: number
  leads: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-4 min-w-0 items-center gap-2",
        side === "a" ? "justify-end" : "justify-start"
      )}
    >
      {side === "a" ? (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            leads ? "text-foreground font-medium" : "text-muted-foreground"
          )}
        >
          {value}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="bg-muted h-1 w-full max-w-28 flex-1 overflow-hidden rounded-full"
      >
        <span
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, fill))})` }}
          className={cn(
            "block h-full w-full",
            side === "a" ? "origin-right" : "origin-left",
            leads ? "bg-foreground/70" : "bg-muted-foreground/40"
          )}
        />
      </span>
      {side === "b" ? (
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            leads ? "text-foreground font-medium" : "text-muted-foreground"
          )}
        >
          {value}
        </span>
      ) : null}
    </div>
  )
}

/** A rate limited half spends no meters: the whole column carries the 429. */
function MeterError({ side }: { side: "a" | "b" }) {
  return (
    <div
      className={cn(
        "flex w-full flex-1 items-center gap-1.5",
        side === "a" ? "justify-end" : "justify-start"
      )}
    >
      <Badge variant="destructive-light">Rate limited</Badge>
    </div>
  )
}

/** "Sonnet 5: 1.9s faster, $0.004 more", or who answered when only one did. */
function deltaLine(a: RunView, b: RunView): string {
  const aAnswered = a.parts.length > 0
  const bAnswered = b.parts.length > 0

  if (!aAnswered && !bAnswered) return "Neither model answered"
  if (aAnswered !== bAnswered) {
    const winner = aAnswered ? a : b
    const loser = aAnswered ? b : a
    const reason = loser.phase === "error" ? "rate limited" : "stopped early"
    return `${winner.model.name} answered in ${formatSeconds(winner.elapsedMs)}, ${loser.model.name} ${reason}`
  }

  const faster = a.elapsedMs <= b.elapsedMs ? a : b
  const slower = faster === a ? b : a
  const gap = (slower.elapsedMs - faster.elapsedMs) / 1000
  const costGap = runCostUsd(faster) - runCostUsd(slower)

  const speed = gap < 0.05 ? "matched on speed" : `${gap.toFixed(1)}s faster`
  const cost =
    Math.abs(costGap) < 0.0005
      ? "same cost"
      : `${formatUsd(Math.abs(costGap))} ${costGap > 0 ? "more" : "less"}`

  return `${faster.model.name}: ${speed}, ${cost}`
}

export function VerdictStrip({
  panes,
  turns,
  votes,
  labeled,
  onVote,
}: {
  panes: PaneRecord[]
  turns: TurnRecord[]
  votes: Record<string, "a" | "b">
  /** Mobile shows one pane at a time, so the halves must name their model. */
  labeled?: boolean
  onVote: (turnId: string, winner: "a" | "b" | null) => void
}) {
  const clock = useClock()
  const [viewA, viewB] = panes.map((pane) => buildPaneView(pane, turns, clock))
  const newestTurn = turns[turns.length - 1]
  const a = viewA.newest
  const b = viewB.newest

  if (!newestTurn || (!a && !b)) return null

  // Settled: the scoreboard has done its job, so it hands over to the verdict.
  if (!viewA.busy && !viewB.busy && a && b) {
    const vote = votes[newestTurn.id]
    return (
      <div className="flex min-h-19 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t px-4 py-2">
        <p role="status" className="text-sm tabular-nums">
          {deltaLine(a, b)}
        </p>
        <Dot className="max-sm:hidden" />
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">Prefer</span>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Prefer an answer"
            value={vote ? [vote] : []}
            onValueChange={(group) =>
              onVote(newestTurn.id, (group[0] as "a" | "b" | undefined) ?? null)
            }
          >
            <ToggleGroupItem value="a" disabled={a.parts.length === 0}>
              <span className="max-w-36 truncate">{a.model.name}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="b" disabled={b.parts.length === 0}>
              <span className="max-w-36 truncate">{b.model.name}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    )
  }

  // A rate limited side drops out of the race: it neither leads a metric nor
  // sets the bar scale for the side still running.
  const errorA = a?.phase === "error"
  const errorB = b?.phase === "error"
  const rows = meterRows(errorA ? null : a, errorB ? null : b)

  return (
    <div className="grid min-h-19 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] content-center items-stretch gap-x-3 border-t px-4 py-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        {labeled ? (
          <span className="text-muted-foreground truncate text-end text-xs">
            {modelById(panes[0].modelId).name}
          </span>
        ) : null}
        {errorA ? (
          <MeterError side="a" />
        ) : (
          rows.map((row) => (
            <MeterCell
              key={row.label}
              side="a"
              value={row.format(row.a)}
              fill={row.a / Math.max(row.a, row.b, 1e-9)}
              leads={
                errorB
                  ? row.a > 0
                  : row.a !== row.b &&
                    (row.lowerLeads ? row.a < row.b : row.a > row.b)
              }
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {labeled ? <span aria-hidden="true" className="h-4" /> : null}
        {rows.map((row) => (
          <span
            key={row.label}
            className="text-muted-foreground flex h-4 w-14 items-center justify-center text-xs"
          >
            {row.label}
          </span>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {labeled ? (
          <span className="text-muted-foreground truncate text-xs">
            {modelById(panes[1].modelId).name}
          </span>
        ) : null}
        {errorB ? (
          <MeterError side="b" />
        ) : (
          rows.map((row) => (
            <MeterCell
              key={row.label}
              side="b"
              value={row.format(row.b)}
              fill={row.b / Math.max(row.a, row.b, 1e-9)}
              leads={
                errorA
                  ? row.b > 0
                  : row.a !== row.b &&
                    (row.lowerLeads ? row.b < row.a : row.b > row.a)
              }
            />
          ))
        )}
      </div>
    </div>
  )
}