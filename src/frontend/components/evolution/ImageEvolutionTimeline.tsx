/**
 * @fileoverview W4.1 — how one image became others.
 *
 * Reusable: give it the flat iteration rows for any grouping (a whole asset, one
 * folder of it, one session) and it draws that history. It picks its own shape
 * from the data, because the data has two shapes:
 *
 * - a straight run of edits → `@reui/timeline-1`'s Timeline, which reads as a story
 * - a history that BRANCHES → `@reui/flow-2`'s canvas ({@link EvolutionFlow}),
 *   because siblings have to look like siblings
 *
 * The switch is `forked` from {@link buildEvolutionForest}, never a prop: a caller
 * cannot accidentally ask for a branching history to be drawn as a line.
 */

import type { ReactNode } from "react";
import { useMemo } from "react";
import { CheckIcon, CircleDashedIcon, HistoryIcon, LayersIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { thumbOf, type AssetIteration } from "@/components/assets/types";
import { relativeTime, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EvolutionFlow } from "./EvolutionFlow";
import { buildEvolutionForest, chainOf, type EvolutionNode } from "./fork-tree";

/** The attempts at one revision, newest last, each linking to its session. */
function Attempts({ node }: { node: EvolutionNode }) {
  if (node.attempts.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No image from this step is in this group — it landed in another folder, or was
        never kept.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2">
        {node.attempts.map((attempt, index) => (
          <li key={attempt.libraryImageId}>
            <a
              href={node.sessionUuid ? `/sessions/${node.sessionUuid}` : undefined}
              title={`${node.label}${node.attempts.length > 1 ? ` · attempt ${index + 1}` : ""} — ${shortDate(attempt.createdAt)}`}
              className="border-border hover:border-primary block overflow-hidden rounded-md border transition-colors"
            >
              <img
                src={thumbOf(attempt.deliveryUrl)}
                alt={`${node.label}, attempt ${index + 1}`}
                loading="lazy"
                className="size-20 object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {relativeTime(node.attempts.at(-1)!.createdAt)}
        {node.attempts.length > 1
          ? ` · ${node.attempts.length} attempts at the same edit`
          : ""}
      </p>
    </div>
  );
}

export interface ImageEvolutionTimelineProps {
  /** Flat rows from `GET /api/assets/:id/iterations`, any order. */
  iterations: AssetIteration[];
  /** Heading above the history. Omit for a bare timeline. */
  title?: string;
  description?: string;
  /** Rendered at the end of the heading row — a folder link, a count, an action. */
  action?: ReactNode;
  /** Empty-state copy. A freshly promoted asset has no iterations, and that is normal. */
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

/**
 * Draw the evolution of one image.
 *
 * @param iterations Rows for the grouping being shown.
 * @returns A linear timeline, a branching canvas, or an honest empty state.
 *
 * @example
 * <ImageEvolutionTimeline
 *   iterations={rowsForThisFolder}
 *   title="Kitchen ideas"
 *   emptyDescription="Start a session from this asset to fill this in."
 * />
 */
export function ImageEvolutionTimeline({
  iterations,
  title,
  description,
  action,
  emptyTitle = "No iterations yet",
  emptyDescription = "Nothing has been generated or edited from this image yet. Start a session from it and every edit shows up here, including the ones you throw away.",
  className,
}: ImageEvolutionTimelineProps) {
  const forest = useMemo(() => buildEvolutionForest(iterations), [iterations]);
  const chain = useMemo(() => (forest.forked ? [] : chainOf(forest)), [forest]);

  const heading =
    title || description || action ? (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {title ? (
            <h3 className="text-foreground truncate text-sm font-semibold">{title}</h3>
          ) : null}
          {description ? (
            <p className="text-muted-foreground text-xs">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {forest.attemptCount > 0 ? (
            <Badge variant="secondary" className="gap-1 text-[11px] tabular-nums">
              <LayersIcon className="size-3" aria-hidden="true" />
              {forest.attemptCount} image{forest.attemptCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {action}
        </div>
      </div>
    ) : null;

  if (forest.attemptCount === 0) {
    return (
      <section className={className}>
        {heading}
        <Empty className="bg-card border-border rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HistoryIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    );
  }

  if (forest.forked) {
    return (
      <section className={className}>
        {heading}
        <EvolutionFlow roots={forest.roots} />
      </section>
    );
  }

  return (
    <section className={className}>
      {heading}
      {/* Every step has happened, so every step reads as completed. */}
      <Timeline defaultValue={chain.length}>
        {chain.map((node, index) => (
          <TimelineItem key={node.key} step={index + 1} className="ms-10 pb-8">
            <TimelineHeader>
              <TimelineSeparator className="bg-border group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.5rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
              <div className="flex flex-wrap items-center gap-2">
                <TimelineTitle
                  className={cn(
                    "font-mono text-sm font-semibold",
                    node.inferred && "text-muted-foreground",
                  )}
                >
                  {node.label}
                </TimelineTitle>
                {node.segments.length === 0 ? (
                  <Badge variant="outline" className="text-[11px]">
                    source
                  </Badge>
                ) : null}
              </div>
              <TimelineIndicator className="bg-muted text-muted-foreground group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none group-data-[orientation=vertical]/timeline:-left-7">
                {node.inferred ? (
                  <CircleDashedIcon className="size-3.5" />
                ) : (
                  <CheckIcon className="size-3.5" />
                )}
              </TimelineIndicator>
            </TimelineHeader>
            <TimelineContent className="mt-2">
              <Frame stacked dense spacing="sm">
                <FramePanel>
                  <Attempts node={node} />
                </FramePanel>
              </Frame>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    </section>
  );
}
