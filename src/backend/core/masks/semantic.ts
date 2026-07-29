/**
 * @fileoverview Semantic mask resolution — the ergonomic MCP masking path. A
 * natural-language region ("the kitchen island") is resolved to a raster region
 * via a segmentation pass, persisted as a `masks` row the model can inspect and
 * reuse.
 *
 * Pipeline (§10): send source image + description to the segmentation model with
 * `thinking_level: "minimal"` (docs: improves segmentation) → receive per-object
 * `box_2d` + `mask` polygon normalised 0–1000 → CONVERT to 0–1 at the boundary
 * (geometry.ts) → persist state='proposed' with computed coverage_ratio → return
 * the best match plus alternatives.
 *
 * The segmentation model CALL is the deferred-live seam (understand adapter);
 * everything else — resolution, conversion, coverage, persistence, alternatives —
 * is real.
 */

import { dispatch } from "@/backend/ai/dispatch";
import { resolveModelId, requireModel } from "@/backend/ai/registry";
import type { CoreContext } from "../context";
import { fetchImageBase64 } from "../images";
import { createMask } from "./masks";
import type { Mask } from "@/backend/db/schema";
import { polygon1000To01, polygonCoverageRatio, type NormalizedPolygon } from "./geometry";
import { requireImage } from "../library/images";

/** One candidate returned by the segmentation model (already converted to 0–1). */
export interface SegmentCandidate {
  label: string;
  polygon: NormalizedPolygon;
  coverageRatio: number;
  confidence?: number;
}

export interface CreateSemanticMaskInput {
  sessionUuid?: string | null;
  sourceImageId: string;
  /** Natural-language region description, e.g. "the kitchen island". */
  description: string;
  createdVia?: "ui" | "api" | "mcp";
}

export interface SemanticMaskResult {
  /** The persisted best-match mask (state='proposed'). */
  mask: Mask;
  /** Other candidates the model returned, for the user/model to pick instead. */
  alternatives: SegmentCandidate[];
}

/**
 * Resolve a natural-language region to a proposed mask via segmentation.
 * Best match is persisted; alternatives are returned (not persisted) so the
 * caller can re-run with a different pick.
 */
export async function createSemanticMask(
  ctx: CoreContext,
  input: CreateSemanticMaskInput,
): Promise<SemanticMaskResult> {
  const image = await requireImage(ctx, input.sourceImageId);
  const modelId = await resolveModelId(ctx.db, { taskKey: "segment" });
  const model = requireModel(modelId);
  const inputImageBase64 = await fetchImageBase64(ctx.env, image.cfImageId);

  // Deferred-live: the segmentation call returns raw 0–1000 candidates.
  const out = await dispatch({
    env: ctx.env,
    db: ctx.db,
    capability: "segment",
    model,
    request: {
      model,
      prompt: input.description,
      inputImageBase64,
      thinkingLevel: "minimal",
    },
    meta: {
      sessionUuid: input.sessionUuid ?? "library",
      revisionId: "segment",
      surface: input.createdVia ?? "api",
    },
  });

  // Parse structured candidates (0–1000) → convert → rank by nothing special,
  // taking the model's first as best (it returns most-confident first).
  const raw = (out.structured ?? []) as Array<{
    label?: string;
    mask?: Array<{ x: number; y: number }>;
    confidence?: number;
  }>;
  const candidates: SegmentCandidate[] = raw
    .filter((r) => Array.isArray(r.mask))
    .map((r) => {
      const polygon = polygon1000To01(r.mask!);
      return {
        label: r.label ?? input.description,
        polygon,
        coverageRatio: polygonCoverageRatio(polygon),
        confidence: r.confidence,
      };
    });

  if (candidates.length === 0) {
    throw new Error(`Segmentation returned no regions for "${input.description}".`);
  }

  const [best, ...alternatives] = candidates;
  const mask = await createMask(ctx, {
    sessionUuid: input.sessionUuid ?? null,
    sourceImageId: input.sourceImageId,
    kind: "semantic",
    geometry: best.polygon,
    label: best.label,
    coverageRatio: best.coverageRatio,
    state: "proposed",
    createdVia: input.createdVia ?? "api",
  });

  return { mask, alternatives };
}
