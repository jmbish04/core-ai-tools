/**
 * @fileoverview Types for the comparison view, mirrored from `GET /api/models`
 * and `POST /api/runs`.
 */

/** A registry model as `/api/models` returns it. */
export interface ModelEntry {
  id: string;
  provider: string;
  display_name: string;
  deprecated?: boolean;
  notes?: string;
  capabilities: {
    text_to_image: boolean;
    image_to_image: boolean;
    mask_inpainting: boolean;
    mask_emulated_only: boolean;
    max_resolution: string;
    cost_per_image: number | null;
  };
}

/** One model's outcome within a run. */
export interface RunResult {
  requestedModel: string;
  servedModel: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  /** The exact text this model received — the reason the comparison is readable. */
  promptSent: string;
  maskSent: boolean;
  outputImageId: string | null;
  /** Joined in by the API so a pane does not resolve its own image. */
  deliveryUrl: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface RunResponse {
  run: { id: string; prompt: string; requestedModels: string[]; createdAt: string };
  results: RunResult[];
  /** Derived from the results — `partial` when some models failed. */
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
}

/** Cloudflare Images URLs end in a variant; swap the last segment, never append. */
export function variant(deliveryUrl: string, name: "thumb" | "full"): string {
  return deliveryUrl.replace(/\/[^/]+$/, `/${name}`);
}
