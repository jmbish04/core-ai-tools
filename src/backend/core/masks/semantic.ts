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
import { fetchImageBase64, uploadImageBytes } from "../images";
import { createMask } from "./masks";
import type { Mask } from "@/backend/db/schema";
import { box2dTo01, bboxCoverageRatio } from "./geometry";
import { rasterizeMaskPng, type BboxGeometry } from "./rasterize";
import { requireImage } from "../library/images";

/** One candidate returned by the segmentation model (already converted to 0–1). */
export interface SegmentCandidate {
  label: string;
  /** The detected region as a normalised 0–1 bounding box. */
  bbox: BboxGeometry;
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

  // The model only emits structured segmentation when the prompt DEMANDS JSON;
  // a bare description ("shower head") returns prose, the understand adapter sees
  // no leading { or [, structured stays undefined, and we'd throw "no regions".
  // Ask for Gemini's documented segmentation shape: a JSON array of
  // { box_2d: [ymin,xmin,ymax,xmax] (0–1000), label }.
  const segmentationPrompt =
    `Segment the following region(s) in this image: ${input.description}. ` +
    `Output ONLY a JSON array. Each element is an object with "box_2d" as ` +
    `[ymin, xmin, ymax, xmax] normalised 0–1000, and "label" as a short string. ` +
    `Return the most relevant region first. If nothing matches, return [].`;

  const out = await dispatch({
    env: ctx.env,
    db: ctx.db,
    capability: "segment",
    model,
    request: {
      model,
      prompt: segmentationPrompt,
      inputImageBase64,
      thinkingLevel: "minimal",
    },
    meta: {
      sessionUuid: input.sessionUuid ?? "library",
      revisionId: "segment",
      surface: input.createdVia ?? "api",
    },
  });

  // Gemini returns [{ box_2d:[ymin,xmin,ymax,xmax], mask?:<png>, label }]. We use
  // box_2d (the bounding rectangle) — a working, honoured region. The per-object
  // `mask` PNG is a crop within the box; compositing it full-frame is the upgrade
  // path. ponytail: box_2d bbox is the lazy-correct v1; fine mask later if needed.
  const structured = out.structured;
  const raw = Array.isArray(structured)
    ? (structured as Array<{ label?: string; box_2d?: number[]; confidence?: number }>)
    : [];
  const candidates: SegmentCandidate[] = raw
    .filter((r) => Array.isArray(r.box_2d) && r.box_2d.length === 4)
    .map((r) => {
      const bbox = box2dTo01(r.box_2d as [number, number, number, number]);
      return {
        label: r.label ?? input.description,
        bbox,
        coverageRatio: bboxCoverageRatio(bbox),
        confidence: r.confidence,
      };
    });

  if (candidates.length === 0) {
    throw new Error(`Segmentation returned no regions for "${input.description}".`);
  }

  // Rasterise the best region to the provider-consumable PNG so the semantic
  // mask actually reaches the model (without a cf_image_id it does nothing).
  const [best, ...alternatives] = candidates;
  const png = await rasterizeMaskPng({
    kind: "bbox",
    geometry: best.bbox,
    sourceWidth: image.width,
    sourceHeight: image.height,
  });
  const up = await uploadImageBytes(ctx.env, png, {
    filename: `mask-semantic-${input.sourceImageId}.png`,
    metadata: { kind: "mask", semantic: input.description },
  });

  const mask = await createMask(ctx, {
    sessionUuid: input.sessionUuid ?? null,
    sourceImageId: input.sourceImageId,
    kind: "semantic",
    geometry: best.bbox,
    cfImageId: up.cfImageId,
    label: best.label,
    coverageRatio: best.coverageRatio,
    state: "proposed",
    createdVia: input.createdVia ?? "api",
  });

  return { mask, alternatives };
}
