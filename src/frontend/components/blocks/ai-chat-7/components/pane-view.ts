import {
  answerFor,
  modelById,
  RATE_LIMIT,
  type AnswerRecord,
  type MessagePart,
  type ModelRecord,
  type TurnRecord,
} from "./data"

export type RunRecord = {
  /** Unique per run: a model swap appends a second run for the same turn. */
  id: string
  turnId: string
  /** The model that answered; older runs keep theirs after a pane swaps model. */
  modelId: string
  /** Rotates the unscripted answer, so two sends never repeat word for word. */
  variant: number
  /** Block clock in milliseconds when the answer started arriving. */
  startedAt: number
  /** Block clock in milliseconds when Stop froze it, or null. */
  stoppedAt: number | null
  /** True once this run has been carried past the provider's rate limit. */
  cleared: boolean
}

export type PaneRecord = {
  id: "a" | "b"
  modelId: string
  runs: RunRecord[]
}

export type RunPhase = "thinking" | "streaming" | "stopped" | "done" | "error"

export type RunView = {
  id: string
  turnId: string
  model: ModelRecord
  answer: AnswerRecord
  /** What has arrived so far; the whole answer once the run is done. */
  parts: MessagePart[]
  phase: RunPhase
  /** Milliseconds on the clock, frozen at the recorded latency once done. */
  elapsedMs: number
  /** Completion tokens so far, reaching the recorded total at the end. */
  outTokens: number
}

export type PaneView = {
  id: "a" | "b"
  model: ModelRecord
  runs: RunView[]
  /** The answer the pane footer acts on. */
  newest: RunView | null
  busy: boolean
  /** Answers that produced tokens, and what they cost together. */
  answers: number
  outTokens: number
  costUsd: number
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** How much reveal budget one table row is worth, so a table arrives at a
    readable pace beside prose instead of snapping in whole. */
const CHARS_PER_ROW = 44

function partLength(part: MessagePart) {
  if (part.kind === "text") return part.text.length
  if (part.kind === "code") return part.code.length
  return part.rows.length * CHARS_PER_ROW
}

/**
 * Cuts an answer at the revealed character. Code lands a line at a time: a
 * character level slice re-highlights the whole snippet on every tick.
 */
function sliceParts(parts: MessagePart[], revealed: number): MessagePart[] {
  const shown: MessagePart[] = []
  let budget = revealed

  for (const part of parts) {
    const length = partLength(part)
    if (budget >= length) {
      shown.push(part)
      budget -= length
      continue
    }
    if (budget <= 0) break

    if (part.kind === "text") {
      const cut = part.text.slice(0, budget)
      // Snap back to the last whitespace: a caret parked mid word is the tell
      // that a reveal is counting characters rather than emitting tokens.
      const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"))
      shown.push({
        ...part,
        text: boundary > 0 ? cut.slice(0, boundary) : cut,
      })
    } else if (part.kind === "table") {
      // Whole rows only: half a row is a broken table, not a partial one.
      shown.push({
        ...part,
        rows: part.rows.slice(
          0,
          Math.max(1, Math.floor(budget / CHARS_PER_ROW))
        ),
      })
    } else {
      const lines = part.code.split("\n")
      const reached = Math.max(
        1,
        Math.floor((budget / part.code.length) * lines.length)
      )
      // No trailing newline: it would render as an empty numbered code line.
      shown.push({ ...part, code: lines.slice(0, reached).join("\n") })
    }
    break
  }

  return shown
}

export function buildRunView(
  run: RunRecord,
  turn: TurnRecord,
  clock: number
): RunView {
  const model = modelById(run.modelId)
  const answer = answerFor(turn.prompt, run.modelId, run.variant)
  const raw = (run.stoppedAt ?? clock) - run.startedAt
  const base = { id: run.id, turnId: run.turnId, model, answer }

  // A rate limited provider sends no tokens: the gateway holds the request
  // for a beat, then 429s. A Stop inside that beat settles the run as stopped.
  if (model.rateLimited && !run.cleared) {
    if (run.stoppedAt !== null && raw < RATE_LIMIT.afterMs) {
      return {
        ...base,
        parts: [],
        phase: "stopped",
        elapsedMs: Math.max(0, raw),
        outTokens: 0,
      }
    }
    return {
      ...base,
      parts: [],
      phase: raw >= RATE_LIMIT.afterMs ? "error" : "thinking",
      elapsedMs: Math.min(raw, RATE_LIMIT.afterMs),
      outTokens: 0,
    }
  }

  if (raw >= answer.latencyMs) {
    return {
      ...base,
      parts: answer.parts,
      phase: "done",
      elapsedMs: answer.latencyMs,
      outTokens: answer.tokensOut,
    }
  }

  const linear = clamp01(
    (raw - answer.firstTokenMs) / (answer.latencyMs - answer.firstTokenMs)
  )
  // Front loaded like a real stream, and text and tokens ride this one curve
  // so the tok/s meter never contradicts the words on screen.
  const progress = Math.pow(linear, 0.82)
  const total = answer.parts.reduce((sum, part) => sum + partLength(part), 0)

  return {
    ...base,
    parts: sliceParts(answer.parts, Math.ceil(progress * total)),
    phase:
      run.stoppedAt !== null
        ? "stopped"
        : progress <= 0
          ? "thinking"
          : "streaming",
    elapsedMs: Math.max(0, raw),
    outTokens: Math.round(answer.tokensOut * progress),
  }
}

export function buildPaneView(
  pane: PaneRecord,
  turns: TurnRecord[],
  clock: number
): PaneView {
  const runs = pane.runs
    .map((run) => {
      const turn = turns.find((item) => item.id === run.turnId)
      return turn ? buildRunView(run, turn, clock) : null
    })
    .filter((view): view is RunView => view !== null)

  // A 429 bills nothing and answers nothing, so it counts in neither total.
  const billable = runs.filter((run) => run.phase !== "error")

  return {
    id: pane.id,
    model: modelById(pane.modelId),
    runs,
    newest: runs[runs.length - 1] ?? null,
    busy: runs.some(
      (run) => run.phase === "thinking" || run.phase === "streaming"
    ),
    // Only settled runs count as answers: a run still typing is not one yet.
    answers: billable.filter(
      (run) =>
        (run.phase === "done" || run.phase === "stopped") && run.outTokens > 0
    ).length,
    outTokens: billable.reduce((sum, run) => sum + run.outTokens, 0),
    costUsd: billable.reduce(
      (sum, run) =>
        sum +
        (run.answer.tokensIn * run.model.priceIn +
          run.outTokens * run.model.priceOut) /
          1_000_000,
      0
    ),
  }
}

export function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(value: number) {
  return value.toLocaleString("en-US")
}

export function formatUsd(value: number) {
  return `$${value.toFixed(3)}`
}

/** Output rate so far: tokens landed over the generation window so far. */
export function runRate(run: RunView) {
  if (run.outTokens === 0) return 0
  const window = Math.max(run.elapsedMs - run.answer.firstTokenMs, 1) / 1000
  return Math.round(run.outTokens / window)
}

/** What one run has billed so far: full prompt up front, output as it lands. */
export function runCostUsd(run: RunView) {
  if (run.phase === "error") return 0
  return (
    (run.answer.tokensIn * run.model.priceIn +
      run.outTokens * run.model.priceOut) /
    1_000_000
  )
}

/** The clock reading past which this run no longer moves. */
function runSettleAt(run: RunRecord, turn: TurnRecord) {
  const model = modelById(run.modelId)
  if (model.rateLimited && !run.cleared)
    return run.startedAt + RATE_LIMIT.afterMs
  return (
    run.startedAt + answerFor(turn.prompt, run.modelId, run.variant).latencyMs
  )
}

/** Cheap busy probe for clock selectors: no views get built on the way. */
export function paneBusyAt(
  pane: PaneRecord,
  turns: TurnRecord[],
  clock: number
) {
  return pane.runs.some((run) => {
    if (run.stoppedAt !== null) return false
    const turn = turns.find((item) => item.id === run.turnId)
    return turn !== undefined && clock < runSettleAt(run, turn)
  })
}

/** Flattens an answer back to plain text, so Copy hands over what was read. */
export function answerText(parts: MessagePart[]) {
  return parts
    .map((part) => {
      if (part.kind === "code") return part.code
      if (part.kind === "text") return part.text
      // Tab separated, so a pasted table lands in a spreadsheet as columns.
      const head = part.columns.map((column) => column.label).join("\t")
      const body = part.rows
        .map((row) => part.columns.map((column) => row[column.key]).join("\t"))
        .join("\n")
      return `${head}\n${body}`
    })
    .join("\n\n")
    .trim()
}