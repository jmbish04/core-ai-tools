/**
 * @fileoverview Centerpiece Session Detail Workbench (`Session View.dc.html`).
 * Integrates:
 *   - Interactive Revision Tree DAG Canvas (`RevisionTreeCanvas`).
 *   - Single image preview / Image Diff Viewer (`ImageDiffViewer`) supporting
 *     Slider, Side-by-Side, and Onion Skin with Perspective Drift edge detection.
 *   - HITL Non-blocking Approval Card (`ApprovalCard`).
 *   - Selected Revision Specs Pane (`RevisionDetailPane`).
 *   - Edit Entry Compose Pane (`ComposePane`).
 *   - Canvas Mask Brush Tool Modal (`MaskBrushModal`).
 *   - Realtime WebSocket event listener with fallback polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  GitCommit,
  Layers,
  Loader2,
  Paintbrush,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { RevisionTreeCanvas, type RevisionNode } from "./RevisionTreeCanvas";
import { ImageDiffViewer } from "./ImageDiffViewer";
import { ApprovalCard } from "./ApprovalCard";
import { RevisionDetailPane } from "./RevisionDetailPane";
import { ComposePane } from "./ComposePane";
import { MaskBrushModal } from "./MaskBrushModal";

interface SessionDetailData {
  session: {
    sessionUuid: string;
    title: string | null;
    status: string;
    originLibraryImageId: string;
    approvalPolicy: string;
    createdVia: string;
    rootRevisionId: string | null;
  };
  revisions: RevisionNode[];
  originImage?: {
    id: string;
    deliveryUrl: string;
    originalFilename?: string | null;
  };
}

function variant(deliveryUrl?: string | null, name: string = "full"): string {
  if (!deliveryUrl) return "";
  return deliveryUrl.replace(/\/[^/]+$/, `/${name}`);
}

export function SessionDetail({ uuid }: { uuid: string }) {
  const [data, setData] = useState<SessionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected revision for detail pane / comparison
  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // Mask & Brush modal state
  const [maskBrushOpen, setMaskBrushOpen] = useState(false);
  const [attachedMask, setAttachedMask] = useState<{
    id: string;
    label?: string | null;
    mode: "inpaint" | "preserve";
  } | null>(null);

  // WebSocket realtime state
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchSession = useCallback(async () => {
    try {
      const res = await apiGet<SessionDetailData>(`sessions/${uuid}`);
      setData(res);
      setError(null);

      // Default select latest revision or root if none selected
      if (!selectedRevId && res.revisions && res.revisions.length > 0) {
        setSelectedRevId(res.revisions[res.revisions.length - 1].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session details");
    } finally {
      setLoading(false);
    }
  }, [uuid, selectedRevId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Check query params for ?compare=1 deep-linking
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("compare") === "1") {
        setShowDiff(true);
      }
      const revParam = params.get("revision");
      if (revParam) {
        setSelectedRevId(revParam);
      }
    }
  }, []);

  // WebSocket setup with reconnect fallback
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/realtime/ws/sessions/${uuid}`;

    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        // Ask the SessionDO to replay anything missed (it keys replay off lastSeq).
        try {
          ws?.send(JSON.stringify({ sessionUuid: uuid, lastSeq: 0 }));
        } catch {
          // socket may not be fully open yet — live broadcasts still arrive.
        }
      };
      ws.onclose = () => setWsConnected(false);
      ws.onerror = () => setWsConnected(false);
      // The SessionDO emits semantic event types (revision_created / _progress /
      // _status_changed); refetch on ANY event rather than matching a fixed name.
      ws.onmessage = () => fetchSession();
    } catch {
      setWsConnected(false);
    }

    // Fallback polling every 5s if WS disconnected
    const interval = setInterval(() => {
      if (!wsConnected) {
        fetchSession();
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      if (ws) ws.close();
    };
  }, [uuid, wsConnected, fetchSession]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-3 text-primary" />
        <p className="font-mono text-sm">Loading session workspace &amp; revision tree...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-destructive/15 p-6 text-destructive ring-1 ring-destructive/30 max-w-xl mx-auto my-12">
        <AlertCircle className="h-6 w-6 mb-2" />
        <h3 className="font-bold">Error loading session</h3>
        <p className="text-sm mt-1">{error || "Session not found."}</p>
        <a href="/sessions" className="mt-4 inline-block text-xs font-mono underline">
          &larr; Return to Sessions list
        </a>
      </div>
    );
  }

  const { session, revisions, originImage } = data;
  const selectedNode = revisions.find((r) => r.id === selectedRevId) || revisions[revisions.length - 1];

  // Find parent node for diff comparison
  const parentNode = selectedNode?.parentRevisionId
    ? revisions.find((r) => r.id === selectedNode.parentRevisionId)
    : null;

  const currentImageUrl = variant(selectedNode?.outputDeliveryUrl || originImage?.deliveryUrl);
  const parentImageUrl = variant(parentNode?.outputDeliveryUrl || originImage?.deliveryUrl);

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Top Session Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <a
            href="/sessions"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-card ring-1 ring-border/40 text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Sessions"
          >
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {session.title || "Untitled Session"}
              </h1>
              <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
                {session.status}
              </Badge>
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              UUID: {session.sessionUuid} &bull; Created via {session.createdVia.toUpperCase()}
            </p>
          </div>
        </div>

        {/* Realtime WS Indicator & Controls */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-xs ring-1 ${
              wsConnected
                ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                : "bg-muted text-muted-foreground ring-border/40"
            }`}
          >
            {wsConnected ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                <span>Live WS</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" />
                <span>Polling (5s)</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Revision Tree DAG Canvas */}
      <RevisionTreeCanvas
        revisions={revisions}
        selectedRevisionId={selectedNode?.id || null}
        onSelectRevision={(rev) => setSelectedRevId(rev.id)}
      />

      {/* Main Workbench Grid: Image Stage (Left) & Controls (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Left Column: Image Display / Diff Viewer / Approval Card */}
        <div className="flex flex-col gap-5">
          {/* HITL Non-blocking Approval Card if selected revision is awaiting approval */}
          {selectedNode?.status === "awaiting_approval" && (
            <ApprovalCard
              revisionId={selectedNode.id}
              promptText={selectedNode.promptText}
              requestedModel={selectedNode.requestedModel || "default"}
              onActionComplete={fetchSession}
              onOpenBrushModify={() => setMaskBrushOpen(true)}
            />
          )}

          {/* Toggle between Single Image View and Diff Viewer */}
          {showDiff ? (
            <ImageDiffViewer
              parentImageUrl={parentImageUrl}
              currentImageUrl={currentImageUrl}
              parentLabel={parentNode ? `Parent (${parentNode.id.slice(0, 8)})` : "Seed Photo"}
              currentLabel={`Revision (${selectedNode?.id.slice(0, 8)})`}
            />
          ) : (
            <div className="relative flex min-h-[420px] w-full flex-col overflow-hidden rounded-xl bg-canvas p-4 ring-1 ring-border/40 select-none">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs text-muted-foreground uppercase">
                  Current Node View
                </span>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDiff(true)}
                  className="gap-1.5 h-7 text-xs font-mono ring-1 ring-border/40"
                >
                  <Layers className="h-3.5 w-3.5" /> Compare Diff View
                </Button>
              </div>

              <div className="relative flex-1 flex items-center justify-center min-h-[360px]">
                {currentImageUrl ? (
                  <img
                    src={currentImageUrl}
                    alt={selectedNode?.promptText || "Result"}
                    className="max-h-[500px] w-full object-contain rounded-lg shadow-2xl"
                  />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground text-xs font-mono">
                    <Loader2 className="h-8 w-8 animate-spin mb-2 text-primary" />
                    <span>In-flight edit execution...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Compose Pane & Selected Revision Detail */}
        <div className="flex flex-col gap-5">
          {/* Compose Edit Entry Pane */}
          {selectedNode && (
            <ComposePane
              sessionUuid={session.sessionUuid}
              parentRevisionId={selectedNode.id}
              onEditSubmitted={fetchSession}
              onOpenMaskBrush={() => setMaskBrushOpen(true)}
              attachedMask={attachedMask}
              onClearMask={() => setAttachedMask(null)}
            />
          )}

          {/* Selected Revision Details Pane */}
          {selectedNode && (
            <RevisionDetailPane
              revision={selectedNode}
              onRefreshSession={fetchSession}
              onToggleCompare={() => setShowDiff(!showDiff)}
              onForkNode={(node) => setSelectedRevId(node.id)}
            />
          )}
        </div>
      </div>

      {/* Canvas Mask Brush Tool Modal */}
      {originImage && (
        <MaskBrushModal
          open={maskBrushOpen}
          onOpenChange={setMaskBrushOpen}
          imageUrl={currentImageUrl || variant(originImage.deliveryUrl)}
          sourceImageId={originImage.id}
          sessionUuid={session.sessionUuid}
          onMaskCreated={(mask) => setAttachedMask(mask)}
        />
      )}
    </div>
  );
}
