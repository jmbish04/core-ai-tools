/**
 * @fileoverview Google (Gemini) image + understanding adapter — the official
 * `@google/genai` SDK against the Gemini Interactions API (`ai.interactions.create`,
 * GA), the recommended path over legacy `generateContent`. The same call serves
 * image models (gemini-3.1-flash-image, gemini-3-pro-image, …) — the model id
 * decides the output modality.
 *
 * Usage logging: this adapter returns tokensIn/tokensOut/tokensThinking on the
 * ProviderResult; the dispatch wrapper (../dispatch/index.ts) is the single choke
 * point that emits them to core-guardian after every call — so guardian coverage
 * is structural, not per-call.
 *
 * Settled decisions encoded here:
 *  - Key via utils/secrets → SDK `apiKey` (SDK sends `x-goog-api-key`).
 *  - Multi-turn: pass `previous_interaction_id` (the parent revision's provider
 *    interaction id). If the interaction is lost/expired, retry once WITHOUT it
 *    but WITH the parent image inline, and set `conversationLost`.
 *  - Never set `store=false` on image paths (would break later editing).
 *  - image_size takes the uppercase-K Resolution verbatim ("512px"/"1K"/…).
 *  - Grounding → tools:[{type:"google_search", search_types}]; persist suggestions.
 *  - Thinking tokens returned separately; interim thought images → artifacts.
 *  - Masking: the mask PNG is sent as an input image part alongside the base +
 *    a convention instruction (inpaint = edit inside the white region; preserve =
 *    edit outside it). Gemini image models honor this; the registry marks them
 *    `mask_inpainting: true`. Non-image Gemini models (3.6 Flash, Omni) can't and
 *    are gated by capabilities.
 *  - NO AI Gateway: the Interactions API is not proxyable through Cloudflare AI
 *    Gateway, so calls go direct and usage is logged to core-guardian by the
 *    dispatch choke point (../dispatch/index.ts) — that is the sole usage record.
 */

import { GoogleGenAI } from "@google/genai";

import { getGeminiApiKey } from "@/backend/utils/secrets";
import { classifyProviderError, NotImplementedError, ProviderError } from "@/backend/core/errors";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../dispatch/types";

type InputPart =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string };

/** Trailing instruction (placed AFTER the images so "the mask" is grounded in
 *  the parts just shown). Our mask PNG marks the target region in white. */
function maskInstruction(mode: ProviderRequest["maskMode"]): string {
  const rule =
    mode === "preserve"
      ? "KEEP the white (marked) region exactly as-is and apply the requested edit ONLY to the area OUTSIDE it."
      : "Apply the requested edit ONLY within the white (marked) region and leave every pixel outside it unchanged.";
  return `Act as an explicit inpainting engine. The second image is a binary mask aligned to the first. ${rule} Output only the modified image.`;
}

/** Ordered input parts. For a masked edit the snippet's Type-A order is used —
 *  prompt, base image, mask image, references, then the mask instruction last so
 *  it references the images already shown. Gemini image models honor the mask;
 *  capabilities gate the non-image ones. */
function buildInput(req: ProviderRequest, includeInlineImage: boolean): InputPart[] {
  const parts: InputPart[] = [{ type: "text", text: req.prompt }];
  if (includeInlineImage && req.inputImageBase64) {
    parts.push({ type: "image", mime_type: "image/png", data: req.inputImageBase64 });
  }
  if (req.maskBase64) {
    parts.push({ type: "image", mime_type: "image/png", data: req.maskBase64 });
  }
  const maxRefs = Math.max(0, req.model.capabilities.max_reference_images);
  for (const ref of (req.referenceImagesBase64 ?? []).slice(0, maxRefs)) {
    parts.push({ type: "image", mime_type: "image/png", data: ref });
  }
  if (req.maskBase64) {
    parts.push({ type: "text", text: maskInstruction(req.maskMode) });
  }
  return parts;
}

/** Assemble the interactions.create params. Loosely typed — thinking_level and the
 *  image response_format are SDK-current but not all in the exported param types. */
function buildParams(req: ProviderRequest, opts: { withPrevious: boolean }): Record<string, unknown> {
  const usePrevious = opts.withPrevious && Boolean(req.previousInteractionId);
  const responseFormat: Record<string, unknown> = { type: "image" };
  if (req.resolution) responseFormat.image_size = req.resolution;
  if (req.aspectRatio) responseFormat.aspect_ratio = req.aspectRatio;

  const params: Record<string, unknown> = {
    model: req.model.id,
    // With a live previous_interaction_id the server holds the prior image, so we
    // don't resend it; otherwise the parent image goes inline.
    input: buildInput(req, !usePrevious),
    response_format: responseFormat,
  };
  if (usePrevious) params.previous_interaction_id = req.previousInteractionId;
  if (req.thinkingLevel) params.generation_config = { thinking_level: req.thinkingLevel };
  if (req.grounding?.web || req.grounding?.imageSearch) {
    const search_types: string[] = [];
    if (req.grounding.web) search_types.push("web_search");
    if (req.grounding.imageSearch) search_types.push("image_search");
    params.tools = [{ type: "google_search", search_types }];
  }
  return params;
}

/** Decode base64 → a standalone ArrayBuffer (nodejs_compat Buffer). */
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** True when a thrown SDK error means the referenced prior interaction is gone. */
function isLostInteraction(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  if (e?.status === 404) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("interaction") && (msg.includes("not found") || msg.includes("expired"));
}

/** Pull usage, thinking images, and grounding suggestions off the interaction. */
function parseInteraction(interaction: any): ProviderResult {
  const out: ProviderResult = { providerInteractionId: interaction?.id ?? null };

  if (interaction?.output_image?.data) {
    out.outputImageBytes = b64ToArrayBuffer(interaction.output_image.data);
  }
  if (typeof interaction?.output_text === "string" && interaction.output_text) {
    out.outputText = interaction.output_text;
  }

  const thinkingImages: ArrayBuffer[] = [];
  for (const step of Array.isArray(interaction?.steps) ? interaction.steps : []) {
    if (step?.type === "thought") {
      for (const b of Array.isArray(step.summary) ? step.summary : []) {
        if (b?.type === "image" && typeof b.data === "string") thinkingImages.push(b64ToArrayBuffer(b.data));
      }
    }
    if (step?.type === "google_search_result") {
      const suggestions = (Array.isArray(step.result) ? step.result : [])
        .map((r: any) => r?.search_suggestions)
        .find(Boolean);
      if (suggestions) out.groundingSearchSuggestions = String(suggestions);
    }
  }
  if (thinkingImages.length) out.thinkingImages = thinkingImages;

  const u = interaction?.usage ?? {};
  if (typeof u.total_input_tokens === "number") out.tokensIn = u.total_input_tokens;
  if (typeof u.total_output_tokens === "number") out.tokensOut = u.total_output_tokens;
  if (typeof u.total_thought_tokens === "number") out.tokensThinking = u.total_thought_tokens;

  return out;
}

export const googleImageAdapter: ProviderAdapter = {
  provider: "google",

  async generate(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    const apiKey = await getGeminiApiKey(env);
    if (!apiKey) {
      throw new NotImplementedError(
        "Gemini generate: GEMINI_API_KEY unresolved (set the binding + value).",
      );
    }
    const ai = new GoogleGenAI({ apiKey });

    let conversationLost = false;
    let interaction: any;
    try {
      interaction = await ai.interactions.create(buildParams(req, { withPrevious: true }) as never);
    } catch (err) {
      if (req.previousInteractionId && isLostInteraction(err)) {
        conversationLost = true;
        try {
          interaction = await ai.interactions.create(buildParams(req, { withPrevious: false }) as never);
        } catch (retryErr) {
          throw classifyProviderError("Gemini Interactions", retryErr);
        }
      } else {
        throw classifyProviderError("Gemini Interactions", err);
      }
    }

    const result = parseInteraction(interaction);
    if (!result.outputImageBytes) {
      throw new ProviderError("Gemini Interactions returned no image.", { id: interaction?.id });
    }
    if (conversationLost) result.conversationLost = true;
    // The mask is sent to the model (image part + instruction), so it's applied
    // natively — not a post-hoc composite. Leave maskEmulated false.
    return result;
  },

  async understand(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    const apiKey = await getGeminiApiKey(env);
    if (!apiKey) throw new NotImplementedError("Gemini understand: GEMINI_API_KEY unresolved.");
    const ai = new GoogleGenAI({ apiKey });

    // Caption / VQA / detection / segmentation are all prompt-driven text output.
    // thinking_level='minimal' per the docs (improves segmentation). Coordinate
    // conversion (0–1000 → 0–1) for segment masks is handled at the mask boundary.
    const params = buildParams(
      { ...req, thinkingLevel: req.thinkingLevel ?? "minimal" },
      { withPrevious: false },
    );
    delete params.response_format; // understanding wants text back, not a forced image.

    let interaction: any;
    try {
      interaction = await ai.interactions.create(params as never);
    } catch (err) {
      throw classifyProviderError("Gemini understand", err);
    }

    const result = parseInteraction(interaction);
    if (result.outputText) {
      const trimmed = result.outputText.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          result.structured = JSON.parse(trimmed);
        } catch {
          // not JSON — keep as text.
        }
      }
    }
    return result;
  },
};
