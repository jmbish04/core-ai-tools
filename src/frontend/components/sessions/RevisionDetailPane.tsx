/**
 * @fileoverview Revision Detail Pane component.
 * Displays specs for the currently selected node in the revision DAG:
 *   - Verbatim prompt text and JSON edit payload.
 *   - Provider, requested vs served model badges (fallback warning).
 *   - Latency, token usage, cost estimate.
 *   - Image decomposition blueprint JSON viewer.
 *   - Actions: Fork from node, Retry edit, Pin accepted result.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Clock,
  Code,
  Coins,
  Cpu,
  FileCode,
  GitFork,
  Layers,
  Loader2,
  Pin,
  RotateCw,
  Sparkles,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiSend } from "@/lib/api";
import type { RevisionNode } from "./RevisionTreeCanvas";

interface RevisionDetailPaneProps {
  revision: RevisionNode;
  onRefreshSession: () => void;
  onToggleCompare?: () => void;
  onForkNode?: (rev: RevisionNode) => void;
}

export function RevisionDetailPane({
  revision,
  onRefreshSession,
  onToggleCompare,
  onForkNode,
}: RevisionDetailPaneProps) {
  const [pinning, setPinning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const isSeed = revision.parentRevisionId === null;
  const hasFallback =
    revision.servedModel && revision.requestedModel && revision.servedModel !== revision.requestedModel;

  const handlePin = async () => {
    setPinning(true);
    try {
      await apiSend("POST", `revisions/${revision.id}/pin`);
      onRefreshSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to pin revision");
    } finally {
      setPinning(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await apiSend("POST", `revisions/${revision.id}/retry`);
      onRefreshSession();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to retry revision");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border/40">
      {/* Title & Pin status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
        <div className="min-w-0">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            SELECTED REVISION
          </span>
          <h3 className="font-mono text-sm font-semibold text-foreground truncate">
            {revision.revLabel ?? `rev ${revision.id.slice(0, 8)}`}
          </h3>
          <p className="font-mono text-[10px] text-muted-foreground truncate" title={revision.id}>
            {revision.id}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onToggleCompare && !isSeed && (
            <Button
              size="sm"
              variant="outline"
              onClick={onToggleCompare}
              className="h-8 gap-1.5 whitespace-nowrap ring-1 ring-border/40 text-xs font-mono"
            >
              <Layers className="h-3.5 w-3.5" /> Compare Diff
            </Button>
          )}

          <Button
            size="sm"
            variant={revision.isPinned ? "default" : "outline"}
            onClick={handlePin}
            disabled={pinning}
            className={`h-8 gap-1 whitespace-nowrap text-xs font-mono ${
              revision.isPinned ? "bg-primary text-primary-foreground" : "ring-1 ring-border/40"
            }`}
          >
            <Pin className="h-3.5 w-3.5" /> {revision.isPinned ? "Pinned" : "Pin Result"}
          </Button>
        </div>
      </div>

      {/* Fallback Model Alert Banner */}
      {hasFallback && (
        <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/15 p-3 text-xs text-amber-300 ring-1 ring-amber-500/30">
          <Zap className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div>
            <span className="font-bold">Served via Fallback Model:</span> Requested{" "}
            <code className="font-mono">{revision.requestedModel}</code> but served{" "}
            <code className="font-mono">{revision.servedModel}</code>.
            {revision.fallbackReason && (
              <p className="mt-1 font-mono text-[11px] text-amber-300/80">
                Reason: {revision.fallbackReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Specs Metadata Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-background p-3 ring-1 ring-border/40 space-y-1">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5" /> Model &amp; Provider
          </span>
          <p className="font-mono font-medium text-foreground truncate">
            {revision.servedModel || revision.requestedModel || "default"}
          </p>
          <span className="font-mono text-[10px] text-muted-foreground uppercase">
            Provider: {revision.provider || "google"}
          </span>
        </div>

        <div className="rounded-lg bg-background p-3 ring-1 ring-border/40 space-y-1">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5" /> Cost &amp; Attempt
          </span>
          <p className="font-mono font-medium text-foreground">
            Attempt #{revision.attemptNumber}
          </p>
          <span className="font-mono text-[10px] text-muted-foreground">
            Created via {revision.createdVia?.toUpperCase() ?? "UI"}
          </span>
        </div>
      </div>

      {/* JSON Payload Inspector Toggle */}
      {revision.editPayload ? (
        <div className="border-t border-border/40 pt-3">
          <button
            onClick={() => setShowPayload(!showPayload)}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground"
          >
            <Code className="h-3.5 w-3.5" /> {showPayload ? "Hide" : "Inspect"} Edit JSON Payload
          </button>

          {showPayload && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] text-foreground ring-1 ring-border/40">
              {JSON.stringify(revision.editPayload, null, 2)}
            </pre>
          )}
        </div>
      ) : null}

      {/* Node Actions */}
      {!isSeed && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/40">
          {onForkNode && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onForkNode(revision)}
              className="gap-1.5 ring-1 ring-border/40 text-xs"
            >
              <GitFork className="h-3.5 w-3.5" /> Fork Branch
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={retrying}
            className="gap-1.5 ring-1 ring-border/40 text-xs"
          >
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Retry Edit
          </Button>
        </div>
      )}
    </div>
  );
}
