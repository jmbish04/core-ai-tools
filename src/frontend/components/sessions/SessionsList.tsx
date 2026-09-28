/**
 * @fileoverview Sessions list component — matching Sessions and Models.dc.html.
 * Renders a data table of sessions with origin thumbnail, title, revision count,
 * surface badge (ui / api / mcp), status, last activity, and attention highlights.
 * Includes a "New Session" modal with library photo selector & upload capability.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  ImageIcon,
  Layers,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import { apiGet, apiSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SessionStepper } from "./SessionStepper";

interface Session {
  sessionUuid: string;
  title: string | null;
  status: "active" | "archived";
  createdVia: "ui" | "api" | "mcp";
  lastActivityAt: string;
  createdAt: string;
  originLibraryImageId: string;
  originDeliveryUrl?: string | null;
  revisionCount?: number;
  hasAwaitingApproval?: boolean;
}

function variant(deliveryUrl?: string | null, name: string = "thumb"): string {
  if (!deliveryUrl) return "";
  return deliveryUrl.replace(/\/[^/]+$/, `/${name}`);
}

export function SessionsList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surfaceFilter, setSurfaceFilter] = useState<string>("all");

  // New Session Modal
  const [newModalOpen, setNewModalOpen] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ sessions: Session[] }>("sessions");
      setSessions(res.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleArchiveSession = async (uuid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Archive this session?")) return;
    try {
      await apiSend("POST", `sessions/${uuid}/archive`);
      fetchSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive session");
    }
  };

  // Filter calculation
  const filtered = sessions.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (surfaceFilter !== "all" && s.createdVia !== surfaceFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (s.title ?? "").toLowerCase().includes(q);
      const matchUuid = s.sessionUuid.toLowerCase().includes(q);
      return matchTitle || matchUuid;
    }
    return true;
  });

  const awaitingCount = sessions.filter((s) => s.hasAwaitingApproval).length;

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            WORKSPACES &bull; REVISION TREES
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Editing sessions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sessions.length} total sessions
            {awaitingCount > 0 && (
              <span className="ml-2 font-mono text-xs font-medium text-amber-400">
                ({awaitingCount} need attention)
              </span>
            )}
          </p>
        </div>

        {/* Wraps: at 375 the fixed-width search left no room for the button
            beside it, and the button was pushed off the right edge. */}
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search titles or UUIDs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card ring-1 ring-border/40"
            />
          </div>

          <Button
            onClick={() => setNewModalOpen(true)}
            className="gap-2 bg-primary text-primary-foreground font-medium hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New session
          </Button>
        </div>
      </div>

      {/* Filter Row Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-border/40">
        {/* The inner group wraps too: the outer row wrapping is not enough when
            the chips themselves overflow a 375px card — Surface ran off it. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground uppercase mr-1">
            Status:
          </span>
          {["all", "active", "archived"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition-colors ${
                statusFilter === st
                  ? "bg-muted text-foreground ring-1 ring-border/40"
                  : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
              }`}
            >
              {st}
            </button>
          ))}

          <span className="mx-2 h-4 w-px bg-border/40" />

          <span className="font-mono text-xs text-muted-foreground uppercase mr-1">
            Surface:
          </span>
          {["all", "ui", "api", "mcp"].map((surf) => (
            <button
              key={surf}
              onClick={() => setSurfaceFilter(surf)}
              className={`rounded-lg px-3 py-1 text-xs font-medium uppercase transition-colors ${
                surfaceFilter === surf
                  ? "bg-muted text-foreground ring-1 ring-border/40"
                  : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
              }`}
            >
              {surf}
            </button>
          ))}
        </div>

        <span className="font-mono text-xs text-muted-foreground">
          {filtered.length} shown
        </span>
      </div>

      {/* Table Container */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Loading sessions...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-destructive">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            {error}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <h3 className="text-base font-semibold text-foreground">
              No sessions found
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {searchQuery || statusFilter !== "all" || surfaceFilter !== "all"
                ? "Try clearing filters."
                : "Create a session from an image in your library to start editing."}
            </p>
            <Button
              onClick={() => setNewModalOpen(true)}
              variant="outline"
              className="mt-4 gap-2 ring-1 ring-border/40"
            >
              <Plus className="h-4 w-4" /> Start a session
            </Button>
          </div>
        ) : (
          // The rows below are a fixed six-column grid that needs ~46rem. It
          // scrolls sideways rather than dropping columns, so a narrow screen
          // can still reach the ones it came for.
          <div className="divide-y divide-border/40 overflow-x-auto">
            {/* Table Header */}
            <div className="grid min-w-[46rem] grid-cols-[60px_1fr_120px_100px_160px_100px] items-center gap-4 bg-muted/30 px-5 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              <span>Photo</span>
              <span>Session / Title</span>
              <span>Revisions</span>
              <span>Surface</span>
              <span>Last Activity</span>
              <span className="text-right">Actions</span>
            </div>

            {/* Rows */}
            {filtered.map((s) => (
              <a
                key={s.sessionUuid}
                href={`/sessions/${s.sessionUuid}`}
                className="grid min-w-[46rem] grid-cols-[60px_1fr_120px_100px_160px_100px] items-center gap-4 px-5 py-3.5 text-sm transition-colors hover:bg-accent/5 group"
              >
                {/* Thumbnail */}
                <div className="h-10 w-10 overflow-hidden rounded-lg bg-background ring-1 ring-border/40">
                  {s.originDeliveryUrl ? (
                    <img
                      src={variant(s.originDeliveryUrl, "thumb")}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                  )}
                </div>

                {/* Title / UUID */}
                <div className="flex flex-col truncate pr-2">
                  <span className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {s.title || "Untitled Session"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {s.sessionUuid}
                  </span>
                </div>

                {/* Revisions badge */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {s.revisionCount ?? 1} nodes
                  </Badge>
                  {s.hasAwaitingApproval && (
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" title="Needs approval" />
                  )}
                </div>

                {/* Surface badge */}
                <div>
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] uppercase font-medium ring-1 ${
                      s.createdVia === "mcp"
                        ? "bg-purple-500/10 text-purple-400 ring-purple-500/20"
                        : s.createdVia === "api"
                        ? "bg-blue-500/10 text-blue-400 ring-blue-500/20"
                        : "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
                    }`}
                  >
                    {s.createdVia}
                  </span>
                </div>

                {/* Last activity */}
                <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span>{new Date(s.lastActivityAt || s.createdAt).toLocaleDateString()}</span>
                </div>

                {/* Action button */}
                <div className="flex items-center justify-end gap-2">
                  {s.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => handleArchiveSession(s.sessionUuid, e)}
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      <SessionStepper open={newModalOpen} onOpenChange={setNewModalOpen} />
    </div>
  );
}
