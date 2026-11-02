/**
 * @fileoverview The co-creator's model calls. core-guardian is the ONLY AI source
 * for core-ai-tools (Justin, 2026-10-14 — docs/decisions/2026-10-14-guardian-
 * breaker-blocks-cocreate.md), so every call goes to guardian's AI router over the
 * `GUARDIAN` RPC binding with NO provider or model pinned: guardian picks a model
 * this project is allowed to use (metered, budgeted, breaker-gated). There is no
 * fallback — a missing binding or a refusal is an error the user sees.
 *
 * JSON outputs are validated with zod. A model that returns the wrong shape is a
 * ProviderError the user sees, never a silently empty graph — the demo returned
 * `[]` on failure, which reads as "nothing to ask" instead of "it broke".
 */

import { z } from "zod";

import type { BeliefGraph } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ConfigError, ProviderError } from "../errors";

/** Project name core-guardian attributes this Worker's spend to. */
const GUARDIAN_PROJECT = "core-ai-tools";

export interface CallOptions {
  instruction: string;
  /** Reference image, base64, when the session has one. */
  imageBase64?: string;
  /** The co-creator session id (or "consultant"); kept for call-site symmetry. */
  sessionId: string;
  op: "graph" | "questions" | "refine" | "consult";
  waitUntil?: (p: Promise<unknown>) => void;
}

type GuardianRpc = { run?: (body: unknown) => Promise<unknown> };

/**
 * Pull the reply text out of whatever guardian returned. Guardian wraps the
 * provider payload (`{ status, body }`, sometimes nested once more), and the
 * payload is chat-completions shaped for the routes it picks.
 *
 * @returns The text, or "" when there is none.
 */
export function guardianReplyText(raw: unknown): string {
  let node: any = raw;
  for (let i = 0; i < 4 && node && typeof node === "object"; i++) {
    const content = node.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((c: any) => c?.text ?? "").join("");
    if (typeof node.output_text === "string") return node.output_text;
    if (typeof node.message?.content === "string") return node.message.content;
    node = node.body;
  }
  return typeof node === "string" ? node : "";
}

/**
 * Run one text call through core-guardian's router.
 *
 * @returns The raw text, parsed JSON (when the reply was JSON) and the model guardian chose.
 * @throws ConfigError when the GUARDIAN binding is missing; ProviderError when
 *   guardian refuses (breaker, budget, policy) or the model returns nothing.
 */
export async function callModel(ctx: CoreContext, o: CallOptions): Promise<{ text: string; structured: unknown; model: string }> {
  const rpc = (ctx.env as unknown as { GUARDIAN?: GuardianRpc }).GUARDIAN;
  if (typeof rpc?.run !== "function") {
    throw new ConfigError("core-guardian is the only AI source for core-ai-tools, and the GUARDIAN binding is not available.");
  }
  const content = o.imageBase64
    ? [
        { type: "text", text: o.instruction },
        { type: "image_url", image_url: { url: `data:image/png;base64,${o.imageBase64}` } },
      ]
    : o.instruction;

  let raw: any;
  try {
    raw = await rpc.run({
      project: GUARDIAN_PROJECT,
      importance: "medium",
      task: `cocreate-${o.op}`,
      ...(o.imageBase64 ? { capabilities: ["vision"] } : {}),
      input: { messages: [{ role: "user", content }] },
    });
  } catch (err) {
    throw new ProviderError(`Co-creator ${o.op}: core-guardian could not be reached (${(err as Error)?.message ?? err}).`, err);
  }
  // Guardian reports the provider's status on the outer or the inner envelope.
  const status = Number(raw?.status ?? raw?.body?.status ?? 200);
  const text = guardianReplyText(raw);
  if (status >= 400) {
    const detail = text || JSON.stringify(raw?.body ?? raw ?? {}).slice(0, 300);
    throw new ProviderError(`Co-creator ${o.op}: core-guardian refused (${status}): ${detail}`);
  }
  if (!text.trim()) throw new ProviderError(`Co-creator ${o.op}: the model returned nothing.`);
  const model = [raw?.provider, raw?.model].filter(Boolean).join("/") || "core-guardian";
  return { text, structured: extractJson(text), model };
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
