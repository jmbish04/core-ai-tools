/**
 * @fileoverview `generateImages` — prompt-only (text-to-image) generation into the
 * library. Until now every image had to come from an upload; this closes that gap
 * (the `image_generate` task and `text_to_image` capability existed but nothing
 * used them). Shape borrowed from gemini-cli-extensions/nanobanana's
 * `generate_image`: one prompt → N variations (count / styles / variations) plus
 * icon / pattern / diagram / story presets.
 *
 * Optimisations over the original:
 *  - Independent variations render in PARALLEL (nanobanana loops sequentially).
 *  - Story frames chain `previousInteractionId`, so the provider sees the prior
 *    frame and keeps characters/style consistent (the original only appended
 *    "step N of M" text to unrelated calls).
 *  - Partial success is first-class: each failure is reported per prompt; the
 *    call only throws when NOTHING rendered. An auth failure short-circuits.
 *  - Outputs land in the library (kind='generated', prompt stored as
 *    description), so any result can seed `create_session` for editing.
 *
 * Every provider call goes through `dispatch`, so guardian usage emission and
 * error classification are the same as for edits.
 */

import { dispatch } from "@/backend/ai/dispatch";
import type { ProviderRequest } from "@/backend/ai/dispatch";
import { assertCapability, resolveModelId } from "@/backend/ai/registry";
import type { CapabilityRequirement, Resolution } from "@/backend/ai/registry";
import type { LibraryImage } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ProviderError, ValidationError } from "../errors";
import { IMAGE_VARIANTS, uploadImageBytes, variantUrl } from "../images";
import { registerImage } from "../library/images";
import { expandPrompts } from "./prompts";
import type { ExpandInput } from "./prompts";

export interface GenerateImagesInput extends ExpandInput {
  /** Explicit model id; otherwise the `image_generate` task default. */
  requestedModel?: string;
  aspectRatio?: string;
  resolution?: Resolution;
  folderId?: string | null;
  surface?: "ui" | "api" | "mcp";
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface GenerateImagesResult {
  model: string;
  images: Array<{ index: number; prompt: string; image: LibraryImage }>;
  failures: Array<{ index: number; prompt: string; error: string }>;
}

/**
 * Render every expanded prompt and register each output as a library image.
 *
 * @throws ValidationError for a bad count / unresolvable model; CapabilityError
 *   when the model cannot do text-to-image at the requested size/ratio;
 *   ProviderError when no image at all could be produced.
 */
export async function generateImages(ctx: CoreContext, input: GenerateImagesInput): Promise<GenerateImagesResult> {
  if (!input.prompt?.trim()) throw new ValidationError("A prompt is required.");
  let prompts: string[];
  try {
    prompts = expandPrompts(input);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }

  const modelId = await resolveModelId(ctx.db, { taskKey: "image_generate", explicit: input.requestedModel });
  const req: CapabilityRequirement = { text_to_image: true };
  if (input.aspectRatio) req.aspect_ratio = input.aspectRatio;
  if (input.resolution) req.resolution = input.resolution;
  const model = assertCapability(modelId, req);

  const surface = input.surface ?? "api";
  const operationId = `generate-${crypto.randomUUID()}`;

  const renderOne = async (prompt: string, index: number, previousInteractionId: string | null) => {
    const request: ProviderRequest = {
      model,
      prompt,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      previousInteractionId,
    };
    const out = await dispatch({
      env: ctx.env,
      db: ctx.db,
      capability: "generate",
      model,
      request,
      meta: { sessionUuid: "", revisionId: `${operationId}-${index}`, surface },
      waitUntil: input.waitUntil,
    });
    if (!out.outputImageBytes) throw new ProviderError("Provider returned no image bytes.");
    const uploaded = await uploadImageBytes(ctx.env, out.outputImageBytes, { filename: `${operationId}-${index}.png` });
    const image = await registerImage(ctx, {
      cfImageId: uploaded.cfImageId,
      deliveryUrl: await variantUrl(ctx.env, uploaded.cfImageId, IMAGE_VARIANTS.FULL),
      folderId: input.folderId ?? null,
      originalFilename: `${operationId}-${index}.png`,
      description: prompt,
      contentType: "image/png",
      kind: "generated",
      uploadedVia: surface,
    });
    return { image, interactionId: out.providerInteractionId ?? null };
  };

  const result: GenerateImagesResult = { model: model.id, images: [], failures: [] };
  const fail = (index: number, err: unknown) =>
    result.failures.push({ index, prompt: prompts[index], error: err instanceof Error ? err.message : String(err) });
  const isAuth = (err: unknown) => /authentication/i.test((err as Error)?.message ?? "");

  if (input.preset === "story") {
    // Sequential by necessity: each frame continues the previous interaction.
    let previous: string | null = null;
    for (const [i, prompt] of prompts.entries()) {
      try {
        const r = await renderOne(prompt, i, previous);
        result.images.push({ index: i, prompt, image: r.image });
        previous = r.interactionId ?? previous;
      } catch (err) {
        fail(i, err);
        if (isAuth(err)) break;
      }
    }
  } else {
    // ponytail: unbounded fan-out is fine at MAX_GENERATE_COUNT (8); add a
    // concurrency limiter if that cap is raised or providers start 429ing.
    const settled = await Promise.allSettled(prompts.map((p, i) => renderOne(p, i, null)));
    settled.forEach((s, i) =>
      s.status === "fulfilled" ? result.images.push({ index: i, prompt: prompts[i], image: s.value.image }) : fail(i, s.reason),
    );
  }

  if (result.images.length === 0) {
    const first = result.failures[0]?.error ?? "no image data returned";
    throw new ProviderError(`Image generation failed for all ${prompts.length} prompt(s): ${first}`, result.failures);
  }
  return result;
}
