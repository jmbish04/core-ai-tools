import { Fragment, useState } from "react"
import { IconTile } from "@/components/reui/icon-tile"
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item"
import {
  APP_ICON,
  ROOT_ID,
  STATUS_ICON,
  STATUS_LABEL,
  STATUS_TONE,
  type AgentNodeType,
} from "./data"
import { NODE_WIDTH } from "./flow-layout"
import { useAgentActions } from "./node-actions"
import { EllipsisVerticalIcon, EyeIcon, PencilIcon, GitBranchIcon, Trash2Icon, PlusIcon } from "lucide-react"

/**
 * The leaf's connector, drawn in DOM, so it holds 1px on screen and sits on the
 * same half pixel the edges snap to. Only leaves subscribe to the zoom.
 */
function LeafStub({ x }: { x: number }) {
  const zoom = useStore((state) => state.transform[2])
  const centre = x + NODE_WIDTH / 2
  const crisp = (Math.round(centre * zoom - 0.5) + 0.5) / zoom

  return (
    <span
      aria-hidden="true"
      className="relative h-5 bg-(--xy-edge-stroke)"
      style={{ left: crisp - centre, width: 1 / zoom }}
    />
  )
}

export function TreeNode({
  data,
  id,
  isConnectable,
  positionAbsoluteX,
  selected,
}: NodeProps<AgentNodeType>) {
  const actions = useAgentActions()
  // The engine owns the press inside a node, so the menu is opened explicitly
  // rather than through the trigger's own press detection.
  const [menuOpen, setMenuOpen] = useState(false)
  const isRoot = id === ROOT_ID
  const isLeaf = actions.leafIds.has(id)

  return (
    // This wrapper is the measured box, so the trailing plus is inside the
    // layout and inside a fitted view rather than clipped below it.
    <div className="flex w-64 flex-col items-center">
      <div className="relative w-full">
        <Item
          variant="outline"
          size="xs"
          data-selected={selected || undefined}
          onDoubleClick={() => actions.inspect(id, "edit")}
          // The strip's negative margins must track this p-2 exactly.
          className="bg-card data-selected:border-primary data-selected:ring-primary/20 group-focus-visible/node:border-ring w-full gap-2 overflow-hidden p-2 data-selected:ring-[3px]"
        >
          <IconTile size="sm" variant="outline">
            {APP_ICON[data.app]}
          </IconTile>
          {/* gap-0 pins a row gap five of the styles otherwise widen. */}
          <ItemContent className="min-w-0 gap-0">
            {/* One size for both lines: weight and colour carry the hierarchy,
              so the card reads as a single block rather than two tiers. */}
            <ItemTitle className="w-full text-[13px] leading-4 font-semibold">
              {/* ItemTitle is a flex row, which defeats line-clamp. */}
              <span className="truncate">{data.title}</span>
            </ItemTitle>
            <ItemDescription className="line-clamp-1 text-[13px] leading-4">
              {data.detail}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              {/* nodrag on the button alone, so the rest of the card still drags. */}
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="nodrag text-muted-foreground hover:text-foreground -me-1"
                    aria-label={`Actions for ${data.title}`}
                    onClick={() => setMenuOpen(true)}
                  />
                }
              >
                <EllipsisVerticalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              {/* The popup sizes to its anchor, so a 24px trigger needs a width. */}
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => actions.inspect(id, "view")}>
                  <EyeIcon aria-hidden="true" />
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.inspect(id, "edit")}>
                  <PencilIcon aria-hidden="true" />
                  Edit step
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.branch(id)}>
                  <GitBranchIcon aria-hidden="true" />
                  Add branch
                </DropdownMenuItem>
                {/* The trigger opens the run, so it is the one node you cannot drop. */}
                {isRoot ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => actions.remove(id)}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
          {/* grow spends the slack the negative margins freed, so the band
            reaches both borders instead of merely centring itself. */}
          <ItemFooter className="bg-muted/50 -mx-2 -mb-2 grow justify-start gap-1.5 border-t px-2 py-1.5">
            <span
              className={cn(
                "shrink-0 [&_svg]:size-3.5",
                STATUS_TONE[data.status]
              )}
            >
              {STATUS_ICON[data.status]}
            </span>
            <span className="sr-only">{STATUS_LABEL[data.status]}</span>
            {data.facts.map((fact, index) => (
              <Fragment key={fact}>
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                  />
                ) : null}
                <span className="text-muted-foreground truncate text-xs tabular-nums">
                  {fact}
                </span>
              </Fragment>
            ))}
          </ItemFooter>
        </Item>
        {/* Written after the card and anchored to its box, so both paint above it
            and a leaf still takes a child from its bottom edge. */}
        {/* A Handle defaults to connectable, so Pan's canvas flag reaches it only here. */}
        {isRoot ? null : (
          <Handle
            type="target"
            position={Position.Top}
            isConnectable={isConnectable}
          />
        )}
        <Handle
          type="source"
          position={Position.Bottom}
          isConnectable={isConnectable}
        />
      </div>
      {/* A leaf ends in a stub and the trailing plus, which extends the path. */}
      {isLeaf ? (
        <>
          <LeafStub x={positionAbsoluteX} />
          <Button
            variant="outline"
            size="icon-xs"
            className="nodrag nopan bg-background rounded-full border-(--xy-edge-stroke)"
            aria-label={`Add a step after ${data.title}`}
            onClick={() => actions.appendAfter(id)}
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        </>
      ) : null}
    </div>
  )
}