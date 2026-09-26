/**
 * @fileoverview Dispatch types — the provider-agnostic request/result shapes and
 * the adapter interface. One adapter per provider; the dispatch wrapper is the
 * only caller, so guardian usage emission can't be bypassed.
 */

import type { ModelEntry, Resolution } from "../registry/types";

export type Capability = "generate" | "edit" | "understand" | "video" | "segment";

/** Provider-agnostic generation/edit/understand request. */
export interface ProviderRequest {
  model: ModelEntry;
  prompt: string;
  editPayload?: unknown;
  /** Base64 of the image being edited / understood. */
  inputImageBase64?: string;
  /** Up to model.capabilities.max_reference_images base64 references. */
  referenceImagesBase64?: string[];
  maskBase64?: string;
  maskMode?: "inpaint" | "preserve";
  /** Multi-turn: the parent revision's provider interaction id. */
  previousInteractionId?: string | null;
  resolution?: Resolution;
  aspectRatio?: string;
  thinkingLevel?: "minimal" | "high";
  grounding?: { web?: boolean; imageSearch?: boolean };
  /** When routed through AI Gateway: the metadata to attach (cf-aig-metadata). */
  gateway?: { url: string; metadata: Record<string, string> } | null;
}

/** Provider-agnostic result. */
export interface ProviderResult {
  /** Generated image bytes (generate/edit), if any. */
  outputImageBytes?: ArrayBuffer;
  /** Text output (understand/caption/VQA), if any. */
  outputText?: string;
  /** Structured output (segmentation polygons, blueprint JSON), if any. */
  structured?: unknown;
  tokensIn?: number;
  tokensOut?: number;
  /** Thinking tokens — billed separately; never folded into tokensOut. */
  tokensThinking?: number;
  /** Provider multi-turn handle for the NEXT edit to chain from. */
  providerInteractionId?: string | null;
  /** Whether provider conversation state was lost and inline fallback was used. */
  conversationLost?: boolean;
  /** Grounding: search_suggestions HTML (MUST be rendered — ToS). */
  groundingSearchSuggestions?: string | null;
  groundingCitations?: unknown;
  /** Interim thinking images (stored as revision_artifacts, not library images). */
  thinkingImages?: ArrayBuffer[];
  /** Whether masked editing was emulated (composited) rather than native. */
  maskEmulated?: boolean;
  /** Set by an adapter that routed the call through core-guardian's AI router. */
  servedVia?: "gateway" | "direct" | "guardian";
  /**
   * True when core-guardian already metered this call (its router prices and
   * records spend itself). The dispatch wrapper then SKIPS `emitUsage`, so the
   * call is counted once, not twice.
   */
  meteredByGuardian?: boolean;
}

/** One implementation per provider. */
export interface ProviderAdapter {
  provider: ModelEntry["provider"];
  /** Image generation / editing. */
  generate(env: Env, req: ProviderRequest): Promise<ProviderResult>;
  /** Understanding: caption/VQA/detection/segmentation/blueprint. Optional. */
  understand?(env: Env, req: ProviderRequest): Promise<ProviderResult>;
}
