import { Badge } from "@/components/reui/badge"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react"

import { Button } from "@/components/ui/button"
import type { AgentEdgeType } from "./data"
import { useAgentActions } from "./node-actions"
import { PlusIcon } from "lucide-react"

export function TreeEdge({
  data,
  id,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<AgentEdgeType>) {
  const actions = useAgentActions()
  // Strokes scale with the viewport, so dividing by zoom holds every line at 1px.
  const zoom = useStore((state) => state.transform[2])
  // A 1px line centred on a whole pixel smears across two, so every point lands on
  // a half pixel at this zoom; the viewport itself snaps to whole pixels.
  const crisp = (value: number) => (Math.round(value * zoom - 0.5) + 0.5) / zoom
  const source = { x: crisp(sourceX), y: crisp(sourceY) }
  const target = { x: crisp(targetX), y: crisp(targetY) }
  const centerY = crisp((source.y + target.y) / 2)
  const [path] = getSmoothStepPath({
    borderRadius: 12,
    centerX: crisp((source.x + target.x) / 2),
    centerY,
    sourcePosition,
    sourceX: source.x,
    sourceY: source.y,
    targetPosition,
    targetX: target.x,
    targetY: target.y,
  })
  const label = data?.branchLabel
  // Both sit on the connector midpoint, so the caption yields while the
  // pointer is on this edge and comes back the moment it leaves.
  const revealed = actions.hoveredEdge === id

  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeWidth: 1 / zoom }} />
      <EdgeLabelRenderer>
        {/* The label layer takes no pointer events, so the button restores them.
            nodrag and nopan keep the press off the canvas gestures. */}
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center justify-center"
          style={{
            transform: `translate(-50%, -50%) translate(${target.x}px, ${centerY}px)`,
          }}
        >
          {label ? (
            <Badge
              variant="outline"
              data-revealed={revealed || undefined}
              // The caption sits on the connector, so it wears the line's own colour.
              className="bg-background border-(--xy-edge-stroke) transition-opacity data-revealed:opacity-0 motion-reduce:transition-none"
            >
              {label}
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="icon-xs"
            data-revealed={revealed || undefined}
            className="bg-background absolute rounded-full border-(--xy-edge-stroke) opacity-0 transition-opacity focus-visible:opacity-100 data-revealed:opacity-100 motion-reduce:transition-none"
            aria-label={
              label ? `Add a step on the ${label} path` : "Add a step here"
            }
            onClick={() => actions.insertOn(id)}
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}