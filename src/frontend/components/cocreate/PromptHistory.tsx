/**
 * @fileoverview The full prompt revision log. Composition from `@reui/timeline-1`
 * (a `Timeline` whose items are collapsible `Frame`s): one item per version,
 * newest first, each showing what made it — the answers it absorbed, the graph
 * edits, the consultant — and opening to a diff against the version it came from.
 * Above it, compare any two versions.
 */

import { useMemo, useState } from "react";
import { ChevronRightIcon, GitCompareIcon, ImageIcon, RotateCcwIcon, SparklesIcon } from "lucide-react";

import { OptionSelect } from "@/components/blocks/solution-files-1/components/option-select";
import { Badge, type BadgeProps } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { relativeTime } from "@/lib/format";
import { PromptDiff } from "./PromptDiff";
import { SOURCE_LABEL, type Answer, type Generation, type PromptVersion } from "./types";

const SOURCE_VARIANT: Record<PromptVersion["source"], BadgeProps["variant"]> = {
  initial: "secondary",
  manual: "outline",
  refine: "primary-light",
  consultant: "info-light",
  restore: "warning-light",
};

export interface PromptHistoryProps {
  versions: PromptVersion[];
  answers: Answer[];
  generations: Generation[];
  currentVersionId: string | null;
  onRestore: (v: PromptVersion) => void;
  onGenerate: (v: PromptVersion) => void;
  busy: boolean;
}

export function PromptHistory({ versions, answers, generations, currentVersionId, onRestore, onGenerate, busy }: PromptHistoryProps) {
  const byId = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  const newest = [...versions].reverse();
  const options = newest.map((v) => ({ value: v.id, label: `v${v.version} · ${SOURCE_LABEL[v.source]}` }));
  const [from, setFrom] = useState(versions[0]?.id ?? "");
  const [to, setTo] = useState(currentVersionId ?? versions.at(-1)?.id ?? "");
  const a = byId.get(from);
  const b = byId.get(to);

  return (
    <div className="flex flex-col gap-6">
      {versions.length > 1 ? (
        <Frame stacked dense spacing="sm">
          <FrameHeader className="flex flex-row flex-wrap items-center gap-2">
            <GitCompareIcon className="text-muted-foreground size-4" aria-hidden="true" />
            <FrameTitle>Compare</FrameTitle>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <OptionSelect value={from} options={options} onChange={setFrom} ariaLabel="Compare from version" className="w-44" />
              <span className="text-muted-foreground text-xs">→</span>
              <OptionSelect value={to} options={options} onChange={setTo} ariaLabel="Compare to version" className="w-44" />
            </div>
          </FrameHeader>
          <FramePanel className="p-0">
            {a && b ? <PromptDiff before={a.promptText} after={b.promptText} title={`v${a.version} → v${b.version}`} variant="ghost" /> : null}
          </FramePanel>
        </Frame>
      ) : null}

      <Timeline defaultValue={versions.at(-1)?.version ?? 1}>
        {newest.map((v) => {
          const parent = v.parentVersionId ? byId.get(v.parentVersionId) : undefined;
          const absorbed = answers.filter((x) => x.appliedInVersionId === v.id);
          const images = generations.filter((g) => g.promptVersionId === v.id && g.deliveryUrl).length;
          const isCurrent = v.id === currentVersionId;
          return (
            <TimelineItem key={v.id} step={v.version} className="ms-10 pb-8">
              <TimelineHeader>
                <TimelineSeparator className="bg-border group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.5rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
                <div className="flex flex-wrap items-center gap-2">
                  <TimelineTitle className="text-sm font-semibold">v{v.version}</TimelineTitle>
                  <Badge variant={SOURCE_VARIANT[v.source]}>{SOURCE_LABEL[v.source]}</Badge>
                  {isCurrent ? <Badge variant="success-light">current</Badge> : null}
                  <span className="text-muted-foreground text-xs">{relativeTime(v.createdAt)}</span>
                </div>
                <TimelineIndicator className="bg-muted text-muted-foreground group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none text-[10px] font-semibold group-data-[orientation=vertical]/timeline:-left-7">
                  {v.version}
                </TimelineIndicator>
              </TimelineHeader>
              <TimelineContent className="mt-2">
                <Frame stacked dense spacing="sm">
                  <Collapsible defaultOpen={isCurrent && Boolean(parent)} className="group/collapsible">
                    <CollapsibleTrigger type="button" className="flex w-full text-start" aria-label={`Toggle v${v.version} details`}>
                      <FrameHeader className="flex grow flex-row items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="line-clamp-2 text-sm">{v.promptText}</p>
                          <FrameDescription className="flex flex-wrap gap-x-3 gap-y-1">
                            {parent ? <span>from v{parent.version}</span> : <span>starting point</span>}
                            {absorbed.length ? <span>{absorbed.length} answers applied</span> : null}
                            {v.graphUpdates?.length ? <span>{v.graphUpdates.length} graph edits</span> : null}
                            {images ? (
                              <span className="inline-flex items-center gap-1">
                                <ImageIcon className="size-3" aria-hidden="true" />
                                {images} images
                              </span>
                            ) : null}
                          </FrameDescription>
                        </div>
                        <ChevronRightIcon
                          className="text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90"
                          aria-hidden="true"
                        />
                      </FrameHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <FramePanel className="flex flex-col gap-3">
                        {parent ? (
                          <PromptDiff before={parent.promptText} after={v.promptText} title={`v${parent.version} → v${v.version}`} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{v.promptText}</p>
                        )}
                        {absorbed.length ? (
                          <ul className="flex flex-col gap-1" aria-label="Answers this version applied">
                            {absorbed.map((x) => (
                              <li key={x.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="text-muted-foreground">{x.question}</span>
                                <Badge variant="primary-light" size="sm">
                                  {x.answer}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {v.note ? <p className="text-muted-foreground text-xs">{v.note}</p> : null}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => onGenerate(v)} disabled={busy}>
                            <SparklesIcon className="size-4" aria-hidden="true" />
                            Generate from v{v.version}
                          </Button>
                          {!isCurrent ? (
                            <Button size="sm" variant="ghost" onClick={() => onRestore(v)} disabled={busy}>
                              <RotateCcwIcon className="size-4" aria-hidden="true" />
                              Restore as new version
                            </Button>
                          ) : null}
                        </div>
                      </FramePanel>
                    </CollapsibleContent>
                  </Collapsible>
                </Frame>
              </TimelineContent>
            </TimelineItem>
          );
        })}
      </Timeline>
    </div>
  );
}
