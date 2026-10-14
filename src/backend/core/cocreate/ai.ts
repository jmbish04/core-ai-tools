/**
 * @fileoverview The co-creator's model calls. Every one goes through `dispatch`
 * (the single provider choke point: guardian routing + usage emission + error
 * classification) on the `understand` task model — the same text-capable model
 * the rest of the product uses for captioning and blueprints. No new task key:
 * the co-creator's work is understanding a prompt, not producing pixels.
 *
 * JSON outputs are validated with zod. A model that returns the wrong shape is a
 * ProviderError the user sees, never a silently empty graph — the demo returned
 * `[]` on failure, which reads as "nothing to ask" instead of "it broke".
 */

import { z } from "zod";

import { dispatch } from "@/backend/ai/dispatch";
import { requireModel, resolveModelId } from "@/backend/ai/registry";
import type { BeliefGraph } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ProviderError } from "../errors";

export interface CallOptions {
  instruction: string;
  /** Reference image, base64, when the session has one. */
  imageBase64?: string;
  /** For usage attribution: the co-creator session id (or "consultant"). */
  sessionId: string;
  op: "graph" | "questions" | "refine" | "consult";
  waitUntil?: (p: Promise<unknown>) => void;
}

/**
 * Run one understand-model call.
 *
 * @returns The raw text, parsed JSON (when the reply was JSON) and the model id.
 * @throws ProviderError when the model returns nothing.
 */
export async function callModel(ctx: CoreContext, o: CallOptions): Promise<{ text: string; structured: unknown; model: string }> {
  const model = requireModel(await resolveModelId(ctx.db, { taskKey: "understand" }));
  const out = await dispatch({
    env: ctx.env,
    db: ctx.db,
    capability: "understand",
    model,
    request: { model, prompt: o.instruction, inputImageBase64: o.imageBase64, thinkingLevel: "minimal" },
    meta: { sessionUuid: o.sessionId, revisionId: `cocreate-${o.op}-${crypto.randomUUID()}`, surface: "ui" },
    waitUntil: o.waitUntil,
  });
  const text = out.outputText ?? "";
  if (!text.trim() && out.structured === undefined) throw new ProviderError(`Co-creator ${o.op}: the model returned nothing.`);
  return { text, structured: out.structured ?? extractJson(text), model: model.id };
}

/** Last-resort JSON extraction for a reply wrapped in prose. */
export function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// Lenient where the demo was lenient (optional flags default), strict on structure.
const attribute = z.object({
  name: z.string().min(1),
  presence_in_prompt: z.boolean().default(false),
  value: z.array(z.coerce.string()).min(1),
});
export const beliefGraphSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      presence_in_prompt: z.boolean().default(false),
      description: z.string().default(""),
      attributes: z.array(attribute).default([]),
    }),
  ),
  relationships: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        label: z.string(),
        presence_in_prompt: z.boolean().default(false),
        alternatives: z.array(z.string()).optional(),
      }),
    )
    .default([]),
});

export const clarificationsSchema = z
  .array(z.object({ question: z.string().min(1), options: z.array(z.coerce.string()).min(1) }))
  .min(1);

export const consultSchema = z.object({
  advice: z.string(),
  matches: z.array(z.object({ answerId: z.string(), reason: z.string(), howToUse: z.string() })).default([]),
});

/**
 * Validate model JSON against a schema.
 *
 * @throws ProviderError naming the step, with the zod issue, when it does not fit.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, op: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ProviderError(`Co-creator ${op}: model output did not match the expected shape (${r.error.issues[0]?.message ?? "invalid"}).`);
  return r.data;
}

export type ParsedGraph = z.infer<typeof beliefGraphSchema> & BeliefGraph;
