import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowProps,
} from "@xyflow/react"

import "@xyflow/react/dist/style.css"

import { cn } from "@/lib/utils"

// React Flow paints from its own --xy-* variables; mapping them onto the
// shadcn tokens makes the canvas follow the active style and dark mode.
const FLOW_THEME = [
  "[--xy-background-color:transparent]",
  "[--xy-background-pattern-color:var(--border)]",
  "[--xy-edge-stroke:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)]",
  "[--xy-edge-stroke-selected:var(--primary)]",
  "[--xy-edge-stroke-width:1]",
  "[--xy-edge-label-background-color:var(--card)]",
  "[--xy-edge-label-color:var(--muted-foreground)]",
  "[--xy-connectionline-stroke:var(--primary)]",
  "[--xy-connectionline-stroke-width:1]",
  "[--xy-handle-background-color:var(--primary)]",
  "[--xy-handle-border-color:var(--card)]",
  "[--xy-controls-button-background-color:var(--card)]",
  "[--xy-controls-button-background-color-hover:var(--muted)]",
  "[--xy-controls-button-border-color:var(--border)]",
  "[--xy-controls-button-color:var(--foreground)]",
  "[--xy-controls-button-color-hover:var(--foreground)]",
  "[--xy-controls-box-shadow:none]",
  "[--xy-minimap-background-color:var(--card)]",
  "[--xy-minimap-mask-background-color:color-mix(in_oklab,var(--muted)_70%,transparent)]",
  "[--xy-minimap-node-background-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)]",
  "[--xy-selection-background-color:color-mix(in_oklab,var(--primary)_8%,transparent)]",
  "[--xy-selection-border:1px_dashed_var(--primary)]",
  "[--xy-attribution-background-color:transparent]",
].join(" ")

/**
 * padding is a share of the viewport per side, so 0.1 leaves a real margin
 * without shrinking the graph; maxZoom 1 keeps Fit from magnifying it.
 */
export const FIT_VIEW_OPTIONS = { padding: 0.1, maxZoom: 1 }

type FlowCanvasProps<N extends Node, E extends Edge> = ReactFlowProps<N, E> & {
  className?: string
  /** A graph small enough to read whole does not need an overview. */
  showMiniMap?: boolean
}

export function FlowCanvas<N extends Node, E extends Edge>({
  className,
  children,
  showMiniMap = true,
  ...props
}: FlowCanvasProps<N, E>) {
  return (
    <div
      className={cn(
        "bg-muted/30 relative min-h-0 flex-1",
        FLOW_THEME,
        className
      )}
    >
      <ReactFlow<N, E>
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        attributionPosition="bottom-center"
        minZoom={0.25}
        zoomOnDoubleClick={false}
        maxZoom={2}
        {...props}
      >
        {/* A whole-pixel radius on a 24px pitch, so the field stays crisp at
            every zoom instead of antialiasing into a haze. */}
        <Background variant={BackgroundVariant.Dots} gap={24} size={2} />
        {showMiniMap ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="max-md:hidden"
          />
        ) : null}
        {children}
      </ReactFlow>
    </div>
  )
}