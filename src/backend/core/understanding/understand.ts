/**
 * @fileoverview Image understanding core — caption / VQA / classify / detect via
 * the `understand` task model (`gemini-3.6-flash`). Segmentation is NOT here — it
 * goes through `createSemanticMask` (it produces a mask, not a result row).
 * `decompose_image` (structured blueprint) also rides this primitive.
 *
 * The model CALL is the deferred-live seam (understand adapter). Resolution +
 * persistence are real.
 */

import { dispatch } from "@/backend/ai/dispatch";
import { requireModel, resolveModelId } from "@/backend/ai/registry";
import { understandingResults } from "@/backend/db/schema";
import type { UnderstandingResult } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { fetchImageBase64 } from "../images";
import { requireImage } from "../library/images";

export type UnderstandKind = "caption" | "vqa" | "classify" | "detect";

export interface UnderstandInput {
  imageId: string;
  kind: UnderstandKind;
  /** VQA question or classify label set. */
  query?: string | null;
}

/** Run an understanding pass and persist the result. */
export async function understandImage(
  ctx: CoreContext,
  input: UnderstandInput,
): Promise<UnderstandingResult> {
  const image = await requireImage(ctx, input.imageId);
  const modelId = await resolveModelId(ctx.db, { taskKey: "understand" });
  const model = requireModel(modelId);
  const inputImageBase64 = await fetchImageBase64(ctx.env, image.cfImageId);

  const out = await dispatch({
    env: ctx.env,
    db: ctx.db,
    capability: "understand",
    model,
    request: { model, prompt: input.query ?? input.kind, inputImageBase64, thinkingLevel: "minimal" },
    meta: { sessionUuid: "library", revisionId: "understand", surface: "api" },
  });

  const [row] = await ctx.db
    .insert(understandingResults)
    .values({
      sourceImageId: input.imageId,
      kind: input.kind,
      query: input.query ?? null,
      result: out.structured ?? out.outputText ?? null,
      model: model.id,
    })
    .returning();
  return row;
}
