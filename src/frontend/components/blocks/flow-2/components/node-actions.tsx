"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { Badge } from "@/components/reui/badge"
import { IconTile } from "@/components/reui/icon-tile"
import { useReactFlow } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AGENT_APPS,
  APP_ICON,
  APP_LABEL,
  createAgentNode,
  MODEL_OPTIONS,
  ROOT_ID,
  STATUS_BADGE,
  STATUS_ICON,
  STATUS_LABEL,
  TOAST_SUCCESS_ICON,
  type AgentApp,
  type AgentEdgeType,
  type AgentNodeData,
  type AgentNodeType,
} from "./data"
import {
  captionKey,
  childPosition,
  insertOnEdge,
  LEAF_EXTRA,
  leafIdsOf,
  nameFork,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./flow-layout"
import { clearResults } from "./test-run"
import { InfoIcon, XIcon, PlusIcon } from "lucide-react"

type NodeDraft = {
  title: string
  detail: string
  app: AgentApp
  branchLabel: string
}

type InspectTarget = { nodeId: string; mode: "view" | "edit" } | null

/** Why the draft caption cannot save: empty on a fork, or a sibling's name. */
type PathProblem = "blank" | "taken"

const PATH_ERROR: Record<PathProblem, string> = {
  blank: "Paths on a fork need a name.",
  taken: "Another path here uses this name.",
}

type AgentActionsApi = {
  inspect: (nodeId: string, mode: "view" | "edit", seed?: NodeDraft) => void
  addStep: () => void
  insertOn: (edgeId: string) => void
  appendAfter: (nodeId: string) => void
  branch: (nodeId: string) => void
  remove: (nodeId: string) => void
  changeModel: (title: string) => void
  modelStep: AgentNodeType | undefined
  close: () => void
  save: () => void
  setDraft: React.Dispatch<React.SetStateAction<NodeDraft>>
  target: InspectTarget
  draft: NodeDraft
  data: AgentNodeData | undefined
  leafIds: Set<string>
  branchLabel: string | undefined
  /** Why the draft caption cannot save, or null when it can. */
  pathProblem: PathProblem | null
  childCount: number
  hoveredEdge: string | null
  setHoveredEdge: (edgeId: string | null) => void
}

const AgentActionsContext = createContext<AgentActionsApi | null>(null)

/** Nodes and edges reach their own actions here; the shell owns the state. */
export function useAgentActions() {
  const api = useContext(AgentActionsContext)

  if (!api) {
    throw new Error("useAgentActions must be used inside AgentActionsProvider")
  }

  return api
}

// Inserted ids are counted, never random, so a run reproduces exactly.
let nodeCount = 0

/** Follows the first path out of the trigger down to the step it ends on. */
function endOfRun(edges: AgentEdgeType[]) {
  let id = ROOT_ID
  let next = edges.find((edge) => edge.source === id)

  while (next) {
    id = next.target
    next = edges.find((edge) => edge.source === id)
  }

  return id
}

interface AgentActionsProviderProps {
  nodes: AgentNodeType[]
  edges: AgentEdgeType[]
  commit: (nodes: AgentNodeType[], edges: AgentEdgeType[]) => void
  hoveredEdge: string | null
  setHoveredEdge: (edgeId: string | null) => void
  children: React.ReactNode
}

export function AgentActionsProvider({
  nodes,
  edges,
  commit,
  hoveredEdge,
  setHoveredEdge,
  children,
}: AgentActionsProviderProps) {
  const { deleteElements } = useReactFlow()
  const [target, setTarget] = useState<InspectTarget>(null)
  const [draft, setDraft] = useState<NodeDraft>({
    title: "",
    detail: "",
    app: "custom",
    branchLabel: "",
  })

  const leafIds = leafIdsOf(nodes, edges)
  const incoming = target
    ? edges.find((edge) => edge.target === target.nodeId)
    : undefined
  const branchLabel = incoming?.data?.branchLabel
  // A run takes a path by its caption, so the draft is judged as it saves,
  // trimmed, and a sibling's name in any case is refused.
  const caption = draft.branchLabel.trim()
  const siblings =
    incoming && branchLabel !== undefined
      ? edges.filter(
          (edge) => edge.source === incoming.source && edge.id !== incoming.id
        )
      : []
  const pathProblem: PathProblem | null =
    siblings.length > 0 && caption === ""
      ? "blank"
      : caption !== "" &&
          siblings.some(
            (edge) => captionKey(edge.data?.branchLabel) === captionKey(caption)
          )
        ? "taken"
        : null
  const childCount = target
    ? edges.filter((edge) => edge.source === target.nodeId).length
    : 0

  // A node created this tick is not in state yet, so its values arrive as a
  // seed rather than a lookup that would return nothing.
  function inspect(nodeId: string, mode: "view" | "edit", seed?: NodeDraft) {
    const found = nodes.find((node) => node.id === nodeId)?.data
    const label = edges.find((edge) => edge.target === nodeId)?.data
      ?.branchLabel

    setDraft(
      seed ?? {
        title: found?.title ?? "",
        detail: found?.detail ?? "",
        app: found?.app ?? "custom",
        branchLabel: label ?? "",
      }
    )
    setTarget({ nodeId, mode })
  }

  // group/node carries the focus ring, the same as every seeded step.
  function nextNode(position = { x: 0, y: 0 }): AgentNodeType {
    nodeCount += 1
    return {
      ...createAgentNode(`step_${nodeCount}`),
      className: "group/node",
      position,
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT + LEAF_EXTRA,
    }
  }

  // Every insert path lands here, so one toast covers them all; the step is on
  // screen with its form open, so it names the path instead of offering Undo.
  function openNew(node: AgentNodeType, label?: string) {
    inspect(node.id, "edit", {
      title: node.data.title,
      detail: node.data.detail,
      app: node.data.app,
      branchLabel: label ?? "",
    })
    toast.success("Step created", {
      description: label ? `${node.data.title} on ${label}.` : node.data.title,
      icon: TOAST_SUCCESS_ICON,
    })
  }

  // Every change clears the last run so no trace outlives its graph. The new
  // step heads the path its edge named, so it opens on that caption.
  function insertOn(edgeId: string) {
    const node = nextNode()
    const next = insertOnEdge(nodes, edges, edgeId, node)

    commit(clearResults(next.nodes), next.edges)
    openNew(
      node,
      next.edges.find((edge) => edge.target === node.id)?.data?.branchLabel
    )
  }

  // A fork's paths are all named, so the first branch also names the path the
  // node already had, and a second New path under one parent is numbered.
  function branch(nodeId: string) {
    const node = nextNode(childPosition(nodes, edges, nodeId))
    const id = `${nodeId}->${node.id}`
    const nextEdges = nameFork(
      [
        ...edges,
        {
          id,
          source: nodeId,
          target: node.id,
          type: "tree",
          data: { branchLabel: "New path" },
        },
      ],
      nodeId
    )

    commit(clearResults([...nodes, node]), nextEdges)
    openNew(node, nextEdges.find((edge) => edge.id === id)?.data?.branchLabel)
  }

  // A step that already has a child forks, so the new path is named the way
  // Add branch names one; a leaf simply extends its line.
  function appendAfter(nodeId: string) {
    if (edges.some((edge) => edge.source === nodeId)) {
      branch(nodeId)
      return
    }

    const node = nextNode(childPosition(nodes, edges, nodeId))

    commit(clearResults([...nodes, node]), [
      ...edges,
      {
        id: `${nodeId}->${node.id}`,
        source: nodeId,
        target: node.id,
        type: "tree",
        data: {},
      },
    ])
    openNew(node)
  }

  // The header adds where the eye is: onto the selected step, and with nothing
  // selected onto the step the run currently ends on.
  function addStep() {
    const selected = nodes.find((node) => node.selected)

    appendAfter(selected?.id ?? endOfRun(edges))
  }

  // The one removal path, so the confirmation the canvas installs always runs.
  function remove(nodeId: string) {
    void deleteElements({ nodes: [{ id: nodeId }] })
  }

  // An edit is a change to the tree and clears the last run, since a title picks
  // the model result and a caption picks the path; an unchanged Save keeps it.
  function save() {
    if (!target || pathProblem) {
      return
    }

    const step = nodes.find((node) => node.id === target.nodeId)?.data
    const before = { nodes, edges }
    const changed =
      step?.title !== draft.title ||
      step.detail !== draft.detail ||
      step.app !== draft.app ||
      (branchLabel !== undefined && branchLabel !== caption)

    if (changed) {
      commit(
        clearResults(
          nodes.map((node) =>
            node.id === target.nodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    title: draft.title,
                    detail: draft.detail,
                    app: draft.app,
                  },
                }
              : node
          )
        ),
        edges.map((edge) =>
          edge.target === target.nodeId && edge.data?.branchLabel !== undefined
            ? { ...edge, data: { ...edge.data, branchLabel: caption } }
            : edge
        )
      )
      toast.success("Step updated", {
        description: draft.title,
        icon: TOAST_SUCCESS_ICON,
        action: {
          label: "Undo",
          onClick: () => commit(before.nodes, before.edges),
        },
        duration: 8000,
      })
    }

    setTarget({ nodeId: target.nodeId, mode: "view" })
  }

  // The model step's title is the one truth the header and the inspector edit.
  const modelStep = nodes.find((node) => node.data.app === "claude")

  // A new model invalidates every result, and an open draft follows the switch
  // so a later Save cannot bring the old title back.
  function changeModel(title: string) {
    if (!modelStep) {
      return
    }

    const before = { nodes, edges }

    commit(
      clearResults(nodes).map((node) =>
        node.id === modelStep.id
          ? { ...node, data: { ...node.data, title } }
          : node
      ),
      edges
    )

    if (target?.nodeId === modelStep.id) {
      setDraft((current) => ({ ...current, title }))
    }

    // Switching models silently drops the whole trace, so the toast says so and
    // its Undo brings back the graph with the previous run still on it.
    toast.success("Model changed", {
      description: `${title}. Last run cleared.`,
      icon: TOAST_SUCCESS_ICON,
      action: {
        label: "Undo",
        onClick: () => commit(before.nodes, before.edges),
      },
      duration: 8000,
    })
  }

  // A node can leave by a route the panel never hears about, so the panel
  // checks the graph rather than trusting its own close handler.
  useEffect(() => {
    if (target && !nodes.some((node) => node.id === target.nodeId)) {
      setTarget(null)
    }
  }, [nodes, target])

  const data = target
    ? nodes.find((node) => node.id === target.nodeId)?.data
    : undefined

  return (
    <AgentActionsContext.Provider
      value={{
        inspect,
        addStep,
        insertOn,
        appendAfter,
        branch,
        remove,
        changeModel,
        modelStep,
        close: () => setTarget(null),
        save,
        setDraft,
        target,
        draft,
        data,
        leafIds,
        branchLabel,
        pathProblem,
        childCount,
        hoveredEdge,
        setHoveredEdge,
      }}
    >
      {children}
    </AgentActionsContext.Provider>
  )
}

/** The mark beside its name, the row the trigger and the list both take. */
function AppLine({ app }: { app: AgentApp }) {
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <IconTile size="xs" variant="outline">
        {APP_ICON[app]}
      </IconTile>
      {APP_LABEL[app]}
    </span>
  )
}

/** Guidance sits behind an icon, so each field stays a label and a control. */
function FieldHint({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground -my-1"
            aria-label={label}
          />
        }
      >
        <InfoIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/** Label left, value right: a narrow panel reads better than stacked rows. */
function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-muted-foreground min-w-0">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words tabular-nums">
        {value}
      </dd>
    </div>
  )
}

function NodePanel() {
  const {
    branchLabel,
    childCount,
    close,
    data,
    draft,
    inspect,
    pathProblem,
    save,
    setDraft,
    target,
  } = useAgentActions()
  const editing = target?.mode === "edit"
  const onBranch = branchLabel !== undefined

  return (
    <div className="bg-card flex h-full flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
        <IconTile size="sm">{APP_ICON[data?.app ?? "custom"]}</IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-sm font-semibold">
            {data?.title ?? draft.title}
          </h2>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <Badge variant="outline">{APP_LABEL[data?.app ?? "custom"]}</Badge>
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="truncate">{target?.nodeId}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-me-1.5 -mt-1"
          aria-label="Close node details"
          onClick={close}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {editing ? (
          <TooltipProvider delay={300}>
            <FieldGroup>
              <Field>
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="node-title">Title</FieldLabel>
                  <FieldHint label="About the title">
                    The integration or service this step calls.
                  </FieldHint>
                </div>
                <Input
                  id="node-title"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="node-detail">Detail</FieldLabel>
                  <FieldHint label="About the detail">
                    What the step does, in one short clause.
                  </FieldHint>
                </div>
                <Input
                  id="node-detail"
                  value={draft.detail}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      detail: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field>
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="node-app">App</FieldLabel>
                  <FieldHint label="About the app">
                    The service this step calls. Its mark is what the node
                    shows.
                  </FieldHint>
                </div>
                <Select
                  value={draft.app}
                  onValueChange={(value) =>
                    value &&
                    setDraft((current) => ({
                      ...current,
                      app: value as AgentApp,
                    }))
                  }
                >
                  <SelectTrigger id="node-app" className="w-full">
                    <SelectValue>
                      <AppLine app={draft.app} />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {AGENT_APPS.map((app) => (
                      <SelectItem key={app} value={app}>
                        <AppLine app={app} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {onBranch ? (
                <Field data-invalid={pathProblem !== null || undefined}>
                  <div className="flex items-center gap-1.5">
                    <FieldLabel htmlFor="node-path">Path</FieldLabel>
                    <FieldHint label="About the path">
                      The caption on the connector above, naming this outcome.
                    </FieldHint>
                  </div>
                  <Input
                    id="node-path"
                    value={draft.branchLabel}
                    aria-invalid={pathProblem !== null || undefined}
                    aria-describedby={
                      pathProblem ? "node-path-error" : undefined
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        branchLabel: event.target.value,
                      }))
                    }
                  />
                  {pathProblem ? (
                    <FieldError id="node-path-error">
                      {PATH_ERROR[pathProblem]}
                    </FieldError>
                  ) : null}
                </Field>
              ) : null}
            </FieldGroup>
          </TooltipProvider>
        ) : (
          <section className="flex flex-col gap-3" aria-labelledby="node-facts">
            <h3 id="node-facts" className="text-sm font-semibold">
              Step
            </h3>
            <dl className="flex flex-col gap-3">
              <FactRow label="Detail" value={data?.detail} />
              <FactRow label="App" value={data ? APP_LABEL[data.app] : null} />
              {onBranch ? (
                <FactRow label="Path" value={branchLabel || "Unnamed"} />
              ) : null}
              <FactRow label="Next steps" value={childCount} />
              <FactRow label="Last run" value={data?.facts.join(", ")} />
              <FactRow
                label="Result"
                value={
                  data ? (
                    <Badge variant={STATUS_BADGE[data.status]}>
                      {STATUS_ICON[data.status]}
                      {STATUS_LABEL[data.status]}
                    </Badge>
                  ) : null
                }
              />
            </dl>
          </section>
        )}
      </div>
      <footer className="shrink-0 border-t p-4">
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={pathProblem !== null} onClick={save}>
              Save step
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => target && inspect(target.nodeId, "edit")}
          >
            Edit step
          </Button>
        )}
      </footer>
    </div>
  )
}

/** The header's create action; every other add starts from a node or a connector. */
export function AddStepButton() {
  const { addStep } = useAgentActions()

  return (
    <Button variant="outline" onClick={addStep}>
      <PlusIcon aria-hidden="true" />
      Add step
    </Button>
  )
}

/** Picks the model the agent's Claude step calls, by rewriting that step. */
export function ModelSelect() {
  const { changeModel, modelStep } = useAgentActions()
  const title = modelStep?.data.title
  const label =
    MODEL_OPTIONS.find((option) => option.value === title)?.label ??
    title ??
    "No model"

  return (
    <Select
      value={modelStep?.data.title ?? null}
      disabled={!modelStep}
      onValueChange={(value) => value && changeModel(value)}
    >
      <SelectTrigger aria-label="Model" className="max-lg:hidden">
        {APP_ICON.claude}
        {/* The placeholder is what a twin with no selected value falls back to. */}
        <SelectValue placeholder="No model">{label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {MODEL_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Below lg the panel rides an overlay sheet; at lg+ it floats over the canvas.
// A 384px panel beside a tree needs about 1024px before both read well.
const LG_QUERY = "(max-width: 1023px)"

function subscribeBelowLg(onChange: () => void) {
  const query = window.matchMedia(LG_QUERY)

  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/**
 * Read straight from matchMedia, so a phone's first paint already gets the
 * sheet instead of flashing the desktop panel for a frame.
 */
function useIsBelowLg() {
  return useSyncExternalStore(
    subscribeBelowLg,
    () => window.matchMedia(LG_QUERY).matches,
    () => false
  )
}

export function NodeInspectorPanel() {
  const { close, target } = useAgentActions()
  const belowLg = useIsBelowLg()
  const open = target !== null
  const panel = <NodePanel />

  return (
    <>
      {/* Floats over the canvas instead of resizing it, so the tree never
          reflows and only a transform moves. */}
      {belowLg ? null : (
        <div
          role="complementary"
          aria-label="Node details"
          aria-hidden={!open}
          inert={!open}
          className={cn(
            "absolute inset-y-0 end-0 z-10 w-96 border-s transition-[translate] duration-300 ease-in-out motion-reduce:transition-none",
            open ? "translate-x-0" : "translate-x-full"
          )}
        >
          {panel}
        </div>
      )}

      {/* Mounted closed so the first open still plays the sheet transition. */}
      <Sheet open={belowLg && open} onOpenChange={(next) => !next && close()}>
        <SheetContent
          side="right"
          initialFocus={false}
          showCloseButton={false}
          className="w-full p-0 sm:max-w-96"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Node Details</SheetTitle>
            <SheetDescription>View or edit this agent step.</SheetDescription>
          </SheetHeader>
          {panel}
        </SheetContent>
      </Sheet>
    </>
  )
}