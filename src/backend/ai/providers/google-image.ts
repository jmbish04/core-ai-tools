/**
 * @fileoverview Google (Gemini) image + understanding adapter against the Gemini
 * Interactions API (`v1beta/interactions`). The same call serves image models
 * (gemini-3.1-flash-image, gemini-3-pro-image, …) — the model id decides the
 * output modality.
 *
 * ROUTING: core-guardian is the ONLY AI source for core-ai-tools (Justin,
 * 2026-10-14). Every call goes through guardian's AI router (`GUARDIAN` RPC,
 * `mode: "gateway"`), which meters, prices and spend-breaks it and holds the
 * provider key. There is no direct-SDK path in this Worker any more.
 *
 * Settled decisions encoded here:
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
 */

import { classifyProviderError, ConfigError, CoreError, ProviderError } from "@/backend/core/errors";
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

/** Project name core-guardian attributes this Worker's spend to. */
const GUARDIAN_PROJECT = "core-ai-tools";

/** What one interaction call returned, and how it got there. */
interface InteractionCall {
  interaction: any;
  /** True when core-guardian's router ran the call (and therefore metered it). */
  viaGuardian: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Run one `interactions.create` through core-guardian's AI router, which meters,
 * prices, and spend-breaks the call before it reaches Gemini. Guardian's gateway
 * mode targets `v1beta/interactions` for google, so the params pass through
 * unchanged apart from `model`, which guardian merges in itself.
 *
 * core-guardian is the ONLY AI source for core-ai-tools (Justin, 2026-10-14), so
 * there is no direct-SDK fallback: an unbound guardian, an unreachable guardian,
 * a 422 "not priceable" and a spend refusal are all errors the caller sees.
 *
 * @throws ConfigError when the GUARDIAN binding is missing; ProviderError (via
 *   classifyProviderError) for any guardian or provider refusal.
 */
async function viaGuardian(env: Env, params: Record<string, unknown>): Promise<InteractionCall> {
  const rpc = env.GUARDIAN as unknown as { run?: (p: unknown) => Promise<unknown> } | undefined;
  if (typeof rpc?.run !== "function") {
    throw new ConfigError("core-guardian is the only AI source for core-ai-tools, and the GUARDIAN binding is not available.");
  }

  const { model, ...input } = params;
  let raw: any;
  try {
    raw = await rpc.run({
      project: GUARDIAN_PROJECT,
      // Required by guardian's runBody (it has no default) — omitting it fails validation.
      importance: "medium",
      provider: "google",
      model,
      mode: "gateway",
      input,
    });
  } catch (err) {
    // Guardian unreachable/misconfigured. Surfaced (retryable if transient) —
    // never sent around guardian.
    throw classifyProviderError("core-guardian router RPC", err);
  }

  if (raw && typeof raw === "object" && "stream" in raw) {
    throw new ProviderError("core-guardian returned a stream for a non-streaming image call.");
  }

  // Guardian wraps the provider payload: { status, body: { …, body: <provider json> } }.
  const outer = (raw?.body ?? raw) as Record<string, unknown> | undefined;
  const status = Number(raw?.status ?? outer?.status ?? 200);
  const interaction = (outer?.body ?? outer) as any;

  if (status >= 400) {
    const detail = typeof interaction === "string" ? interaction : JSON.stringify(interaction ?? {}).slice(0, 400);

    // Every refusal is surfaced — including 422 "not priceable" and a 429
    // "cap would be exceeded: $Infinity" (both mean guardian cannot price this
    // model id; the fix is guardian's pricing lookup, never a call around it).
    throw classifyProviderError(`Gemini via core-guardian (${status})`, Object.assign(new Error(detail), { status }));
  }

  return {
    interaction,
    viaGuardian: true,
    tokensIn: typeof outer?.tokens_in === "number" ? (outer.tokens_in as number) : undefined,
    tokensOut: typeof outer?.tokens_out === "number" ? (outer.tokens_out as number) : undefined,
  };
}

/** One interaction call — through core-guardian only (metered + spend-broken). */
const createInteraction = viaGuardian;

/**
 * Classify only what is not already ours. `viaGuardian` throws classified
 * ProviderErrors and a ConfigError; re-classifying them would double-wrap the
 * message and, because a CoreError carries an HTTP status ≥ 500, wrongly mark a
 * missing binding retryable (sending model fallback after a config problem).
 */
const reclassify = (label: string, err: unknown) => (err instanceof CoreError ? err : classifyProviderError(label, err));

export const googleImageAdapter: ProviderAdapter = {
  provider: "google",

  async generate(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    let conversationLost = false;
    let call: InteractionCall;
    try {
      call = await createInteraction(env, buildParams(req, { withPrevious: true }));
    } catch (err) {
      if (req.previousInteractionId && isLostInteraction(err)) {
        conversationLost = true;
        try {
          call = await createInteraction(env, buildParams(req, { withPrevious: false }));
        } catch (retryErr) {
          throw reclassify("Gemini Interactions", retryErr);
        }
      } else {
        throw reclassify("Gemini Interactions", err);
      }
    }
    const interaction = call.interaction;

    const result = parseInteraction(interaction);
    if (call.viaGuardian) {
      result.servedVia = "guardian";
      result.meteredByGuardian = true;
      // Guardian reports its own token counts; prefer them when the interaction
      // payload did not carry usage.
      result.tokensIn ??= call.tokensIn;
      result.tokensOut ??= call.tokensOut;
    }
    if (!result.outputImageBytes) {
      throw new ProviderError("Gemini Interactions returned no image.", { id: interaction?.id });
    }
    if (conversationLost) result.conversationLost = true;
    // The mask travels as an image part plus a convention instruction, not through
    // a mask parameter — there isn't one. That is emulation, and the revision says
    // so rather than claiming a native channel it never used.
    if (req.maskBase64) result.maskEmulated = true;
    return result;
  },

  async understand(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    // Caption / VQA / detection / segmentation are all prompt-driven text output.
    // thinking_level='minimal' per the docs (improves segmentation). Coordinate
    // conversion (0–1000 → 0–1) for segment masks is handled at the mask boundary.
    const params = buildParams(
      { ...req, thinkingLevel: req.thinkingLevel ?? "minimal" },
      { withPrevious: false },
    );
    delete params.response_format; // understanding wants text back, not a forced image.

    let call: InteractionCall;
    try {
      call = await createInteraction(env, params);
    } catch (err) {
      throw reclassify("Gemini understand", err);
    }

    const result = parseInteraction(call.interaction);
    if (call.viaGuardian) {
      result.servedVia = "guardian";
      result.meteredByGuardian = true;
      result.tokensIn ??= call.tokensIn;
      result.tokensOut ??= call.tokensOut;
    }
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
