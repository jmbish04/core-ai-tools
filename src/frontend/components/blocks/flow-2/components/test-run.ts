import {
  AGENT,
  MODEL_OPTIONS,
  RECORDED_RUN,
  ROOT_ID,
  type AgentEdgeType,
  type AgentNodeType,
  type AgentStatus,
} from "./data"
import { captionKey } from "./flow-layout"

type Outcome = { status: AgentStatus; facts: string[] }

export type TestRun = {
  nodes: AgentNodeType[]
  passed: number
  failed: number
  skipped: number
  unconnected: number
}

/** Every step back to not run, which is the state an edited agent is in. */
export function clearResults(nodes: AgentNodeType[]): AgentNodeType[] {
  return nodes.map((node) => ({
    ...node,
    data: { ...node.data, facts: ["No test run yet"], status: "idle" },
  }))
}

// A model step costs what its model costs, so switching models changes the
// numbers; any other step replays what the recorded input did there.
function outcomeOf(node: AgentNodeType): Outcome {
  const model =
    node.data.app === "claude"
      ? MODEL_OPTIONS.find((option) => option.value === node.data.title)
      : undefined
  const recording = RECORDED_RUN.get(node.id)

  if (model) {
    return { status: "passed", facts: model.facts }
  }

  if (
    recording &&
    (node.data.app !== "claude" || recording.title === node.data.title)
  ) {
    return { status: recording.status, facts: recording.facts }
  }

  return { status: "failed", facts: ["No test fixture"] }
}

export function runTest(
  nodes: AgentNodeType[],
  edges: AgentEdgeType[]
): TestRun {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outcomes = new Map<string, Outcome>()
  const childrenOf = (id: string) =>
    edges.filter((edge) => edge.source === id && byId.has(edge.target))

  const skipBelow = (id: string, facts: string[]) => {
    for (const edge of childrenOf(id)) {
      if (!outcomes.has(edge.target)) {
        outcomes.set(edge.target, { status: "skipped", facts })
        skipBelow(edge.target, facts)
      }
    }
  }

  const visit = (id: string) => {
    const node = byId.get(id)

    if (!node || outcomes.has(id)) {
      return
    }

    const outcome = outcomeOf(node)

    outcomes.set(id, outcome)

    if (outcome.status === "failed") {
      skipBelow(id, ["Upstream failed"])
      return
    }

    // Edge order is the fork's left to right order, so the first path is the
    // fallback when no caption names the recorded outcome.
    const out = childrenOf(id)
    const taken =
      out.find(
        (edge) =>
          captionKey(edge.data?.branchLabel) === captionKey(AGENT.testPath)
      ) ?? out[0]

    for (const edge of out) {
      if (edge === taken) {
        visit(edge.target)
      } else if (!outcomes.has(edge.target)) {
        outcomes.set(edge.target, {
          status: "skipped",
          facts: ["Branch not taken"],
        })
        skipBelow(edge.target, ["Upstream skipped"])
      }
    }
  }

  visit(ROOT_ID)

  const run: TestRun = {
    nodes: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    unconnected: 0,
  }

  run.nodes = nodes.map((node) => {
    const outcome = outcomes.get(node.id)

    if (!outcome) {
      run.unconnected += 1
    } else if (outcome.status === "passed") {
      run.passed += 1
    } else if (outcome.status === "skipped") {
      run.skipped += 1
    } else if (outcome.status === "failed") {
      run.failed += 1
    }

    // A step no path reaches never ran, and says so rather than looking idle.
    return {
      ...node,
      data: {
        ...node.data,
        ...(outcome ?? { status: "idle", facts: ["Not connected"] }),
      },
    }
  })

  return run
}