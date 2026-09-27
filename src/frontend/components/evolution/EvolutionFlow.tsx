/**
 * @fileoverview The branching half of the image evolution view: a revision tree
 * drawn on a canvas, so sibling branches are visibly siblings.
 *
 * Built on `@reui/flow-2`'s canvas rather than a second one — `FlowCanvas` already
 * maps React Flow's `--xy-*` variables onto the shadcn tokens (so it follows dark
 * mode), and `layoutTree` already lays a tree out with dagre at a uniform pitch.
 * Only the node body is ours, because flow-2's node is an agent step and ours is
 * a picture.
 *
 * Browser-only by construction: React Flow measures nodes and reads the
 * viewport, so the canvas mounts after hydration and renders nothing during SSR.
 * That keeps this component safe to use from a `client:load` island.
 */

import { useEffect, useMemo, useState } from "react";
import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { GitBranchIcon, ImageOffIcon } from "lucide-react";

import { FlowCanvas } from "@/components/blocks/flow-2/components/flow-canvas";
import { layoutTree } from "@/components/blocks/flow-2/components/flow-layout";
import { Badge } from "@/components/reui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { thumbOf } from "@/components/assets/types";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EvolutionNode } from "./fork-tree";

/**
 * Fixed node box. dagre is seeded with these before React Flow measures
 * anything, and the card is held to them, so the graph never reflows into a
 * different shape after hydration.
 */
const NODE_W = 184;
const NODE_H = 188;

/** A type alias, not an interface: React Flow needs the implicit index signature. */
type RevNodeData = { node: EvolutionNode };
type RevNode = Node<RevNodeData, "revision">;

/** One revision: its newest output, its label, and how many attempts it took. */
function RevisionNode({ data }: NodeProps<RevNode>) {
  const { node } = data;
  // Newest attempt is what the branch currently looks like; the rest are retries.
  const latest = node.attempts.at(-1);
  const href = node.sessionUuid ? `/sessions/${node.sessionUuid}` : undefined;

  return (
    <div
      className={cn(
        "bg-card flex flex-col overflow-hidden rounded-lg border",
        node.inferred && "border-dashed opacity-70",
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!opacity-0" />
      {latest ? (
        <a
          href={href}
          // nodrag keeps the press off the canvas gesture.
          className="nodrag block shrink-0"
          aria-label={`${node.label} — open its session`}
        >
          <img
            src={thumbOf(latest.deliveryUrl)}
            alt={node.label}
            loading="lazy"
            className="h-[124px] w-full object-cover"
          />
        </a>
      ) : (
        <div className="bg-muted/40 text-muted-foreground flex h-[124px] shrink-0 items-center justify-center">
          <ImageOffIcon className="size-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 space-y-1 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground truncate font-mono text-xs font-medium">
            {node.label}
          </span>
          {node.attempts.length > 1 ? (
            <Badge variant="secondary" size="xs" className="shrink-0 tabular-nums">
              {node.attempts.length} tries
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground truncate text-[11px]">
          {node.inferred
            ? "Not in this group"
            : latest
              ? relativeTime(latest.createdAt)
              : ""}
        </p>
      </div>
    </div>
  );
}

const NODE_TYPES = { revision: RevisionNode };

/** Depth-first walk, so a parent is always emitted before its children. */
function walk(
  roots: EvolutionNode[],
  visit: (node: EvolutionNode, parent: EvolutionNode | null) => void,
) {
  const stack: [EvolutionNode, EvolutionNode | null][] = [...roots]
    .reverse()
    .map((r) => [r, null]);
  for (let top = stack.pop(); top; top = stack.pop()) {
    visit(top[0], top[1]);
    for (const child of [...top[0].children].reverse()) stack.push([child, top[0]]);
  }
}

export interface EvolutionFlowProps {
  roots: EvolutionNode[];
  className?: string;
}

/**
 * Draw a forked revision history.
 *
 * @param roots Roots from `buildEvolutionForest` — one per session.
 * @example <EvolutionFlow roots={forest.roots} />
 */
export function EvolutionFlow({ roots, className }: EvolutionFlowProps) {
  // React Flow is browser-only; nothing of it renders on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { nodes, edges } = useMemo(() => {
    const flowNodes: RevNode[] = [];
    const flowEdges: Edge[] = [];
    walk(roots, (node, parent) => {
      flowNodes.push({
        id: node.key,
        type: "revision",
        position: { x: 0, y: 0 },
        // Seeds dagre before measurement, and overrides flow-2's own leaf
        // padding — our leaves are the same size as every other node.
        initialWidth: NODE_W,
        initialHeight: NODE_H,
        data: { node },
      });
      if (parent) {
        flowEdges.push({
          id: `${parent.key}->${node.key}`,
          source: parent.key,
          target: node.key,
          type: "smoothstep",
        });
      }
    });
    return { nodes: layoutTree(flowNodes, flowEdges), edges: flowEdges };
  }, [roots]);

  return (
    // A fixed height, because the canvas fills its parent and a tree's own height
    // is unbounded. twMerge lets a caller's own h-* win.
    <div
      className={cn(
        "bg-card flex h-[30rem] flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="text-muted-foreground flex items-center gap-2 border-b px-4 py-2.5 text-xs">
        <GitBranchIcon className="size-3.5" aria-hidden="true" />
        This history branches — {nodes.length} revisions, drawn as a tree. Drag to pan,
        scroll to zoom.
      </div>
      {mounted ? (
        <FlowCanvas<RevNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          showMiniMap={nodes.length > 8}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
        />
      ) : (
        <Skeleton className="m-4 min-h-0 flex-1" />
      )}
    </div>
  );
}
