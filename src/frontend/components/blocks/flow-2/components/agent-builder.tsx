import { useCallback, useEffect, useRef, useState } from "react"
import {
  getNodesBounds,
  Panel,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeTypes,
  type HandleType,
  type IsValidConnection,
  type NodeTypes,
  type OnBeforeDelete,
  type OnConnectEnd,
  type OnConnectStart,
  type OnDelete,
  type OnMoveEnd,
} from "@xyflow/react"
import { toast } from "sonner"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { AgentMenu } from "./agent-menu"
import { CanvasToolbar, type CanvasTool } from "./canvas-toolbar"
import {
  AGENT,
  INITIAL_EDGES,
  INITIAL_NODES,
  ROOT_ID,
  TOAST_ERROR_ICON,
  TOAST_SUCCESS_ICON,
  type AgentEdgeType,
  type AgentNodeType,
} from "./data"
import { useDeleteConfirmation } from "./delete-confirmation"
import { FlowCanvas } from "./flow-canvas"
import { FlowKeys } from "./flow-keys"
import {
  connectionProblem,
  layoutTree,
  LEAF_EXTRA,
  leafIdsOf,
  nameFork,
  NODE_HEIGHT,
  NODE_WIDTH,
} from "./flow-layout"
import {
  AddStepButton,
  AgentActionsProvider,
  ModelSelect,
  NodeInspectorPanel,
} from "./node-actions"
import { clearResults, runTest } from "./test-run"
import { TreeEdge } from "./tree-edge"
import { TreeNode } from "./tree-node"
import { PlayIcon } from "lucide-react"

// The opening frame only, pinned to 1 both ways: a canvas you pan beats type
// rendered at a fraction of its size. The toolbar's Zoom to fit is free to shrink.
const INITIAL_FIT = { padding: 0.04, minZoom: 1, maxZoom: 1 }

// The canvas margin the framing leaves around the tree.
const VIEW_INSET = 32

// The toolbar floats over the bottom edge: a 24px inset, a bar up to 44px tall
// in the roomiest style, then the same margin, so a fitted tree clears it.
const TOOLBAR_RESERVE = 24 + 44 + VIEW_INSET

// One end of a link: the step and which of its two handles.
type LinkEnd = { nodeId: string; type: HandleType }

// Module scope: a new nodeTypes or edgeTypes object per render remounts
// every node and edge on the canvas.
const nodeTypes = { agent: TreeNode } satisfies NodeTypes
const edgeTypes = { tree: TreeEdge } satisfies EdgeTypes

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`

// The kit's edge stroke is translucent, so a shared trunk darkened where two
// connections overlap; the same grey mixed into the page stays one solid color.
const EDGE_STROKE =
  "[--xy-edge-stroke:color-mix(in_oklab,var(--muted-foreground)_45%,var(--background))]"

// group/node lets the node paint a focus ring: the engine puts focus on its own
// wrapper and strips the outline, so the card below has to answer for it.
const SEEDED: AgentNodeType[] = INITIAL_NODES.map((node) => ({
  ...node,
  className: "group/node",
  deletable: node.id !== ROOT_ID,
  initialWidth: NODE_WIDTH,
  // A seed leaf carries its trailing plus, so it starts taller.
  initialHeight: INITIAL_EDGES.some((edge) => edge.source === node.id)
    ? NODE_HEIGHT
    : NODE_HEIGHT + LEAF_EXTRA,
}))

export function AgentBuilder() {
  return (
    <ReactFlowProvider>
      <AgentEditor />
    </ReactFlowProvider>
  )
}

function AgentEditor() {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)
  // Every fit waits for the relayout to land. It starts armed so the first
  // view is fitted, and re-arms whenever a card's measured size moves.
  const pendingFit = useRef(true)
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeType>(SEEDED)
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<AgentEdgeType>(INITIAL_EDGES)
  const [layoutVersion, setLayoutVersion] = useState(0)
  // Opens in Pan, so a first drag explores the tree and never nudges a step.
  const [tool, setTool] = useState<CanvasTool>("hand")
  // dagre owns every position until a step is moved by hand.
  const [arranged, setArranged] = useState(true)
  const { getEdges, getNodes, setViewport } = useReactFlow<
    AgentNodeType,
    AgentEdgeType
  >()
  const { onBeforeDelete, dialog } = useDeleteConfirmation()
  // Holds the tree the confirmation approved, so the delete toast can put it back.
  const graphBeforeDelete = useRef<{
    nodes: AgentNodeType[]
    edges: AgentEdgeType[]
  } | null>(null)
  const nodesInitialized = useNodesInitialized()
  // Pan holds every step still, so a drag anywhere moves the view, never the tree.
  const editable = tool === "select"
  const counts = `${plural(nodes.length, "step")}, ${plural(leafIdsOf(nodes, edges).size, "path")}`

  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)

  // Changes only when a card is measured, never when one moves, which is what
  // keeps the layout effect below from feeding itself.
  const sizeKey = useStore((state) => {
    let key = ""

    for (const [id, node] of state.nodeLookup) {
      key += `${id}:${node.measured.width ?? 0}x${node.measured.height ?? 0};`
    }

    return key
  })

  // Every graph mutation lands here, so one place bumps the layout.
  const commit = useCallback(
    (nextNodes: AgentNodeType[], nextEdges: AgentEdgeType[]) => {
      setNodes(nextNodes)
      setEdges(nextEdges)
      setLayoutVersion((version) => version + 1)
    },
    [setEdges, setNodes]
  )

  /**
   * Frames the placed tree at scale 1. A run reads downward, so a tree taller
   * than the canvas anchors at the top rather than cutting off its trigger.
   */
  const frameTree = useCallback(
    (placed: AgentNodeType[]) => {
      const bounds = getNodesBounds(placed)

      // The pane reports zero until it is measured, so the caller retries.
      if (!paneWidth || !paneHeight || !bounds.width || !bounds.height) {
        return false
      }

      // The band a fitted tree centres in stops above the toolbar.
      const fits = bounds.height + VIEW_INSET + TOOLBAR_RESERVE <= paneHeight

      void setViewport({
        x: Math.round((paneWidth - bounds.width) / 2 - bounds.x),
        y: Math.round(
          fits
            ? (paneHeight - TOOLBAR_RESERVE + VIEW_INSET - bounds.height) / 2 -
                bounds.y
            : VIEW_INSET - bounds.y
        ),
        zoom: 1,
      })

      return true
    },
    [paneHeight, paneWidth, setViewport]
  )

  // Declared above the layout so a fresh measurement arms the framing before
  // the layout that consumes it runs.
  useEffect(() => {
    pendingFit.current = true
  }, [sizeKey])

  // The layout frames from what it just placed, so the view is never computed
  // from the previous pass's geometry. A hand arrangement is left alone.
  useEffect(() => {
    if (!nodesInitialized || !arranged) {
      return
    }

    const placed = layoutTree(getNodes(), getEdges())

    setNodes(placed)

    // Held armed until a framing actually lands, so a pane measured a tick
    // late still gets its first view.
    if (pendingFit.current && frameTree(placed)) {
      pendingFit.current = false
    }
  }, [
    arranged,
    layoutVersion,
    sizeKey,
    nodesInitialized,
    frameTree,
    getEdges,
    getNodes,
    setNodes,
  ])

  // Fit centres the tree on half pixels, which smears every 1px rule; each move
  // lands on whole pixels so connectors stay as crisp as the card borders.
  const snapViewport = useCallback<OnMoveEnd>(
    (_, viewport) => {
      const x = Math.round(viewport.x)
      const y = Math.round(viewport.y)

      if (x !== viewport.x || y !== viewport.y) {
        void setViewport({ x, y, zoom: viewport.zoom })
      }
    },
    [setViewport]
  )

  // Hands the layout back to dagre and brings the whole tree into view.
  const tidy = useCallback(() => {
    setArranged(true)
    pendingFit.current = true
    setLayoutVersion((version) => version + 1)
  }, [])

  // The engine reports a drag stop only past its threshold, so a click never lands here.
  const markMoved = useCallback(() => setArranged(false), [])

  // Arrow keys move a selected step without a drag, so they hand over the layout too.
  const markKeyMove = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        editable &&
        !event.repeat &&
        event.key.startsWith("Arrow") &&
        event.target instanceof Element &&
        event.target.closest(
          ".react-flow__node.selected, .react-flow__nodesselection-rect"
        )
      ) {
        setArranged(false)
      }
    },
    [editable]
  )

  // Reads the live edges, so the guard never judges a link against a stale tree.
  const isValidConnection = useCallback<IsValidConnection<AgentEdgeType>>(
    (connection) =>
      connection.target !== ROOT_ID &&
      connectionProblem(getEdges(), connection.source, connection.target) ===
        null,
    [getEdges]
  )

  // The id of the link the engine last committed, so a click can tell whether
  // its connection went through.
  const lastLink = useRef<string | null>(null)

  // A step has one parent, so a new link re-hangs the step and its subtree
  // under the new parent, and the last run no longer describes the tree.
  const onConnect = useCallback(
    ({ source, target }: Connection) => {
      const current = getEdges()
      const previous = current.find((edge) => edge.target === target)
      const kept = current.filter((edge) => edge.target !== target)
      const fork = kept.some((edge) => edge.source === source)
      const stranded = previous
        ? kept.filter((edge) => edge.source === previous.source)
        : []

      // One child left is a straight line, not a fork, so it drops its caption.
      const settled = kept.map((edge): AgentEdgeType =>
        stranded.length === 1 && edge.id === stranded[0].id
          ? { ...edge, data: { ...edge.data, branchLabel: undefined } }
          : edge
      )
      const link: AgentEdgeType = {
        id: `${source}->${target}`,
        source,
        target,
        type: "tree",
        data: {
          branchLabel: fork
            ? previous?.data?.branchLabel || "New path"
            : undefined,
        },
      }

      lastLink.current = link.id
      // A fork's paths are all named, the same rule Add branch follows, and a
      // caption one of the new siblings already reads is numbered.
      commit(
        clearResults(getNodes()),
        fork ? nameFork([...settled, link], source) : [...settled, link]
      )
    },
    [commit, getEdges, getNodes]
  )

  // The engine only greys a refused link, so the reason arrives as a toast.
  // A drag and a click-to-connect both explain themselves here.
  const explainRefusal = useCallback(
    (from: LinkEnd, to: LinkEnd) => {
      const fromSource = from.type === "source"
      const source = fromSource ? from.nodeId : to.nodeId
      const target = fromSource ? to.nodeId : from.nodeId
      const titleOf = (id: string) =>
        getNodes().find((node) => node.id === id)?.data.title ?? "This step"
      const problem =
        from.type === to.type
          ? "direction"
          : connectionProblem(getEdges(), source, target)
      const reason =
        problem === "direction"
          ? "Link a step's bottom to another step's top."
          : problem === "self"
            ? "A step cannot follow itself."
            : problem === "linked"
              ? `${titleOf(target)} already follows ${titleOf(source)}.`
              : problem === "cycle"
                ? `${titleOf(target)} runs before ${titleOf(source)}.`
                : null

      if (reason) {
        toast.error("Cannot connect", {
          description: reason,
          icon: TOAST_ERROR_ICON,
        })
      }
    },
    [getEdges, getNodes]
  )

  const explainRejection = useCallback<OnConnectEnd>(
    (_, { fromHandle, fromNode, isValid, toHandle, toNode }) => {
      if (
        isValid !== false ||
        !fromHandle ||
        !fromNode ||
        !toHandle ||
        !toNode
      ) {
        return
      }

      explainRefusal(
        { nodeId: fromNode.id, type: fromHandle.type },
        { nodeId: toNode.id, type: toHandle.type }
      )
    },
    [explainRefusal]
  )

  // A click-to-connect never enters the engine's connection state, so the
  // first handle is held here and the second is read off the handle clicked.
  const clickFrom = useRef<LinkEnd | null>(null)

  const holdClickStart = useCallback<OnConnectStart>(
    (_, { handleType, nodeId }) => {
      clickFrom.current =
        nodeId && handleType ? { nodeId, type: handleType } : null
      lastLink.current = null
    },
    []
  )

  const explainClickRejection = useCallback<OnConnectEnd>(
    (event) => {
      const from = clickFrom.current
      const handle =
        event.target instanceof Element
          ? event.target.closest(".react-flow__handle")
          : null
      const nodeId = handle?.getAttribute("data-nodeid")
      const type: HandleType = handle?.classList.contains("target")
        ? "target"
        : "source"

      clickFrom.current = null

      // A second click on the first handle only cancels the pending link.
      if (!from || !nodeId || (from.nodeId === nodeId && from.type === type)) {
        return
      }

      const link =
        from.type === "source"
          ? `${from.nodeId}->${nodeId}`
          : `${nodeId}->${from.nodeId}`

      if (lastLink.current !== link) {
        explainRefusal(from, { nodeId, type })
      }
    },
    [explainRefusal]
  )

  // Cards, inspector and toast read one committed run. The tally sums to the
  // step count and names no step, since a title is user text of any length.
  const runAgentTest = useCallback(() => {
    const run = runTest(getNodes(), getEdges())
    const tally = `${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped, ${run.unconnected} unconnected.`

    commit(run.nodes, getEdges())

    if (run.failed === 0) {
      toast.success("Test passed", {
        description: tally,
        icon: TOAST_SUCCESS_ICON,
      })
    } else {
      toast.error("Test failed", {
        description: tally,
        icon: TOAST_ERROR_ICON,
      })
    }
  }, [commit, getEdges, getNodes])

  const clearRun = useCallback(() => {
    commit(clearResults(nodes), edges)
  }, [commit, edges, nodes])

  // The prompt settles before the engine removes anything, so the tree it
  // captures still holds every step the confirmed delete is about to take.
  const confirmDelete = useCallback<
    OnBeforeDelete<AgentNodeType, AgentEdgeType>
  >(
    async (elements) => {
      const allowed = await onBeforeDelete(elements)

      if (allowed) {
        graphBeforeDelete.current = { nodes, edges }
      }

      return allowed
    },
    [edges, nodes, onBeforeDelete]
  )

  // The engine queues its own changes first, so this clear lands on the tree
  // without the removed steps; Undo replays the graph the confirmation captured.
  const clearRunOnDelete = useCallback<OnDelete<AgentNodeType, AgentEdgeType>>(
    ({ nodes: removed }) => {
      setNodes(clearResults)
      setLayoutVersion((version) => version + 1)

      const previous = graphBeforeDelete.current

      if (removed.length === 0 || !previous) {
        return
      }

      toast.success(removed.length > 1 ? "Steps deleted" : "Step deleted", {
        description:
          removed.length > 1
            ? plural(removed.length, "step") + " left the tree."
            : removed[0].data.title,
        icon: TOAST_SUCCESS_ICON,
        action: {
          label: "Undo",
          onClick: () => commit(previous.nodes, previous.edges),
        },
        duration: 8000,
      })
    },
    [commit, setNodes]
  )

  // Seed positions are all at the origin, so the sample always comes back tidy.
  const restoreSample = useCallback(() => {
    setArranged(true)
    pendingFit.current = true
    commit(SEEDED, INITIAL_EDGES)
  }, [commit])

  const copyAsJson = useCallback(() => {
    const graph = JSON.stringify({ nodes, edges }, null, 2)
    const summary = `${plural(nodes.length, "step")} and ${plural(edges.length, "connection")}.`

    // A denied clipboard permission is the common case, so the toast waits
    // for the write rather than claiming a copy that never happened.
    void navigator.clipboard
      .writeText(graph)
      .then(() =>
        toast.success("Agent copied as JSON", {
          description: summary,
          icon: TOAST_SUCCESS_ICON,
        })
      )
      .catch(() =>
        toast.error("Clipboard blocked", {
          description: "Allow clipboard access, then copy again.",
          icon: TOAST_ERROR_ICON,
        })
      )
  }, [edges, nodes])

  return (
    <AgentActionsProvider
      nodes={nodes}
      edges={edges}
      commit={commit}
      hoveredEdge={hoveredEdge}
      setHoveredEdge={setHoveredEdge}
    >
      <div className="bg-background flex h-svh w-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          {/* The trail stops at the parent; the title is its own heading, so it keeps
              text-sm in every style, where some styles shrink the crumb list. */}
          <Breadcrumb className="max-sm:hidden">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem>
                {/* customize: point at your agent list route. */}
                <BreadcrumbLink href="#">{AGENT.section}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="min-w-0 truncate text-sm font-semibold">
            {AGENT.name}
          </h1>
          <Separator
            orientation="vertical"
            className="h-4 data-vertical:self-center max-md:hidden"
          />
          {/* Collapses with sr-only, so a phone still hears the counts and version. */}
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs max-md:sr-only">
            <span className="shrink-0 tabular-nums">{counts}</span>
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
            />
            <span className="flex shrink-0 items-center gap-1.5">
              {/* The avatar and version say who and which; the sentence is read aloud. */}
              <span className="sr-only">
                {AGENT.revision} by {AGENT.owner.name}
              </span>
              <Avatar aria-hidden="true" className="size-4">
                <AvatarImage src={AGENT.owner.avatar} alt="" />
                <AvatarFallback className="text-[8px]">
                  {AGENT.owner.initials}
                </AvatarFallback>
              </Avatar>
              <span aria-hidden="true">{AGENT.revision}</span>
            </span>
          </p>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <FlowKeys />
            <ModelSelect />
            <AddStepButton />
            <Button variant="outline" onClick={runAgentTest}>
              <PlayIcon aria-hidden="true" />
              Run test
            </Button>
            <AgentMenu
              onClearRun={clearRun}
              onRestoreSample={restoreSample}
              onCopyJson={copyAsJson}
            />
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <FlowCanvas<AgentNodeType, AgentEdgeType>
            className={EDGE_STROKE}
            showMiniMap={false}
            fitViewOptions={INITIAL_FIT}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={explainRejection}
            onClickConnectStart={holdClickStart}
            onClickConnectEnd={explainClickRejection}
            onBeforeDelete={confirmDelete}
            onDelete={clearRunOnDelete}
            onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            onNodeDragStop={markMoved}
            onSelectionDragStop={markMoved}
            onKeyDownCapture={markKeyMove}
            onMoveEnd={snapViewport}
            isValidConnection={isValidConnection}
            connectionRadius={24}
            nodesConnectable={editable}
            nodesDraggable={editable}
          >
            {/* The engine ships its own panel margin unlayered, so this has to win. */}
            <Panel position="bottom-left" className="m-6!">
              <CanvasToolbar
                tool={tool}
                onToolChange={setTool}
                onTidy={tidy}
                onRunTest={runAgentTest}
              />
            </Panel>
          </FlowCanvas>
          <NodeInspectorPanel />
          {dialog}
        </div>
      </div>
    </AgentActionsProvider>
  )
}