/**
 * @fileoverview HITL Non-blocking Approval Card component (§4.3).
 * Displayed when a revision is in `awaiting_approval` status.
 * Renders the composited mask preview, prompt text, requested model, cost estimate,
 * and exposes "Approve", "Modify in Brush", and "Reject" actions.
 */

import { useState } from "react";
import {
  AlertCircle,
  Check,
  DollarSign,
  Eye,
  Loader2,
  Paintbrush,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiSend } from "@/lib/api";

interface ApprovalCardProps {
  revisionId: string;
  promptText: string;
  requestedModel: string;
  costEstimate?: number | null;
  maskPreviewUrl?: string | null;
  onActionComplete: () => void;
  onOpenBrushModify?: () => void;
}

export function ApprovalCard({
  revisionId,
  promptText,
  requestedModel,
  costEstimate,
  maskPreviewUrl,
  onActionComplete,
  onOpenBrushModify,
}: ApprovalCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiSend("POST", `revisions/${revisionId}/approve`, { surface: "ui" });
      onActionComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
      setLoading(false);
    }
  };

  const handleReject = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiSend("POST", `revisions/${revisionId}/reject`, {
        reason: "User rejected proposal",
        surface: "ui",
      });
      onActionComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rejection failed");
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-amber-500/10 p-5 ring-1 ring-amber-500/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <ShieldAlert className="h-5 w-5" />
          <span>Mask Proposal Awaiting Approval</span>
        </div>
        <span className="font-mono text-xs text-amber-300/80 uppercase">Non-blocking Gate</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/20 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Mask Preview Image if available */}
      {maskPreviewUrl && (
        <div className="relative overflow-hidden rounded-lg bg-black/40 ring-1 ring-amber-500/20 max-h-48">
          <img
            src={maskPreviewUrl}
            alt="Mask Overlay Proposal"
            className="w-full object-contain"
          />
          <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-amber-300">
            Composited Region Preview
          </div>
        </div>
      )}

      {/* Details breakdown */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-background/60 p-3 ring-1 ring-border/40">
          <span className="text-muted-foreground">Prompt</span>
          <p className="mt-1 font-medium text-foreground line-clamp-2">{promptText}</p>
        </div>
        <div className="rounded-lg bg-background/60 p-3 ring-1 ring-border/40">
          <span className="text-muted-foreground">Model &amp; Cost</span>
          <p className="mt-1 font-mono font-medium text-foreground">{requestedModel}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Est. ${costEstimate ? costEstimate.toFixed(4) : "0.0200"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-500/20">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={loading}
          className="gap-1.5 bg-amber-500 text-black hover:bg-amber-400 font-semibold"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve &amp; Execute
        </Button>

        {onOpenBrushModify && (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenBrushModify}
            className="gap-1.5 ring-1 ring-amber-500/30 text-amber-300 hover:bg-amber-500/10"
          >
            <Paintbrush className="h-3.5 w-3.5" /> Modify Mask in Brush
          </Button>
        )}

        <Button
          size="sm"
          variant="destructive"
          onClick={handleReject}
          disabled={loading}
          className="gap-1.5 ml-auto"
        >
          <X className="h-3.5 w-3.5" /> Reject
        </Button>
      </div>
    </div>
  );
}
