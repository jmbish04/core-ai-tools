/**
 * @fileoverview Models Registry Island — complete capability matrix and task defaults
 * manager matching Sessions and Models.dc.html.
 * Features:
 *   - Search & capability filter chips.
 *   - Task default model switcher (`PUT /api/models/tasks/:taskKey`).
 *   - Deprecation alert banner when a task default points to a deprecated model.
 *   - Model catalog table with provider badge, capabilities, max resolution, cost.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Database,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";

import { apiGet, apiSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface Caps {
  mask_inpainting: boolean;
  grounding_web: boolean;
  grounding_image_search: boolean;
  video_generation: boolean;
  segmentation: boolean;
  blueprint_json?: boolean;
  max_reference_images: number;
  max_resolution: string;
}

interface Model {
  id: string;
  provider: string;
  display_name: string;
  capabilities: Caps;
  cost_per_image?: number;
  deprecated?: boolean;
}

interface TaskDefault {
  taskKey: string;
  modelId: string;
  enabled: boolean;
}

export function ModelsView() {
  const [models, setModels] = useState<Model[]>([]);
  const [defaults, setDefaults] = useState<TaskDefault[]>([]);
  const [broken, setBroken] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [capFilter, setCapFilter] = useState<string>("all");
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [mRes, tRes] = await Promise.all([
        apiGet<{ models: Model[] }>("models"),
        apiGet<{ defaults: TaskDefault[]; broken: unknown[] }>("models/tasks"),
      ]);
      setModels(mRes.models ?? []);
      setDefaults(tRes.defaults ?? []);
      setBroken(tRes.broken ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load models registry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdateTaskDefault = async (taskKey: string, newModelId: string) => {
    setUpdatingTask(taskKey);
    try {
      await apiSend("PUT", `models/tasks/${taskKey}`, { modelId: newModelId });
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update task default model");
    } finally {
      setUpdatingTask(null);
    }
  };

  const filteredModels = models.filter((m) => {
    if (capFilter === "mask" && !m.capabilities.mask_inpainting) return false;
    if (capFilter === "video" && !m.capabilities.video_generation) return false;
    if (capFilter === "segmentation" && !m.capabilities.segmentation) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.display_name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const FLAG = (v: boolean) =>
    v ? (
      <span className="font-bold text-emerald-400">✓</span>
    ) : (
      <span className="text-muted-foreground/30">–</span>
    );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mb-2 text-primary" />
        <span className="font-mono text-sm">Loading model registry &amp; task defaults...</span>
      </div>
    );
  }

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      {/* Top Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            MODEL REGISTRY &bull; CORE-AI-TOOLS
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Declarative model catalog
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {models.length} registered image models &bull; Enforces capability flags before dispatch
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search model ID or provider..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card ring-1 ring-border/40"
            />
          </div>
        </div>
      </div>

      {/* Deprecation Warning Banner if broken defaults exist */}
      {broken.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl bg-destructive/15 p-4 text-destructive ring-1 ring-destructive/40">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <h4 className="font-bold">Task Default Deprecation Alert</h4>
            <p className="mt-1 text-xs text-destructive/90">
              {broken.length} enabled task default(s) point at a missing or deprecated model. Re-assign task defaults below to keep automated dispatches healthy.
            </p>
          </div>
        </div>
      )}

      {/* Task Defaults Section */}
      <div className="rounded-xl bg-card p-5 ring-1 ring-border/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Task Model Defaults
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            Authoritative dispatch table
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {defaults.map((d) => (
            <div
              key={d.taskKey}
              className="flex flex-col justify-between rounded-lg bg-background p-3 ring-1 ring-border/40 space-y-2"
            >
              <div>
                <span className="font-mono text-xs font-semibold text-foreground uppercase">
                  {d.taskKey}
                </span>
                <p className="font-mono text-xs text-primary mt-0.5 font-medium truncate">
                  {d.modelId}
                </p>
              </div>

              <select
                value={d.modelId}
                disabled={updatingTask === d.taskKey}
                onChange={(e) => handleUpdateTaskDefault(d.taskKey, e.target.value)}
                className="w-full rounded bg-card p-1.5 font-mono text-[11px] text-foreground ring-1 ring-border/40 focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Filter Row Chips */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-border/40">
        {/* Wraps below sm: four capability chips on one row ran off the right
            edge at 375, and the last of them was unreachable. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground uppercase mr-1">
            Capabilities:
          </span>
          {[
            { key: "all", label: "All Models" },
            { key: "mask", label: "Mask Inpainting" },
            { key: "video", label: "Video Generation" },
            { key: "segmentation", label: "Segmentation" },
          ].map((c) => (
            <button
              key={c.key}
              onClick={() => setCapFilter(c.key)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                capFilter === c.key
                  ? "bg-muted text-foreground ring-1 ring-border/40"
                  : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <span className="font-mono text-xs text-muted-foreground">
          {filteredModels.length} shown
        </span>
      </div>

      {/* Model Catalog Table */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/40">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/40 bg-muted/30 text-left text-xs font-mono text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Model</th>
                <th className="px-3 py-3">Provider</th>
                <th className="px-3 py-3">Mask</th>
                <th className="px-3 py-3">Web</th>
                <th className="px-3 py-3">Img Search</th>
                <th className="px-3 py-3">Video</th>
                <th className="px-3 py-3">Segment</th>
                <th className="px-3 py-3">Max Res</th>
                <th className="px-4 py-3 text-right">Est. Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredModels.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-muted/20">
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-foreground">{m.display_name}</div>
                    <div className="font-mono text-xs text-muted-foreground flex items-center gap-1.5">
                      <span>{m.id}</span>
                      {m.deprecated && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300 font-bold">
                          deprecated
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {m.provider}
                    </Badge>
                  </td>
                  <td className="px-3 py-3.5 font-mono">{FLAG(m.capabilities.mask_inpainting)}</td>
                  <td className="px-3 py-3.5 font-mono">{FLAG(m.capabilities.grounding_web)}</td>
                  <td className="px-3 py-3.5 font-mono">{FLAG(m.capabilities.grounding_image_search)}</td>
                  <td className="px-3 py-3.5 font-mono">{FLAG(m.capabilities.video_generation)}</td>
                  <td className="px-3 py-3.5 font-mono">{FLAG(m.capabilities.segmentation)}</td>
                  <td className="px-3 py-3.5 font-mono text-xs text-muted-foreground">
                    {m.capabilities.max_resolution}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs text-foreground">
                    ${(m.cost_per_image ?? 0.02).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
