/**
 * @fileoverview What the model believes the prompt means: entities, their
 * attributes and how they relate. Anything drawn DASHED is an assumption — the
 * model inferred it, the user never said it. Those are exactly the details an
 * image model would hallucinate, so they are what to confirm or correct.
 *
 * Graph: `@reui/flow-2`'s `FlowCanvas` (React Flow mapped onto the theme tokens)
 * and `layoutTree` (dagre), the same reuse `EvolutionFlow` makes. Only the node
 * body is ours. Editing: each attribute's candidates in the shared `OptionSelect`
 * wrapper; a change is staged as a graph update until the next refinement.
 */

import { useEffect, useMemo, useState } from "react";
import { Handle, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { NetworkIcon, UndoIcon } from "lucide-react";

import { FlowCanvas } from "@/components/blocks/flow-2/components/flow-canvas";
import { layoutTree } from "@/components/blocks/flow-2/components/flow-layout";
import { OptionSelect } from "@/components/blocks/solution-files-1/components/option-select";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BeliefGraph, GraphUpdate } from "./types";

const NODE_W = 200;
const NODE_H = 72;

type EntityData = { name: string; inferred: boolean; attrCount: number; selected: boolean };
type EntityNode = Node<EntityData, "entity">;

function EntityNodeBody({ data }: NodeProps<EntityNode>) {
  return (
    <div
      className={cn(
        "bg-card flex flex-col justify-center gap-1 rounded-lg border px-3 py-2",
        data.inferred && "border-dashed",
        data.selected && "border-primary ring-primary/20 ring-[3px]",
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className="!opacity-0" />
      <span className="truncate text-sm font-medium">{data.name}</span>
      <span className="text-muted-foreground text-[11px]">
        {data.inferred ? "Assumed by the model" : "In your prompt"} · {data.attrCount} attributes
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!opacity-0" />
    </div>
  );
}

const NODE_TYPES = { entity: EntityNodeBody };

/** Key for a staged attribute edit. */
export const attrKey = (entity: string, attribute: string) => `${entity}\u0000${attribute}`;
/** Key for a staged relationship edit. */
export const relKey = (source: string, target: string) => `${source}\u0000${target}`;

export interface StagedEdits {
  attributes: Record<string, string>;
  relationships: Record<string, string>;
}

/** Turn staged edits into the API's GraphUpdate list. */
export function toGraphUpdates(graph: BeliefGraph | null, staged: StagedEdits): GraphUpdate[] {
  const out: GraphUpdate[] = [];
  for (const [k, value] of Object.entries(staged.attributes)) {
    const [entity, attribute] = k.split("\u0000");
    out.push({ type: "attribute", entity, attribute, value });
  }
  for (const [k, newLabel] of Object.entries(staged.relationships)) {
    const [source, target] = k.split("\u0000");
    const rel = graph?.relationships.find((r) => r.source === source && r.target === target);
    if (rel) out.push({ type: "relationship", source, target, oldLabel: rel.label, newLabel });
  }
  return out;
}

export interface BeliefGraphViewProps {
  graph: BeliefGraph | null;
  loading: boolean;
  staged: StagedEdits;
  onStage: (next: StagedEdits) => void;
}

export function BeliefGraphView({ graph, loading, staged, onStage }: BeliefGraphViewProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [focus, setFocus] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [] as EntityNode[], edges: [] as Edge[] };
    const names = new Set(graph.entities.map((e) => e.name));
    const flowNodes: EntityNode[] = graph.entities.map((e) => ({
      id: e.name,
      type: "entity",
      position: { x: 0, y: 0 },
      initialWidth: NODE_W,
      initialHeight: NODE_H,
      data: { name: e.name, inferred: !e.presence_in_prompt, attrCount: e.attributes.length, selected: focus === e.name },
    }));
    const flowEdges: Edge[] = graph.relationships
      .filter((r) => names.has(r.source) && names.has(r.target) && r.source !== r.target)
      .map((r) => ({
        id: relKey(r.source, r.target),
        source: r.source,
        target: r.target,
        label: staged.relationships[relKey(r.source, r.target)] ?? r.label,
        type: "smoothstep",
        style: r.presence_in_prompt ? undefined : { strokeDasharray: "4 3" },
      }));
    return { nodes: layoutTree(flowNodes, flowEdges), edges: flowEdges };
  }, [graph, focus, staged.relationships]);

  if (loading && !graph) return <Skeleton className="h-[28rem]" />;
  if (!graph || graph.entities.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <NetworkIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No belief graph yet</EmptyTitle>
          <EmptyDescription>Analyze the prompt to see what the model thinks is in the image — and what it is assuming.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const entities = focus ? graph.entities.filter((e) => e.name === focus) : graph.entities;
  const editCount = Object.keys(staged.attributes).length + Object.keys(staged.relationships).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card flex h-[24rem] flex-col overflow-hidden rounded-lg border">
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-xs">
          <NetworkIcon className="size-3.5" aria-hidden="true" />
          {graph.entities.length} entities, {graph.relationships.length} relationships. Dashed = assumed, not stated. Click an entity to
          edit it.
        </div>
        {mounted ? (
          <FlowCanvas<EntityNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            showMiniMap={nodes.length > 10}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, n) => setFocus((f) => (f === n.id ? null : n.id))}
            onPaneClick={() => setFocus(null)}
          />
        ) : (
          <Skeleton className="m-4 min-h-0 flex-1" />
        )}
      </div>

      <Frame stacked dense spacing="sm">
        <FrameHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <FrameTitle>{focus ?? "All attributes"}</FrameTitle>
            <FrameDescription>
              The first value is what the model currently believes. Change one to correct it; {editCount} edit{editCount === 1 ? "" : "s"} staged.
            </FrameDescription>
          </div>
          <div className="flex gap-2">
            {focus ? (
              <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
                Show all
              </Button>
            ) : null}
            {editCount > 0 ? (
              <Button size="sm" variant="outline" onClick={() => onStage({ attributes: {}, relationships: {} })}>
                <UndoIcon className="size-4" aria-hidden="true" />
                Clear edits
              </Button>
            ) : null}
          </div>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-5">
          {entities.map((e) => (
            <section key={e.name} aria-label={e.name} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{e.name}</span>
                <Badge variant={e.presence_in_prompt ? "secondary" : "warning-light"} size="sm">
                  {e.presence_in_prompt ? "stated" : "assumed"}
                </Badge>
                {e.description ? <span className="text-muted-foreground text-xs">{e.description}</span> : null}
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {e.attributes.map((a) => {
                  const key = attrKey(e.name, a.name);
                  const isExistence = a.name.toLowerCase().startsWith("existence");
                  const choices = isExistence ? ["true", "false"] : [...new Set(a.value)];
                  const original = isExistence ? (a.value[0] === "false" ? "false" : "true") : a.value[0];
                  const current = staged.attributes[key] ?? original;
                  return (
                    <div key={a.name} className="flex min-w-0 items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", a.presence_in_prompt ? "text-foreground" : "text-muted-foreground")}>
                        {isExistence ? "in the image" : a.name.replace(/_/g, " ")}
                        {staged.attributes[key] !== undefined ? " •" : ""}
                      </span>
                      <OptionSelect
                        value={current}
                        options={choices.map((v) => ({ value: v, label: isExistence ? (v === "true" ? "Yes" : "Remove it") : v }))}
                        ariaLabel={`${e.name} ${a.name}`}
                        className="w-44"
                        onChange={(v) => {
                          const next = { ...staged.attributes };
                          if (v === original) delete next[key];
                          else next[key] = v;
                          onStage({ ...staged, attributes: next });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!focus && graph.relationships.some((r) => r.alternatives?.length) ? (
            <section aria-label="Relationships" className="flex flex-col gap-2">
              <span className="text-sm font-medium">Relationships</span>
              {graph.relationships
                .filter((r) => r.alternatives?.length)
                .map((r) => {
                  const key = relKey(r.source, r.target);
                  return (
                    <div key={key} className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                      <span className="truncate">{r.source}</span>
                      <OptionSelect
                        value={staged.relationships[key] ?? r.label}
                        options={[...new Set([r.label, ...(r.alternatives ?? [])])].map((v) => ({ value: v, label: v }))}
                        ariaLabel={`${r.source} to ${r.target}`}
                        className="w-40"
                        onChange={(v) => {
                          const next = { ...staged.relationships };
                          if (v === r.label) delete next[key];
                          else next[key] = v;
                          onStage({ ...staged, relationships: next });
                        }}
                      />
                      <span className="truncate">{r.target}</span>
                    </div>
                  );
                })}
            </section>
          ) : null}
        </FramePanel>
      </Frame>
    </div>
  );
}
