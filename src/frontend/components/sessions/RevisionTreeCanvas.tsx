/**
 * @fileoverview Interactive Revision Tree Canvas DAG component.
 * Visualizes revision nodes flowing left-to-right from the seed node.
 * Features:
 *   - Groups sibling retries (same parent & edit fingerprint) into a single stacked
 *     node with attempt counter carousel, rather than sprawling sibling branches.
 *   - Status rings: green = succeeded, amber = awaiting_approval, yellow = running/queued, red = failed.
 *   - Fallback model badges (badge when requested_model != served_model).
 *   - Pan and zoom controls.
 *   - Node selection highlighting.
 */

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CornerDownRight,
  GitCommit,
  Layers,
  Pin,
  RotateCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface RevisionNode {
  id: string;
  /** Display name (rev1, rev2.1, "Original"); `id` is still the real uuid. */
  revLabel?: string | null;
  parentRevisionId: string | null;
  attemptNumber: number;
  editFingerprint: string;
  status: "queued" | "awaiting_approval" | "running" | "succeeded" | "failed" | "rejected" | "expired" | "cancelled";
  promptText: string;
  editPayload?: unknown;
  requestedModel?: string | null;
  servedModel?: string | null;
  provider?: string | null;
  fallbackReason?: string | null;
  inputImageId?: string | null;
  outputImageId?: string | null;
  outputDeliveryUrl?: string | null;
  isPinned?: boolean;
  approvalRequired?: boolean;
  createdVia?: string | null;
  createdAt: string;
}

interface GroupedNode {
  key: string; // parentId + fingerprint
  primaryNode: RevisionNode;
  attempts: RevisionNode[];
  selectedAttemptIdx: number;
}

interface RevisionTreeCanvasProps {
  revisions: RevisionNode[];
  selectedRevisionId: string | null;
  onSelectRevision: (revision: RevisionNode) => void;
}

function variant(deliveryUrl?: string | null, name: string = "thumb"): string {
  if (!deliveryUrl) return "";
  return deliveryUrl.replace(/\/[^/]+$/, `/${name}`);
}

export function RevisionTreeCanvas({
  revisions,
  selectedRevisionId,
  onSelectRevision,
}: RevisionTreeCanvasProps) {
  const [zoom, setZoom] = useState(1);
  const [attemptOverrides, setAttemptOverrides] = useState<Record<string, number>>({});

  // Group retries (same parentRevisionId and editFingerprint) into attempt groups
  const groupedNodes = useMemo(() => {
    const groups: Map<string, RevisionNode[]> = new Map();

    revisions.forEach((rev) => {
      // Seed node (parent is null) has editFingerprint = 'seed'
      const key = `${rev.parentRevisionId || "root"}:${rev.editFingerprint || rev.id}`;
      const existing = groups.get(key) || [];
      existing.push(rev);
      groups.set(key, existing);
    });

    const result: GroupedNode[] = [];
    groups.forEach((attempts, key) => {
      // Sort attempts ascending by attemptNumber
      attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
      const selectedIdx = attemptOverrides[key] ?? attempts.length - 1;
      result.push({
        key,
        primaryNode: attempts[selectedIdx] || attempts[attempts.length - 1],
        attempts,
        selectedAttemptIdx: selectedIdx,
      });
    });

    return result;
  }, [revisions, attemptOverrides]);

  const cycleAttempt = (groupKey: string, total: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setAttemptOverrides((prev) => {
      const current = prev[groupKey] ?? total - 1;
      const next = (current + 1) % total;
      return { ...prev, [groupKey]: next };
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40">
      {/* Canvas Header & Zoom */}
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">Revision DAG Tree</h3>
          <Badge variant="outline" className="font-mono text-[10px]">
            {revisions.length} total nodes
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground hover:text-foreground"
          >
            -
          </button>
          <span className="font-mono text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground hover:text-foreground"
          >
            +
          </button>
          <button
            onClick={() => setZoom(1)}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
      </div>

      {/* DAG Node Graph Layout */}
      <div className="relative min-h-[320px] max-h-[460px] overflow-auto rounded-xl bg-canvas p-6 ring-1 ring-border/40">
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          className="flex flex-wrap items-start gap-6 transition-transform"
        >
          {groupedNodes.map((group) => {
            const node = group.primaryNode;
            const isSelected = selectedRevisionId === node.id;
            const isSeed = node.parentRevisionId === null;
            const hasFallback =
              node.servedModel && node.requestedModel && node.servedModel !== node.requestedModel;

            // Ring color logic based on status
            let ringColor = "ring-border/40";
            if (node.status === "succeeded") ringColor = "ring-emerald-500/60";
            else if (node.status === "awaiting_approval") ringColor = "ring-amber-400 animate-pulse";
            else if (node.status === "running" || node.status === "queued") ringColor = "ring-yellow-400 animate-pulse";
            else if (node.status === "failed" || node.status === "rejected") ringColor = "ring-destructive";

            return (
              <div
                key={group.key}
                onClick={() => onSelectRevision(node)}
                className={`group relative flex w-52 flex-col rounded-xl bg-card p-3 cursor-pointer transition-all ${
                  isSelected
                    ? "ring-2 ring-primary shadow-lg shadow-primary/10"
                    : `ring-1 ${ringColor} hover:ring-primary/50`
                }`}
              >
                {/* Node Top Row: Status badge & Pinned icon */}
                <div className="flex items-center justify-between gap-1 mb-2">
                  <div className="flex items-center gap-1.5 truncate">
                    {isSeed ? (
                      <span className="font-mono text-[10px] uppercase font-bold text-primary">
                        {node.revLabel ?? "SEED PHOTO"}
                      </span>
                    ) : (
                      <>
                        {node.revLabel && (
                          <span className="font-mono text-[10px] font-bold text-foreground">
                            {node.revLabel}
                          </span>
                        )}
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase font-semibold ${
                          node.status === "succeeded"
                            ? "text-emerald-400"
                            : node.status === "awaiting_approval"
                            ? "text-amber-400"
                            : node.status === "failed"
                            ? "text-destructive"
                            : "text-yellow-400"
                        }`}
                      >
                        {node.status === "succeeded" && <CheckCircle2 className="h-3 w-3" />}
                        {node.status}
                      </span>
                      </>
                    )}
                  </div>

                  {node.isPinned && (
                    <span title="Pinned accepted result">
                      <Pin className="h-3.5 w-3.5 fill-primary text-primary" />
                    </span>
                  )}
                </div>

                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-background ring-1 ring-border/40 mb-2">
                  {node.outputDeliveryUrl ? (
                    <img
                      src={variant(node.outputDeliveryUrl, "thumb")}
                      alt={node.promptText || "Seed node"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs font-mono">
                      {node.status === "running" ? "Generating..." : "No Image"}
                    </div>
                  )}

                  {/* Fallback Model Badge */}
                  {hasFallback && (
                    <div className="absolute top-1 right-1 flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-black backdrop-blur">
                      <Zap className="h-2.5 w-2.5" /> Fallback
                    </div>
                  )}
                </div>

                {/* Prompt snippet */}
                <p className="line-clamp-2 text-xs text-foreground/90 font-medium leading-snug">
                  {isSeed ? "Original source asset" : node.promptText || "Structured edit payload"}
                </p>

                {/* Bottom Bar: Stacked Attempt Carousel if multiple retries exist */}
                {group.attempts.length > 1 && (
                  <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Attempt {group.selectedAttemptIdx + 1} of {group.attempts.length}
                    </span>
                    <button
                      onClick={(e) => cycleAttempt(group.key, group.attempts.length, e)}
                      className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:bg-accent/20"
                      title="Cycle through retries"
                    >
                      <RotateCw className="h-3 w-3" /> Cycle
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
