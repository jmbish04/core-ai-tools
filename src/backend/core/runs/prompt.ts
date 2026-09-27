/**
 * @fileoverview `buildPromptFor` — the per-provider prompt rewriter, and the
 * whole point of the multi-model run engine. The same user intent is phrased
 * differently for each model BEFORE dispatch, and the exact text a model
 * received is stored on its `model_run_results.prompt_sent` row.
 *
 * PURE ON PURPOSE. No db, no env, no provider — the branch that decides how a
 * model is addressed is the part most likely to be wrong, so it is testable
 * without a provider call (`test/runs.test.ts`).
 *
 * The branch is derived from the registry's CAPABILITY FLAGS, never from a
 * hardcoded model-id list — adding a model to `ai/registry/catalog.ts` must be
 * enough to address it correctly.
 *
 *  - `capabilities.mask_inpainting` — the provider takes a real mask channel, so
 *    the mask travels in-band as an image. The prompt must NOT re-describe the
 *    region: a short, literal edit instruction keeps the model inside the
 *    channel's area. This is OpenAI's gpt-image-2.5 line.
 *  - `capabilities.mask_emulated_only` — no mask parameter exists, so masking is
 *    emulated: the region has to be carried SEMANTICALLY, in words, together
 *    with an explicit "change nothing else" clause.
 *  - `capabilities.blueprint_json || thinking_controllable || interleaved_output`
 *    — the richer Gemini surface. These models consume standing context and an
 *    explicit preservation clause; the models without any of the three (the lite
 *    image model, the whole OpenAI line) do better with one short imperative,
 *    so they get the literal register.
 */

import type { ModelEntry } from "@/backend/ai/registry";

/** One user intent, before it is phrased for any particular model. */
export interface RunIntent {
  /** The user's instruction, verbatim. */
  prompt: string;
  /** True when a source image is being edited, false for prompt-only generation. */
  editing?: boolean;
  /** True when a mask confines the edit. */
  masked?: boolean;
  /** Semantic description of the masked region (`masks.label`), when known. */
  maskLabel?: string | null;
  /** Standing context (folder context, subject notes) for narrative-register models. */
  contextText?: string | null;
}

/** How a model is addressed. Derived from capability flags, never from its id. */
export type PromptRegister = "narrative" | "literal";

/**
 * Which register a model's capability flags put it in.
 *
 * @param model - Registry entry whose `capabilities` decide the register.
 * @returns `"narrative"` for models exposing blueprint JSON, controllable
 *   thinking, or interleaved output; `"literal"` otherwise.
 */
export function promptRegister(model: ModelEntry): PromptRegister {
  const c = model.capabilities;
  return c.blueprint_json || c.thinking_controllable || c.interleaved_output ? "narrative" : "literal";
}

/**
 * Whether this model can be handed the mask as a real provider input.
 *
 * @param model - Registry entry to test.
 * @returns True when `capabilities.mask_inpainting` is set (native mask channel).
 *   False means the mask must be described in the prompt instead.
 */
export function sendsMaskInBand(model: ModelEntry): boolean {
  return model.capabilities.mask_inpainting === true;
}

/**
 * Phrase one intent for one model.
 *
 * @param model - The registry entry being addressed; only its capability flags
 *   are read.
 * @param intent - The user's intent, un-rewritten.
 * @returns The exact prompt text to send that model. Store it on the result row.
 * @throws Never — a model that cannot satisfy the intent at all is rejected
 *   upstream by `assertCapability`, before this is called.
 *
 * @example
 * // native mask channel → short and literal, no region prose
 * buildPromptFor(requireModel("gpt-image-2.5-flare"), { prompt: "make the sofa green", masked: true });
 * // "Edit only the masked area: make the sofa green"
 */
export function buildPromptFor(model: ModelEntry, intent: RunIntent): string {
  const base = intent.prompt.trim();
  if (!base && !intent.masked) return base;

  const register = promptRegister(model);
  const context = intent.contextText?.trim();
  const parts: string[] = [];

  if (intent.masked) {
    if (sendsMaskInBand(model)) {
      // The mask IS an input. Re-describing the region here competes with it.
      parts.push(`Edit only the masked area: ${base}`);
    } else {
      // ponytail: a model with neither mask flag also lands here. That is the
      // safe phrasing, and assertCapability rejects it upstream anyway.
      const region = intent.maskLabel?.trim() || "the selected region";
      parts.push(
        `${base}. Apply this change ONLY to ${region}. Leave every other part of the image exactly as it is — same framing, lighting, colours and subject.`,
      );
    }
  } else {
    parts.push(base);
  }

  if (context) {
    parts.push(register === "narrative" ? `Context: ${context}.` : `(${context})`);
  }

  if (register === "narrative" && intent.editing && !intent.masked) {
    parts.push(
      "Preserve the original composition, lighting, and anything the instruction does not mention.",
    );
  }

  return parts.join(" ");
}
