/**
 * @fileoverview `executeRevision` — the Phase-4 dispatch orchestrator that turns
 * a `queued` revision into a `succeeded`/`failed` one. This is the seam Phase 2
 * left for model dispatch. The whole flow is real; only the provider HTTP call
 * (inside the adapter) is a deferred-live seam.
 *
 * Flow: mark running → resolve model (explicit → session override → task default)
 * → enforce capabilities (reject, never downgrade) → fetch input bytes → dispatch
 * with multi-turn wiring → on TRANSPORT failure fall back to a capable model
 * (never on content-policy/validation) → upload output + thinking artifacts →
 * mark succeeded with full provenance (served model, interaction id, grounding,
 * served_via).
 */

import { eq } from "drizzle-orm";

import { libraryImages, revisionArtifacts, sessions } from "@/backend/db/schema";
import type { Revision } from "@/backend/db/schema";
import { dispatch } from "@/backend/ai/dispatch";
import type { ProviderRequest } from "@/backend/ai/dispatch";
import {
  assertCapability,
  pickFallbackModel,
  resolveModelId,
  requireModel,
} from "@/backend/ai/registry";
import type { CapabilityRequirement, TaskKey } from "@/backend/ai/registry";
import type { CoreContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { fetchImageBase64, uploadImageBytes, variantUrl, IMAGE_VARIANTS } from "../images";
import { requireImage } from "../library/images";
import { requireMask } from "../masks";
import { markFailed, markRunning, markSucceeded } from "./lifecycle";
import { requireRevision } from "./query";

export interface ExecuteInput {
  revisionId: string;
  surface: "ui" | "api" | "mcp";
  waitUntil?: (p: Promise<unknown>) => void;
}

/** A provider error is retryable (→ fallback) only if it marks itself so. */
function isRetryable(err: unknown): boolean {
  return Boolean((err as { retryable?: boolean } | null)?.retryable);
}

/** Derive the capability requirement a model must satisfy for this revision. */
function requirementFor(rev: Revision, maskMode: string): CapabilityRequirement {
  const payload = (rev.editPayload ?? {}) as Record<string, unknown>;
  const req: CapabilityRequirement = { image_to_image: true };
  if (maskMode !== "none") req.mask_inpainting = true;
  if (typeof payload.resolution === "string")
    req.resolution = payload.resolution as CapabilityRequirement["resolution"];
  if (typeof payload.aspect_ratio === "string") req.aspect_ratio = payload.aspect_ratio;
  if (Array.isArray(payload.reference_image_ids))
    req.multi_reference_count = payload.reference_image_ids.length;
  const grounding = payload.grounding as { web?: boolean; image_search?: boolean } | undefined;
  if (grounding?.web) req.grounding_web = true;
  if (grounding?.image_search) req.grounding_image_search = true;
  return req;
}

/** Execute a queued revision against its resolved model. */
export async function executeRevision(ctx: CoreContext, input: ExecuteInput): Promise<Revision> {
  const rev = await requireRevision(ctx, input.revisionId);
  if (rev.status !== "queued") {
    throw new ValidationError(`Only a queued revision executes (status '${rev.status}').`);
  }

  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUuid, rev.sessionUuid))
    .limit(1);
  if (!session) throw new NotFoundError(`Session ${rev.sessionUuid} not found.`);

  await markRunning(ctx, rev.id);

  try {
    // 1. Resolve the model — real edits are the `image_edit` task.
    const taskKey: TaskKey = "image_edit";
    const modelId = await resolveModelId(ctx.db, {
      taskKey,
      explicit: rev.requestedModel,
      sessionOverrides: session.modelOverrides,
    });

    // 2. Capability enforcement (throws CapabilityError naming capable models).
    const req = requirementFor(rev, rev.maskMode);
    let model = assertCapability(modelId, req);

    // 3. Fetch input bytes + parent interaction id (multi-turn).
    const [inputImg] = await ctx.db
      .select()
      .from(libraryImages)
      .where(eq(libraryImages.id, rev.inputImageId))
      .limit(1);
    if (!inputImg) throw new NotFoundError(`Input image ${rev.inputImageId} not found.`);
    const inputImageBase64 = await fetchImageBase64(ctx.env, inputImg.cfImageId);

    const parent = rev.parentRevisionId
      ? await requireRevision(ctx, rev.parentRevisionId)
      : null;

    let maskBase64: string | undefined;
    if (rev.maskId) {
      const mask = await requireMask(ctx, rev.maskId);
      if (mask.cfImageId) maskBase64 = await fetchImageBase64(ctx.env, mask.cfImageId);
    }

    // Additional reference images, already ordered base → object → style in
    // editPayload.reference_image_ids (create.ts). Resolve each → base64 so they
    // reach the provider as image blocks after the base image. Without this the
    // refs are recorded but never sent.
    let referenceImagesBase64: string[] | undefined;
    const refIds = (rev.editPayload as { reference_image_ids?: unknown } | null)?.reference_image_ids;
    if (Array.isArray(refIds) && refIds.length > 0) {
      referenceImagesBase64 = [];
      for (const rid of refIds) {
        const refImg = await requireImage(ctx, String(rid));
        referenceImagesBase64.push(await fetchImageBase64(ctx.env, refImg.cfImageId));
      }
    }

    const providerRequest: ProviderRequest = {
      model,
      prompt: rev.promptText,
      editPayload: rev.editPayload,
      inputImageBase64,
      maskBase64,
      referenceImagesBase64,
      maskMode: rev.maskMode === "none" ? undefined : (rev.maskMode as "inpaint" | "preserve"),
      previousInteractionId: parent?.providerInteractionId ?? null,
    };

    // 4. Dispatch with transport-failure fallback (never on policy/validation).
    let out;
    let fallbackReason: string | null = null;
    try {
      out = await dispatch({
        env: ctx.env,
        db: ctx.db,
        capability: "edit",
        model,
        request: providerRequest,
        meta: { sessionUuid: rev.sessionUuid, revisionId: rev.id, surface: input.surface },
        waitUntil: input.waitUntil,
      });
    } catch (err) {
      if (!isRetryable(err)) throw err;
      const fb = pickFallbackModel(model.id, req);
      if (!fb) throw err;
      fallbackReason = `${model.id} failed (${err instanceof Error ? err.message : "transport"}); fell back to ${fb.id}`;
      model = requireModel(fb.id);
      out = await dispatch({
        env: ctx.env,
        db: ctx.db,
        capability: "edit",
        model,
        request: { ...providerRequest, model },
        meta: { sessionUuid: rev.sessionUuid, revisionId: rev.id, surface: input.surface },
        waitUntil: input.waitUntil,
      });
    }

    if (!out.outputImageBytes) {
      throw new ValidationError("Provider returned no image bytes.");
    }

    // 5. Upload output + register a generated library image.
    const uploaded = await uploadImageBytes(ctx.env, out.outputImageBytes, {
      filename: `rev-${rev.id}.png`,
    });
    const deliveryUrl = await variantUrl(ctx.env, uploaded.cfImageId, IMAGE_VARIANTS.FULL);
    const [outputRow] = await ctx.db
      .insert(libraryImages)
      .values({
        cfImageId: uploaded.cfImageId,
        deliveryUrl,
        kind: "generated",
        uploadedVia: input.surface === "ui" ? "ui" : input.surface === "mcp" ? "mcp" : "api",
      })
      .returning();

    // 6. Store interim thinking images as artifacts (not library images).
    for (const [i, imgBytes] of (out.thinkingImages ?? []).entries()) {
      const art = await uploadImageBytes(ctx.env, imgBytes, { filename: `rev-${rev.id}-think-${i}.png` });
      await ctx.db.insert(revisionArtifacts).values({
        revisionId: rev.id,
        kind: "thinking_image",
        cfImageId: art.cfImageId,
        metadata: { step: i },
      });
    }

    // 7. Mark succeeded with full provenance.
    return markSucceeded(ctx, {
      revisionId: rev.id,
      outputImageId: outputRow.id,
      servedModel: out.servedModel,
      provider: model.provider,
      fallbackReason,
      maskEmulated: out.maskEmulated,
      tokenUsage: {
        tokensIn: out.tokensIn,
        tokensOut: out.tokensOut,
        tokensThinking: out.tokensThinking,
      },
      providerInteractionId: out.providerInteractionId,
      providerConversationLost: out.conversationLost,
      servedVia: out.servedVia,
      groundingSearchSuggestions: out.groundingSearchSuggestions,
      groundingCitations: out.groundingCitations,
    });
  } catch (err) {
    // Any failure marks the revision failed (it stays forkable). Re-throw so the
    // caller sees it too.
    await markFailed(ctx, {
      revisionId: rev.id,
      errorCode: (err as { code?: string })?.code ?? "dispatch_error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
