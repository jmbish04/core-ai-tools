/**
 * @fileoverview Compose Pane component for entering image edits.
 * Features:
 *   - Natural language prompt text entry or JSON payload mode toggle.
 *   - Live model selector dropdown (fetches models from `/api/models`).
 *   - Mask mode selection (`none`, `inpaint`, `preserve`) + Mask Brush tool modal trigger.
 *   - Submit edit action (submits to `POST /api/revisions`).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Code,
  Cpu,
  Loader2,
  Paintbrush,
  Sparkles,
  Type,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiSend } from "@/lib/api";
import { JsonPayloadEditor } from "./JsonPayloadEditor";

interface ModelOption {
  id: string;
  provider: string;
  // The registry / `/api/models` returns snake_case (ModelEntry). The previous
  // `displayName` read was always undefined — hence the picker showing only
  // "(google)". Match the wire shape.
  display_name: string;
  deprecated?: boolean;
  capabilities: {
    mask_inpainting: boolean;
    mask_emulated_only?: boolean;
    image_to_image: boolean;
  };
}

interface AttachedMask {
  id: string;
  label?: string | null;
  mode: "inpaint" | "preserve";
}

interface ComposePaneProps {
  sessionUuid: string;
  parentRevisionId: string;
  onEditSubmitted: () => void;
  onOpenMaskBrush: () => void;
  attachedMask: AttachedMask | null;
  onClearMask: () => void;
}

export function ComposePane({
  sessionUuid,
  parentRevisionId,
  onEditSubmitted,
  onOpenMaskBrush,
  attachedMask,
  onClearMask,
}: ComposePaneProps) {
  const [promptText, setPromptText] = useState("");
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonPayload, setJsonPayload] = useState("{}");
  
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("gemini-3.1-flash-image");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch available models from registry. Deprecated models are kept in the
  // registry (history/fallback) but hidden from the picker.
  useEffect(() => {
    apiGet<{ models: ModelOption[] }>("models")
      .then((res) => {
        const live = (res.models ?? []).filter((m) => !m.deprecated);
        if (live.length > 0) {
          setModels(live);
          setSelectedModelId(live[0].id);
        }
      })
      .catch(() => {
        // Fallback default list (current pinned ids).
        setModels([
          {
            id: "gemini-3.1-flash-image",
            provider: "google",
            display_name: "Gemini 3.1 Flash Image",
            capabilities: { mask_inpainting: true, mask_emulated_only: false, image_to_image: true },
          },
          {
            id: "gpt-image-2",
            provider: "openai",
            display_name: "OpenAI GPT Image 2",
            capabilities: { mask_inpainting: true, mask_emulated_only: false, image_to_image: true },
          },
        ]);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptText.trim() && !isJsonMode) return;
    if (attachedMask && selectedModel && !canMask) {
      setError(`${selectedModel.display_name} can't use masks. Pick a mask-capable model or remove the mask.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let editPayloadData: unknown;
      if (isJsonMode) {
        try {
          editPayloadData = JSON.parse(jsonPayload);
        } catch {
          throw new Error("Invalid JSON payload format");
        }
      } else {
        // Plain-text edit: the core requires a non-null payload (it's what gets
        // fingerprinted), so derive it from the instruction.
        editPayloadData = { instruction: promptText.trim() };
      }

      await apiSend("POST", "revisions", {
        sessionUuid,
        parentRevisionId,
        promptText: promptText.trim(),
        editPayload: editPayloadData,
        requestedModel: selectedModelId,
        maskId: attachedMask?.id || null,
        maskMode: attachedMask?.mode || "none",
        createdVia: "ui",
      });

      setPromptText("");
      onEditSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit edit");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedModel = models.find((m) => m.id === selectedModelId);
  // A model can use a mask if it has a native channel OR supports emulation.
  const canMask = Boolean(
    selectedModel?.capabilities.mask_inpainting || selectedModel?.capabilities.mask_emulated_only,
  );
  // Hard block: a mask is attached but the selected model can't handle masks at
  // all. The user must pick a mask-capable model or remove the mask.
  const maskBlocked = Boolean(attachedMask) && Boolean(selectedModel) && !canMask;

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border/40">
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-foreground text-sm">Submit New Edit</h3>
        </div>

        <button
          onClick={() => setIsJsonMode(!isJsonMode)}
          className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <Code className="h-3.5 w-3.5" /> {isJsonMode ? "Switch to Text" : "JSON Payload Mode"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/15 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Prompt Input or JSON Mode */}
        {isJsonMode ? (
          <JsonPayloadEditor value={jsonPayload} onChange={setJsonPayload} />
        ) : (
          <div className="space-y-1">
            <label className="font-mono text-xs text-muted-foreground">
              Natural Language Instruction
            </label>
            <Textarea
              placeholder="e.g. Replace the dark granite countertop with white marble with subtle grey veining..."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={3}
              className="bg-background ring-1 ring-border/40 text-sm"
            />
          </div>
        )}

        {/* Model selector + mask trigger — stacked, each on its own line. */}
        <div className="flex flex-col gap-3 text-xs">
          {/* Model Picker */}
          <div className="space-y-1">
            <label className="font-mono text-muted-foreground flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" /> Target Model
            </label>
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="w-full rounded-lg bg-background p-2 font-mono text-xs text-foreground ring-1 ring-border/40 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name} ({m.provider})
                </option>
              ))}
            </select>
          </div>

          {/* Mask Attachment */}
          <div className="space-y-1">
            <label className="font-mono text-muted-foreground flex items-center gap-1">
              <Paintbrush className="h-3.5 w-3.5" /> Mask Region
            </label>

            {attachedMask ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300 ring-1 ring-emerald-500/30">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono truncate">
                    {attachedMask.label || "Mask attached"} ({attachedMask.mode})
                  </span>
                  <span className="font-mono text-[10px] text-emerald-400/70 truncate" title={attachedMask.id}>
                    id: {attachedMask.id}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={onClearMask}
                  className="shrink-0 text-emerald-300 hover:text-white"
                  title="Remove mask"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={onOpenMaskBrush}
                className="w-full gap-2 justify-start ring-1 ring-border/40 text-xs font-mono text-muted-foreground hover:text-foreground"
              >
                <Paintbrush className="h-3.5 w-3.5 text-primary" /> Open Mask Brush
              </Button>
            )}
          </div>
        </div>

        {/* Capability checks. Hard block if the model can't mask at all;
            otherwise note native vs emulated. */}
        {maskBlocked ? (
          <div className="rounded-lg bg-destructive/15 p-2 text-[11px] font-mono text-destructive ring-1 ring-destructive/30">
            &bull; {selectedModel?.display_name} can&apos;t use masks. Pick a mask-capable model, or remove
            the mask to run this model.
          </div>
        ) : attachedMask && selectedModel && !selectedModel.capabilities.mask_inpainting ? (
          <div className="text-[11px] font-mono text-amber-400">
            &bull; {selectedModel.display_name} has no native mask channel; the masked edit runs via emulation composite.
          </div>
        ) : null}

        {/* Submit button */}
        <Button
          type="submit"
          disabled={submitting || (!promptText.trim() && !isJsonMode) || maskBlocked}
          className="w-full gap-2 bg-primary text-primary-foreground font-medium py-5"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Submit Revision Edit
        </Button>
      </form>
    </div>
  );
}
