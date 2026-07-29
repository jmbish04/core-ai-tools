/**
 * @fileoverview JSON edit-payload editor for the Compose pane.
 *
 * A textarea for authoring the structured edit payload, a live collapsible,
 * syntax-colored tree preview of the parsed value, a help modal explaining the
 * payload, and an AI-assist ("✨") flow: the user describes what they want, a
 * Workers-AI call (`/api/ai/format-json`) repairs/improves the JSON, and the
 * result is shown for the user to Accept (overwrite) or Reject.
 *
 * Self-contained tree viewer (no external registry dependency): jal-co / shark
 * both need a shadcn registry + @ark-ui/react that this project doesn't have
 * wired, so a small local viewer keeps it dependency-free. Swap in jal-co/shark
 * later by replacing <JsonTree/> if the registry gets configured.
 */

"use client";

import { useState } from "react";
import { HelpCircle, Loader2, Sparkles, X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiSend } from "@/lib/api";

// --- Collapsible, syntax-colored JSON tree -------------------------------

/** Hard recursion cap so a deeply nested (or malicious) payload can't blow the
 * call stack and crash the editor. Deeper levels render a "…" placeholder. */
const MAX_DEPTH = 16;

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  switch (typeof value) {
    case "string":
      return <span className="text-emerald-400">&quot;{value}&quot;</span>;
    case "number":
      return <span className="text-blue-400">{String(value)}</span>;
    case "boolean":
      return <span className="text-amber-400">{String(value)}</span>;
    default:
      return <span className="text-foreground">{String(value)}</span>;
  }
}

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = value !== null && typeof value === "object";

  if (!isObj) {
    return (
      <div className="whitespace-pre-wrap break-all">
        {name !== undefined && <span className="text-foreground/80">{name}: </span>}
        <Primitive value={value} />
      </div>
    );
  }

  // Stop recursing past the cap — render a collapsed placeholder instead.
  if (depth >= MAX_DEPTH) {
    return (
      <div className="whitespace-pre-wrap break-all">
        {name !== undefined && <span className="text-foreground/80">{name}: </span>}
        <span className="text-muted-foreground">{Array.isArray(value) ? "[ … ]" : "{ … }"}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const brace = Array.isArray(value) ? "[]" : "{}";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-left hover:text-foreground text-foreground/80"
      >
        <span className="inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>
        {name !== undefined && <span>{name}: </span>}
        <span className="text-muted-foreground">
          {brace[0]}
          {!open && ` ${entries.length} `}
          {!open && brace[1]}
        </span>
      </button>
      {open && (
        <div className="border-l border-border/40 pl-3 ml-1.5">
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
      {open && <div className="text-muted-foreground">{brace[1]}</div>}
    </div>
  );
}

function JsonTree({ text }: { text: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    return (
      <p className="font-mono text-[11px] text-destructive">
        Invalid JSON — fix it above to see the tree preview.
      </p>
    );
  }
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      <JsonNode value={parsed} depth={0} />
    </div>
  );
}

// --- Editor ---------------------------------------------------------------

export function JsonPayloadEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const runAi = async () => {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    setResult(null);
    try {
      const raw = await apiSend<unknown>("POST", "ai/format-json", {
        json: value,
        instruction: instruction.trim() || undefined,
      });
      // Validate the shape at runtime — a type cast alone would let an
      // unexpected response through as `undefined`.
      const { formatted } = z.object({ formatted: z.string() }).parse(raw);
      setResult(formatted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Formatting failed.");
      // Surface the exact model output / server detail when the model failed.
      const body = e instanceof ApiError ? (e.body as { raw?: unknown } | undefined) : undefined;
      setErrorDetail(typeof body?.raw === "string" ? body.raw : null);
    } finally {
      setLoading(false);
    }
  };

  const accept = () => {
    if (result) onChange(result);
    setAiOpen(false);
    setResult(null);
    setInstruction("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="font-mono text-xs text-muted-foreground">JSON Edit Payload</label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            title="What goes in the payload?"
          >
            <HelpCircle className="h-3.5 w-3.5" /> Help
          </button>
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-primary hover:text-primary/80"
            title="Improve this JSON with AI"
          >
            <Sparkles className="h-3.5 w-3.5" /> ✨ AI format
          </button>
        </div>
      </div>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        spellCheck={false}
        className="font-mono text-xs bg-background ring-1 ring-border/40"
      />

      {/* Live tree preview */}
      <div className="max-h-52 overflow-auto rounded-lg bg-background p-3 ring-1 ring-border/40">
        <JsonTree text={value} />
      </div>

      {/* Help modal */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-lg" showClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" /> JSON edit payload
            </DialogTitle>
            <DialogDescription>How the structured edit payload is used.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              The payload is a JSON object describing the edit. It is sent with the revision and
              fingerprinted, so identical payloads stack as retries of one node.
            </p>
            <p>Common fields:</p>
            <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
              <li><span className="text-foreground">instruction</span> — the edit in words</li>
              <li><span className="text-foreground">kind</span> — &quot;generate&quot; | &quot;edit&quot;</li>
              <li><span className="text-foreground">aspectRatio</span> — e.g. &quot;16:9&quot;</li>
              <li><span className="text-foreground">imageSize</span> — e.g. &quot;2K&quot;</li>
              <li><span className="text-foreground">reference_image_ids</span> — array of library image ids</li>
            </ul>
            <p>Use ✨ AI format to repair invalid JSON or turn a description into a payload.</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI assist modal */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-lg" showClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Improve JSON with AI
            </DialogTitle>
            <DialogDescription>
              Workers AI will repair and reformat your current payload into valid JSON, applying any
              instruction below. Nothing changes until you Accept the result.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="font-mono text-xs text-muted-foreground">
                Instruction (optional)
              </label>
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="e.g. add a 16:9 aspect ratio and set kind to generate"
                className="bg-background ring-1 ring-border/40 text-sm"
              />
            </div>

            {error && (
              <div className="space-y-1.5">
                <div className="rounded-lg bg-destructive/15 p-2 text-xs text-destructive">{error}</div>
                {errorDetail && (
                  <div className="space-y-1">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      Model output
                    </span>
                    <pre className="max-h-40 overflow-auto rounded-lg bg-background p-2 font-mono text-[10px] whitespace-pre-wrap break-words text-muted-foreground ring-1 ring-border/40">
                      {errorDetail}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {!result ? (
              <Button onClick={runAi} disabled={loading} className="w-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Format with AI
              </Button>
            ) : (
              <div className="space-y-2">
                <label className="font-mono text-xs text-muted-foreground">Proposed JSON</label>
                <pre className="max-h-52 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] text-foreground ring-1 ring-border/40">
                  {result}
                </pre>
                <div className="flex gap-2">
                  <Button onClick={accept} className="flex-1 gap-2 bg-primary text-primary-foreground">
                    Accept &amp; overwrite
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setResult(null)}
                    className="flex-1 gap-2 ring-1 ring-border/40"
                  >
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
