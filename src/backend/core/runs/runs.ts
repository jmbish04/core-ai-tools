/**
 * @fileoverview The multi-model run engine (W2.5) — one intent, N models, run
 * concurrently, compared side by side.
 *
 * Flow: `createModelRun` records the intent plus one `queued` result row per
 * requested model (with that model's REWRITTEN prompt already stored, so the
 * comparison is readable even if execution never finishes). `executeModelRun`
 * fetches the input bytes ONCE, then fans out with `Promise.allSettled` — every
 * model through `dispatch()`, so guardian metering and `classifyProviderError`
 * still apply, and every output registered as a library image in the run's
 * folder so it appears in the folder tree like any other image.
 *
 * PARTIAL FAILURE IS FIRST-CLASS. A model that is unregistered, lacks the
 * capability, or fails at the provider marks ITS OWN result row `failed` and
 * nothing else. The run only throws if it cannot even be read.
 */

import { eq } from "drizzle-orm";

import { dispatch } from "@/backend/ai/dispatch";
import type { ProviderRequest } from "@/backend/ai/dispatch";
import { assertCapability, requireModel } from "@/backend/ai/registry";
import type { CapabilityRequirement, ModelEntry } from "@/backend/ai/registry";
import { modelRunResults, modelRuns } from "@/backend/db/schema";
import type { ModelRun, ModelRunResult } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ValidationError } from "../errors";
import { IMAGE_VARIANTS, fetchImageBase64, uploadImageBytes, variantUrl } from "../images";
import { registerImage } from "../library/images";
import { requireImage } from "../library/images";
import { requireMask } from "../masks";
import { deriveStatus, getModelRun } from "./query";
import { buildPromptFor, sendsMaskInBand } from "./prompt";
import type { RunIntent } from "./prompt";

/** Hard cap on the fan-out — a comparison of more than this is a stress test. */
export const MAX_RUN_MODELS = 6;

export interface CreateModelRunInput {
  prompt: string;
  /** Model ids to fan out to. Duplicates are collapsed; order is preserved. */
  models: string[];
  /** Library image to edit. Omit for prompt-only (text-to-image) comparison. */
  inputImageId?: string | null;
  /** Mask confining the edit. Requires `inputImageId`. */
  maskId?: string | null;
  /** Where every output image is registered. */
  folderId?: string | null;
  /** Standing context handed to narrative-register models. */
  contextText?: string | null;
  createdVia?: "ui" | "api" | "mcp";
}

/** A run plus every model's result row. */
export interface ModelRunWithResults {
  run: ModelRun;
  results: ModelRunResult[];
  /** Derived from the results — the run table stores no status of its own. */
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
}

/**
 * Record an intent and a `queued` result row per model, with each model's
 * rewritten prompt already stored.
 *
 * @param ctx - Core context.
 * @param input - The intent and the models to compare.
 * @returns The run and its queued result rows.
 * @throws ValidationError for an empty prompt, no models, too many models, or a
 *   mask without an input image. NotFoundError if the image or mask is unknown.
 */
export async function createModelRun(
  ctx: CoreContext,
  input: CreateModelRunInput,
): Promise<ModelRunWithResults> {
  const prompt = input.prompt?.trim() ?? "";
  if (!prompt) throw new ValidationError("A prompt is required.");

  const models = [...new Set(input.models ?? [])];
  if (models.length === 0) throw new ValidationError("At least one model id is required.");
  if (models.length > MAX_RUN_MODELS)
    throw new ValidationError(`A run compares at most ${MAX_RUN_MODELS} models (got ${models.length}).`);
  if (input.maskId && !input.inputImageId)
    throw new ValidationError("A mask requires an inputImageId to apply it to.");

  // Resolve the referenced rows now so a bad id is a 404 at create time, not a
  // per-model failure that looks like a model problem.
  if (input.inputImageId) await requireImage(ctx, input.inputImageId);
  const mask = input.maskId ? await requireMask(ctx, input.maskId) : null;

  const intent: RunIntent = {
    prompt,
    editing: Boolean(input.inputImageId),
    masked: Boolean(mask),
    maskLabel: mask?.label ?? null,
    contextText: input.contextText ?? null,
  };

  const [run] = await ctx.db
    .insert(modelRuns)
    .values({
      prompt,
      inputImageId: input.inputImageId ?? null,
      maskId: input.maskId ?? null,
      requestedModels: models,
      folderId: input.folderId ?? null,
      contextText: input.contextText ?? null,
      createdVia: input.createdVia ?? "api",
    })
    .returning();

  const rows = models.map((id) => {
    // An unregistered id still gets a row — it fails as ITS OWN result, so the
    // rest of the comparison still runs.
    const entry = safeModel(id);
    return {
      runId: run.id,
      requestedModel: id,
      promptSent: entry ? buildPromptFor(entry, intent) : prompt,
      // A mask only travels if it has actually been rasterised: a semantic mask
      // sits `proposed` with no cfImageId until it is. Claiming "mask in-band"
      // for one that was never sent makes the comparison read as mask-vs-mask
      // when it was prompt-vs-prompt.
      maskSent: Boolean(mask?.cfImageId) && entry !== null && sendsMaskInBand(entry),
      ...(entry ? {} : { status: "failed" as const, errorCode: "not_found", errorMessage: `Model ${id} is not in the registry.`, completedAt: new Date() }),
    };
  });
  const results = await ctx.db.insert(modelRunResults).values(rows).returning();

  return { run, results, status: deriveStatus(results) };
}

/** Registry lookup that reports "unknown" instead of throwing. */
function safeModel(id: string): ModelEntry | null {
  try {
    return requireModel(id);
  } catch {
    return null;
  }
}

/** The capability every model in this run has to satisfy. */
function requirementFor(intent: { editing: boolean; masked: boolean }): CapabilityRequirement {
  const req: CapabilityRequirement = intent.editing ? { image_to_image: true } : { text_to_image: true };
  if (intent.masked) req.mask_inpainting = true;
  return req;
}

export interface ExecuteModelRunInput {
  runId: string;
  surface?: "ui" | "api" | "mcp";
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Run every queued result of a run concurrently.
 *
 * @param ctx - Core context.
 * @param input - The run id and the calling surface.
 * @returns The run with every result row in a terminal status.
 * @throws NotFoundError if the run does not exist. Never throws for a model
 *   failure — that lands on the model's own result row.
 */
export async function executeModelRun(
  ctx: CoreContext,
  input: ExecuteModelRunInput,
): Promise<ModelRunWithResults> {
  const { run, results } = await getModelRun(ctx, input.runId);
  const surface = input.surface ?? "api";
  // `running` is included deliberately: an isolate evicted mid-fan-out leaves
  // rows in that state, and picking up only `queued` would strand the run as
  // permanently in-flight with no way to retry. Re-running a row that is
  // genuinely still live costs one duplicate provider call and the last write
  // wins; stranding it costs the whole comparison.
  const pending = results.filter((r) => r.status === "queued" || r.status === "running");
  if (pending.length === 0) return { run, results, status: deriveStatus(results) };

  const editing = Boolean(run.inputImageId);
  const masked = Boolean(run.maskId);
  const req = requirementFor({ editing, masked });

  // Fetched once, shared by every model — N models must not mean N downloads.
  const inputImageBase64 = run.inputImageId
    ? await fetchImageBase64(ctx.env, (await requireImage(ctx, run.inputImageId)).cfImageId)
    : undefined;
  let maskBase64: string | undefined;
  if (run.maskId) {
    const mask = await requireMask(ctx, run.maskId);
    if (mask.cfImageId) maskBase64 = await fetchImageBase64(ctx.env, mask.cfImageId);
  }

  // ponytail: unbounded fan-out is fine at MAX_RUN_MODELS (6); add a limiter if
  // that cap is raised or providers start 429ing on the burst.
  await Promise.allSettled(
    pending.map((r) =>
      runOne(ctx, { run, result: r, req, editing, inputImageBase64, maskBase64, surface, waitUntil: input.waitUntil }),
    ),
  );

  return getModelRun(ctx, run.id);
}

interface RunOneInput {
  run: ModelRun;
  result: ModelRunResult;
  req: CapabilityRequirement;
  editing: boolean;
  inputImageBase64?: string;
  maskBase64?: string;
  surface: "ui" | "api" | "mcp";
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Execute ONE model of a run and write its terminal result row. Every exit path
 * — success, capability rejection, provider failure — updates the row, so a
 * settled promise always means the row is terminal.
 */
async function runOne(ctx: CoreContext, i: RunOneInput): Promise<void> {
  const { result, run } = i;
  const started = Date.now();
  await ctx.db.update(modelRunResults).set({ status: "running" }).where(eq(modelRunResults.id, result.id));

  try {
    // Capability enforcement is per model: one model lacking the flag rejects
    // itself, it does not downgrade or abort the comparison.
    const model = assertCapability(result.requestedModel, i.req);

    const request: ProviderRequest = {
      model,
      prompt: result.promptSent,
      inputImageBase64: i.inputImageBase64,
      // Only a native mask channel receives the mask as bytes; for an emulated
      // model the region is already carried in `promptSent`.
      maskBase64: sendsMaskInBand(model) ? i.maskBase64 : undefined,
      maskMode: sendsMaskInBand(model) && i.maskBase64 ? "inpaint" : undefined,
    };

    console.log(`[run] ${run.id} ${result.requestedModel} dispatching (${result.promptSent.length} chars)`);
    const out = await dispatch({
      env: ctx.env,
      db: ctx.db,
      capability: i.editing ? "edit" : "generate",
      model,
      request,
      // A run is not a session; the result id is the operation id guardian sees.
      meta: { sessionUuid: "", revisionId: result.id, surface: i.surface },
      waitUntil: i.waitUntil,
    });
    if (!out.outputImageBytes) throw new ValidationError("Provider returned no image bytes.");

    const uploaded = await uploadImageBytes(ctx.env, out.outputImageBytes, {
      filename: `run-${run.id}-${result.requestedModel}.png`,
    });
    const image = await registerImage(ctx, {
      cfImageId: uploaded.cfImageId,
      deliveryUrl: await variantUrl(ctx.env, uploaded.cfImageId, IMAGE_VARIANTS.FULL),
      folderId: run.folderId,
      originalFilename: `run-${run.id}-${result.requestedModel}.png`,
      description: result.promptSent,
      contentType: "image/png",
      kind: "generated",
      uploadedVia: i.surface,
    });

    await ctx.db
      .update(modelRunResults)
      .set({
        status: "succeeded",
        servedModel: out.servedModel,
        outputImageId: image.id,
        latencyMs: Date.now() - started,
        costUsd: model.capabilities.cost_per_image,
        tokensIn: out.tokensIn ?? null,
        tokensOut: out.tokensOut ?? null,
        tokensThinking: out.tokensThinking ?? null,
        completedAt: new Date(),
      })
      .where(eq(modelRunResults.id, result.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[run] ${run.id} ${result.requestedModel} failed: ${message}`);
    await ctx.db
      .update(modelRunResults)
      .set({
        status: "failed",
        latencyMs: Date.now() - started,
        errorCode: (err as { code?: string })?.code ?? "dispatch_error",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(modelRunResults.id, result.id));
  }
}

/**
 * Create a run and execute it — the one call a comparison surface needs.
 *
 * @param ctx - Core context.
 * @param input - The intent and the models to compare.
 * @returns The finished run with every model's result.
 */
export async function compareModels(
  ctx: CoreContext,
  input: CreateModelRunInput & { waitUntil?: (p: Promise<unknown>) => void },
): Promise<ModelRunWithResults> {
  const created = await createModelRun(ctx, input);
  return executeModelRun(ctx, {
    runId: created.run.id,
    surface: input.createdVia ?? "api",
    waitUntil: input.waitUntil,
  });
}
