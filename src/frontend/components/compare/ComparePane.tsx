/**
 * @fileoverview One model's pane in a comparison.
 *
 * Carries the things that decide which output you keep: the picture, how long it
 * took, what it cost, which model actually served it (a fallback can change
 * that), and — collapsed but present — the exact prompt this model was sent.
 *
 * A failed model gets a pane too, with its error. Dropping it would leave a
 * comparison that silently shows three results for four models, which reads as
 * "that model produced nothing" rather than "that model errored".
 */

import { useState } from "react";
import { AlertTriangleIcon, ChevronDownIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ModelEntry, RunResult } from "./types";
import { variant } from "./types";

/** Milliseconds as something a person reads at a glance. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ComparePane({
  result,
  model,
  pending = false,
}: {
  result?: RunResult;
  model?: ModelEntry;
  pending?: boolean;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const name = model?.display_name ?? result?.requestedModel ?? "Model";

  if (pending || !result) {
    return (
      <article className="bg-card border-border overflow-hidden rounded-lg border">
        <header className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
          <h3 className="text-foreground truncate text-sm font-medium">{name}</h3>
          <Badge variant="secondary" className="text-[11px]">
            running
          </Badge>
        </header>
        <Skeleton className="aspect-square w-full rounded-none" />
      </article>
    );
  }

  const failed = result.status === "failed";

  return (
    <article className="bg-card border-border overflow-hidden rounded-lg border">
      <header className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-foreground truncate text-sm font-medium">{name}</h3>
          {result.servedModel && result.servedModel !== result.requestedModel ? (
            // A fallback served this: say so, or the comparison is mislabelled.
            <p className="text-muted-foreground truncate text-[11px]">
              served by {result.servedModel}
            </p>
          ) : null}
        </div>
        <Badge variant={failed ? "destructive" : "secondary"} className="shrink-0 text-[11px]">
          {result.status}
        </Badge>
      </header>

      {failed ? (
        <div className="flex items-start gap-2 px-4 py-6">
          <AlertTriangleIcon className="text-destructive-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">This model failed</p>
            <p className="text-muted-foreground mt-1 text-sm break-words">
              {result.errorMessage ?? result.errorCode ?? "No reason was reported."}
            </p>
          </div>
        </div>
      ) : result.deliveryUrl ? (
        <a href={variant(result.deliveryUrl, "full")} target="_blank" rel="noreferrer">
          <img
            src={variant(result.deliveryUrl, "full")}
            alt={`${name} output`}
            loading="lazy"
            className="aspect-square w-full bg-black/20 object-contain"
          />
        </a>
      ) : (
        <div className="text-muted-foreground px-4 py-10 text-center text-sm">
          No image was returned.
        </div>
      )}

      <footer className="space-y-2 px-4 py-3">
        <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span>
            <dt className="inline">time </dt>
            <dd className="text-foreground inline tabular-nums">{duration(result.latencyMs)}</dd>
          </span>
          <span>
            <dt className="inline">cost </dt>
            <dd className="text-foreground inline tabular-nums">
              {result.costUsd === null ? "priced by guardian" : `$${result.costUsd.toFixed(4)}`}
            </dd>
          </span>
          {result.maskSent ? <Badge variant="outline" className="text-[10px]">mask in-band</Badge> : null}
        </dl>

        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          aria-expanded={showPrompt}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
        >
          <ChevronDownIcon
            className={`size-3 transition-transform ${showPrompt ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          What this model was sent
        </button>
        {showPrompt ? (
          <p className="text-muted-foreground bg-muted/40 rounded-md p-2 text-[11px] break-words">
            {result.promptSent}
          </p>
        ) : null}
      </footer>
    </article>
  );
}
