import type { BadgeProps } from "@/components/reui/badge"
import type { Edge, Node } from "@xyflow/react"

import { ClaudeAiIcon } from "@/components/ui/svgs/claudeAiIcon"
import { Clickup } from "@/components/ui/svgs/clickup"
import { Neon } from "@/components/ui/svgs/neon"
import { ResendIconBlack } from "@/components/ui/svgs/resendIconBlack"
import { ResendIconWhite } from "@/components/ui/svgs/resendIconWhite"
import { Slack } from "@/components/ui/svgs/slack"
import { Stripe } from "@/components/ui/svgs/stripe"
import { CheckIcon, TriangleAlertIcon, CodeIcon, CircleCheckIcon, CircleXIcon, MinusIcon, CircleDotIcon } from "lucide-react"

/** The services this agent can call. Picking one is what sets a node's mark. */
/** Typed toast icons, so feedback carries semantic colour and not only text. */
export const TOAST_SUCCESS_ICON = (
  <CheckIcon className="text-success size-4" aria-hidden="true" />
)

export const TOAST_ERROR_ICON = (
  <TriangleAlertIcon className="text-destructive size-4" aria-hidden="true" />
)

export type AgentApp =
  "stripe" | "neon" | "claude" | "clickup" | "resend" | "slack" | "custom"

export const APP_LABEL: Record<AgentApp, string> = {
  stripe: "Stripe",
  neon: "Neon",
  claude: "Claude",
  clickup: "ClickUp",
  resend: "Resend",
  slack: "Slack",
  custom: "Custom Code",
}

// customize: swap these for the services your own agent calls.
export const APP_ICON: Record<AgentApp, React.ReactNode> = {
  stripe: <Stripe />,
  neon: <Neon />,
  claude: <ClaudeAiIcon />,
  clickup: <Clickup />,
  // The one mark with no colour of its own, so it ships as a pair.
  resend: (
    <>
      <ResendIconBlack className="dark:hidden" />
      <ResendIconWhite className="hidden dark:block" />
    </>
  ),
  slack: <Slack />,
  custom: (
    <CodeIcon aria-hidden="true" />
  ),
}

export const AGENT_APPS = Object.keys(APP_LABEL) as AgentApp[]

export type AgentStatus = "passed" | "failed" | "skipped" | "idle"

export const STATUS_LABEL: Record<AgentStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  idle: "Not run",
}

/** Semantic badge per status; the node and the panel read the same fact. */
export const STATUS_BADGE: Record<AgentStatus, BadgeProps["variant"]> = {
  passed: "success-light",
  failed: "destructive-light",
  skipped: "outline",
  idle: "outline",
}

/** Inline tone for the node's run line, where there is no tinted surface. */
export const STATUS_TONE: Record<AgentStatus, string> = {
  passed: "text-success",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
  idle: "text-muted-foreground",
}

/** Shape carries the status too, so it never rests on colour alone. */
export const STATUS_ICON: Record<AgentStatus, React.ReactNode> = {
  passed: (
    <CircleCheckIcon aria-hidden="true" />
  ),
  failed: (
    <CircleXIcon aria-hidden="true" />
  ),
  skipped: (
    <MinusIcon aria-hidden="true" />
  ),
  idle: (
    <CircleDotIcon aria-hidden="true" />
  ),
}

export type AgentNodeData = {
  app: AgentApp
  /** The step name, usually the service or the in house function. */
  title: string
  detail: string
  /** What this node type measures: tokens, latency, rows, matches. One
   *  segment per fact, so the strip separates them rather than the string. */
  facts: string[]
  status: AgentStatus
}

export type AgentNodeType = Node<AgentNodeData, "agent">

export type AgentEdgeData = {
  /** Names which outcome of a branching parent this path is. */
  branchLabel?: string
}

export type AgentEdgeType = Edge<AgentEdgeData, "tree">

export const AGENT = {
  id: "ag_5t2r8w",
  name: "Collections Agent",
  section: "Agents",
  revision: "Draft 4",
  run: "run_3f9a1c",
  // The branch the recorded test input takes at every fork it reaches.
  testPath: "Promised",
  owner: {
    name: "Hanna Berg",
    initials: "HB",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&h=96&dpr=2&q=80",
  },
}

// customize: replace with your own agent steps.
const SEED: {
  id: string
  parent?: string
  branchLabel?: string
  data: AgentNodeData
}[] = [
  {
    id: "overdue",
    data: {
      app: "stripe",
      title: "Stripe",
      detail: "Invoice 3 days overdue",
      facts: ["inv_9412", "EUR 4,180"],
      status: "passed",
    },
  },
  {
    id: "ledger",
    parent: "overdue",
    data: {
      app: "neon",
      title: "Neon",
      detail: "Runs query_db on invoices",
      facts: ["1 row", "42ms"],
      status: "passed",
    },
  },
  {
    id: "triage",
    parent: "ledger",
    data: {
      app: "claude",
      title: "Claude Sonnet 5",
      detail: "Triages the account",
      facts: ["1,842 tokens", "USD 0.031"],
      status: "passed",
    },
  },
  {
    id: "charges",
    parent: "triage",
    branchLabel: "Disputed",
    data: {
      app: "stripe",
      title: "Stripe",
      detail: "Pulls the dispute evidence",
      facts: ["Branch not taken"],
      status: "skipped",
    },
  },
  {
    id: "assign",
    parent: "charges",
    data: {
      app: "clickup",
      title: "ClickUp",
      detail: "Assigns Hanna Berg",
      facts: ["Upstream skipped"],
      status: "skipped",
    },
  },
  {
    id: "terms",
    parent: "triage",
    branchLabel: "Promised",
    data: {
      app: "stripe",
      title: "Stripe",
      detail: "Offers a payment plan",
      facts: ["3 instalments", "EUR 1,393"],
      status: "passed",
    },
  },
  {
    id: "confirm",
    parent: "terms",
    data: {
      app: "resend",
      title: "Resend",
      detail: "Emails the terms to Maren",
      facts: ["Bounced", "Retry queued"],
      status: "failed",
    },
  },
  {
    id: "redact",
    parent: "triage",
    branchLabel: "No reply",
    data: {
      app: "custom",
      title: "PII Guardrail",
      detail: "Scans outbound text",
      facts: ["Branch not taken"],
      status: "skipped",
    },
  },
  {
    id: "callback",
    parent: "redact",
    data: {
      app: "slack",
      title: "Slack",
      detail: "Posts to #collections",
      facts: ["Upstream skipped"],
      status: "skipped",
    },
  },
]

export const INITIAL_NODES: AgentNodeType[] = SEED.map((entry) => ({
  id: entry.id,
  type: "agent",
  position: { x: 0, y: 0 },
  data: entry.data,
}))

export const INITIAL_EDGES: AgentEdgeType[] = SEED.filter(
  (entry) => entry.parent
).map((entry) => ({
  id: `${entry.parent}->${entry.id}`,
  source: entry.parent as string,
  target: entry.id,
  type: "tree",
  data: { branchLabel: entry.branchLabel },
}))

type RecordedStep = { status: AgentStatus; facts: string[]; title: string }

/** What the recorded test input did at each step it reached, read off the seed. */
export const RECORDED_RUN = new Map(
  SEED.filter(
    (entry) => entry.data.status === "passed" || entry.data.status === "failed"
  ).map((entry): [string, RecordedStep] => [
    entry.id,
    {
      status: entry.data.status,
      facts: entry.data.facts,
      title: entry.data.title,
    },
  ])
)

/** Values are model step titles; each carries what the test input costs there. */
export const MODEL_OPTIONS: {
  value: string
  label: string
  facts: string[]
}[] = [
  {
    value: "Claude Opus 5",
    label: "Opus 5",
    facts: ["1,768 tokens", "USD 0.050"],
  },
  {
    value: "Claude Sonnet 5",
    label: "Sonnet 5",
    facts: ["1,842 tokens", "USD 0.031"],
  },
  {
    value: "Claude Haiku 4.5",
    label: "Haiku 4.5",
    facts: ["1,905 tokens", "USD 0.011"],
  },
]

// Mirrors the CanvasToolbar key handler and the canvas delete key.
export const SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "Select", keys: ["V"] },
  { label: "Pan", keys: ["H"] },
  { label: "Zoom in", keys: ["+"] },
  { label: "Zoom out", keys: ["-"] },
  { label: "Zoom to fit", keys: ["shift", "1"] },
  { label: "Actual size", keys: ["shift", "0"] },
  { label: "Run test", keys: ["mod", "Enter"] },
  { label: "Delete step", keys: ["Backspace"] },
]

/** The trigger starts the run, so no path can delete it. */
export const ROOT_ID = "overdue"

// New steps land as custom code until they are pointed at a service.
export function createAgentNode(id: string): AgentNodeType {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: {
      app: "custom",
      title: "New step",
      detail: "Not configured yet",
      facts: ["No test run yet"],
      status: "idle",
    },
  }
}