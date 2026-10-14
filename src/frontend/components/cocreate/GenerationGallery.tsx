/**
 * @fileoverview Every image this session generated, grouped by Generate click
 * and labelled with the prompt version that produced it. Images are Cloudflare
 * Images delivery URLs (variant swapped, never appended). From any image the
 * user can open an edit session on it, or make it this session's reference.
 */

import { useState } from "react";
import { AlertTriangleIcon, ImageIcon, Loader2Icon, PencilRulerIcon, PinIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { variantOf, type Generation, type PromptVersion } from "./types";

export interface GenerationGalleryProps {
  generations: Generation[];
  versions: PromptVersion[];
  generating: boolean;
  referenceImageId: string | null;
  onOpenInEditor: (g: Generation) => Promise<void>;
  onUseAsReference: (g: Generation) => void;
}

export function GenerationGallery({
  generations,
  versions,
  generating,
  referenceImageId,
  onOpenInEditor,
  onUseAsReference,
}: GenerationGalleryProps) {
  const [opening, setOpening] = useState<string | null>(null);
  const versionOf = new Map(versions.map((v) => [v.id, v.version]));
  const batches: Generation[][] = [];
  for (const g of generations) {
    const last = batches.at(-1);
    if (last && last[0].batchId === g.batchId) last.push(g);
    else batches.push([g]);
  }

  return (
    <div className="flex flex-col gap-4">
      {generating ? (
        <Frame stacked dense spacing="sm">
          <FrameHeader>
            <FrameTitle className="flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
              Generating…
            </FrameTitle>
          </FrameHeader>
          <FramePanel className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-video" />
            ))}
          </FramePanel>
        </Frame>
      ) : null}

      {batches.length === 0 && !generating ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No images yet</EmptyTitle>
            <EmptyDescription>Generate from the current prompt, or from any version in History.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {batches.map((batch) => {
        const head = batch[0];
        const ok = batch.filter((g) => g.deliveryUrl);
        const failed = batch.filter((g) => !g.deliveryUrl);
        return (
          <Frame key={head.batchId} stacked dense spacing="sm">
            <FrameHeader className="flex flex-row flex-wrap items-center gap-2">
              <Badge variant="secondary">v{versionOf.get(head.promptVersionId) ?? "?"}</Badge>
              <FrameDescription className="min-w-0 truncate">
                {head.model} · {head.aspectRatio} · {relativeTime(head.createdAt)}
              </FrameDescription>
              {failed.length ? (
                <Badge variant="warning-light" className="ml-auto gap-1">
                  <AlertTriangleIcon className="size-3" aria-hidden="true" />
                  {failed.length} failed
                </Badge>
              ) : null}
            </FrameHeader>
            <FramePanel className="flex flex-col gap-2">
              {ok.length ? (
                <ul className="grid grid-cols-2 gap-2">
                  {ok.map((g) => (
                    <li key={g.id} className="group relative overflow-hidden rounded-md">
                      <a href={variantOf(g.deliveryUrl!, "full")} target="_blank" rel="noreferrer" aria-label="Open full size">
                        <img src={variantOf(g.deliveryUrl!, "preview")} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                      </a>
                      <div className="bg-background/85 absolute inset-x-0 bottom-0 flex translate-y-full gap-1 p-1.5 backdrop-blur transition-transform group-focus-within:translate-y-0 group-hover:translate-y-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 flex-1 px-2 text-xs"
                          disabled={opening !== null}
                          onClick={async () => {
                            setOpening(g.id);
                            try {
                              await onOpenInEditor(g);
                            } finally {
                              setOpening(null);
                            }
                          }}
                        >
                          {opening === g.id ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" /> : <PencilRulerIcon className="size-3.5" aria-hidden="true" />}
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 flex-1 px-2 text-xs"
                          disabled={g.libraryImageId === referenceImageId}
                          onClick={() => onUseAsReference(g)}
                        >
                          <PinIcon className="size-3.5" aria-hidden="true" />
                          {g.libraryImageId === referenceImageId ? "Reference" : "Use as reference"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {failed.length ? (
                <details className="text-muted-foreground text-xs">
                  <summary className="cursor-pointer">Why {failed.length} slot{failed.length === 1 ? "" : "s"} failed</summary>
                  <ul className="mt-1 list-disc ps-4">
                    {[...new Set(failed.map((f) => f.error))].map((e) => (
                      <li key={e} className="break-words">
                        {e}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </FramePanel>
          </Frame>
        );
      })}
    </div>
  );
}
