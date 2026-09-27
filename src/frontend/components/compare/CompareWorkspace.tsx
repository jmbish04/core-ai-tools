/**
 * @fileoverview `/compare` — one intent, several models, side by side.
 *
 * REUSE NOTE, stated plainly: this takes the ARRANGEMENT from ReUI `ai-chat-7`
 * (a row of per-model panes, each with its own status and elapsed time) and its
 * primitives, but not its pane internals. That block streams text turns; a
 * comparison here is an image plus latency, cost and the exact prompt that model
 * received. Forcing image results through a text-turn shape would have been
 * reuse in name only.
 *
 * The prompt each model was actually sent is the point of the screen. The Worker
 * rewrites one intent per provider before dispatch, so when one output is better
 * the honest question is "what did it actually read?" — and the answer is on the
 * pane, not buried in a log.
 */

import { useEffect, useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiSend } from "@/lib/api";
import { ComparePane } from "./ComparePane";
import type { ModelEntry, RunResponse } from "./types";

/** Models worth offering here: the ones that can actually produce an image. */
function imageModels(models: ModelEntry[]): ModelEntry[] {
  return models.filter(
    (m) => !m.deprecated && (m.capabilities.text_to_image || m.capabilities.image_to_image),
  );
}

export function CompareWorkspace() {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ models: ModelEntry[] }>("models")
      .then((r) => {
        const usable = imageModels(r.models);
        setModels(usable);
        // Two is the useful default: a comparison of one is a generation.
        setPicked(usable.slice(0, 2).map((m) => m.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load models."));
  }, []);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const go = async () => {
    if (!prompt.trim() || picked.length === 0) return;
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const res = await apiSend<RunResponse>("POST", "runs", {
        prompt: prompt.trim(),
        models: picked,
      });
      setRun(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run could not be started.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-card border-border space-y-4 rounded-lg border p-5">
        <div className="space-y-1.5">
          <Label htmlFor="compare-prompt">What do you want made?</Label>
          <Textarea
            id="compare-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="a cast-iron kettle on a slate worktop, morning light"
          />
          <p className="text-muted-foreground text-xs">
            Say it once. Each model gets this rewritten for how it reads prompts, and every
            pane shows exactly what its model received.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Models</Label>
          {models === null ? (
            <p className="text-muted-foreground text-sm">Loading the registry…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {models.map((m) => {
                const on = picked.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(m.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      on
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/40"
                    }`}
                    title={m.notes ?? m.display_name}
                  >
                    {m.display_name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={running || !prompt.trim() || picked.length === 0}
            onClick={() => void go()}
          >
            <SparklesIcon className="size-4" aria-hidden="true" />
            {running ? `Running ${picked.length} models…` : `Run on ${picked.length} model${picked.length === 1 ? "" : "s"}`}
          </Button>
          {picked.length === 1 ? (
            <span className="text-muted-foreground text-xs">
              One model is a generation, not a comparison — add another.
            </span>
          ) : null}
        </div>

        {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      </section>

      {running ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {picked.map((id) => (
            <ComparePane key={id} pending model={models?.find((m) => m.id === id)} />
          ))}
        </div>
      ) : null}

      {run ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-foreground text-sm font-semibold">
              {run.results.length} result{run.results.length === 1 ? "" : "s"}
            </h2>
            <span className="text-muted-foreground text-xs">
              Run {run.run.id.slice(0, 8)} · {run.status}
            </span>
          </header>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {run.results.map((r) => (
              <ComparePane
                key={r.requestedModel}
                result={r}
                model={models?.find((m) => m.id === r.requestedModel)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
