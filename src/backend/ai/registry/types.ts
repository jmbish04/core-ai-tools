/**
 * @fileoverview Model registry types — the declarative capability model. The
 * registry is the SINGLE SOURCE OF TRUTH driving the model picker, the
 * `list_available_models` MCP tool, and `/api/models`; none hardcode a list.
 * Capability flags are enforced before dispatch (a masked-inpaint request on a
 * model whose `mask_inpainting` is false is rejected, naming the models that do).
 */

/** Capability keys a task can require. */
export type TaskKey =
  | "image_generate"
  | "image_edit"
  | "video"
  | "understand"
  | "segment"
  | "decompose";

export type Provider = "google" | "openai" | "workers-ai";

export type Resolution = "512px" | "1K" | "2K" | "4K";

/** Declarative capability flags per model. Extend as providers add features. */
export interface ModelCapabilities {
  text_to_image: boolean;
  image_to_image: boolean;
  /** Native mask-channel inpainting (the provider accepts a mask image). */
  mask_inpainting: boolean;
  /**
   * The model has NO mask-channel — masked editing is EMULATED (semantic prompt
   * phrasing and/or compositing output over the original outside the mask), and
   * the revision is flagged `mask_emulated: true`. Gemini image models are all
   * emulated-only (they have no mask parameter). A masked edit is permitted when
   * `mask_inpainting || mask_emulated_only`.
   */
  mask_emulated_only: boolean;
  multi_reference_image: boolean;
  blueprint_json: boolean;
  grounding_web: boolean;
  grounding_image_search: boolean;
  thinking_controllable: boolean;
  interleaved_output: boolean;
  video_generation: boolean;
  segmentation: boolean;
  /** 0 = no reference images accepted. */
  max_reference_images: number;
  max_resolution: Resolution;
  supported_aspect_ratios: string[];
  /** Approx USD per image, or null (guardian auto-prices). */
  cost_per_image: number | null;
}

export interface ModelEntry {
  /** Provider model id, e.g. "gemini-3.1-flash-image". */
  id: string;
  provider: Provider;
  display_name: string;
  capabilities: ModelCapabilities;
  /** Register-but-never-default: the model is on its way out. */
  deprecated?: boolean;
  /** Tasks this model is a sensible default for (informational; the D1 table is authoritative). */
  default_for?: TaskKey[];
  /** Free-text notes surfaced in the UI / docs. */
  notes?: string;
}
