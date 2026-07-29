/**
 * @fileoverview `decompose_image` — image → structured JSON blueprint, cached on
 * a revision so later edits can target fields instead of nudging prompts.
 *
 * This is the explicit core landing spot for the §4 capability. It needs a model
 * call, so the implementation lands in Phase 4 alongside the provider/model
 * registry. Stubbed here (rather than omitted) so the seam is visible and typed:
 * Phase 4 replaces the throw with a provider call that writes
 * `revisions.blueprint` and returns the updated row.
 */

import { eq } from "drizzle-orm";

import { revisions } from "@/backend/db/schema";
import type { Revision } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotImplementedError } from "../errors";
import { requireRevision } from "./query";

export interface DecomposeImageInput {
  /** The revision whose input/output image is decomposed; blueprint caches here. */
  revisionId: string;
  /** Optional model override; defaults to the registry default in Phase 4. */
  model?: string;
}

/**
 * Decompose a revision's image into a structured blueprint and cache it on the
 * row. Phase 4 implementation.
 */
export async function decomposeImage(
  ctx: CoreContext,
  input: DecomposeImageInput,
): Promise<Revision> {
  // Existence check runs now so callers get a clean NotFound even pre-Phase-4.
  await requireRevision(ctx, input.revisionId);
  // Phase 4: fetch the image, call the decomposition model via AI Gateway, then:
  //   const [row] = await ctx.db.update(revisions)
  //     .set({ blueprint }).where(eq(revisions.id, input.revisionId)).returning();
  //   return row;
  void revisions;
  void eq;
  throw new NotImplementedError(
    "decomposeImage requires the model/provider layer (Phase 4).",
    { revisionId: input.revisionId },
  );
}
