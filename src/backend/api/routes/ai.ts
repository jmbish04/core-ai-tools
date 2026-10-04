/**
 * @fileoverview `/api/ai` — small LLM helpers for the UI, routed through
 * core-guardian. `format-json` repairs/reformats an image-edit JSON payload
 * (optionally following a user instruction) and returns ONLY valid JSON so the
 * client can preview and accept/reject it.
 *
 * The model comes from `getChatModel`, the single guardian door. This route
 * must never call a provider or `env.AI` directly: that escapes budget and
 * breaker checks, and `env.AI` in particular cannot be metered per-account.
 */

import { generateText } from "ai";

import { getChatModel } from "@/backend/ai/providers/ai-sdk";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const aiRouter = new OpenAPIHono<{ Bindings: Env }>();

const jsonAny = { "application/json": { schema: z.any() } };
const ok = {
  200: { description: "ok", content: jsonAny },
  422: { description: "model did not return valid JSON", content: jsonAny },
};

/** Pull the assistant text out of a Workers AI result across model shapes. */
/** Strip markdown code fences and grab the outermost JSON object/array. */
function extractJson(text: string): string {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end >= 0) t = t.slice(0, end + 1);
  return t.trim();
}

aiRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/ai/format-json",
    tags: ["ai"],
    responses: ok,
  }),
  async (c) => {
    const { json, instruction } = await c.req.json<{ json: string; instruction?: string }>();

    const system =
      "You clean up JSON payloads for an AI image-editing tool. Repair invalid JSON, apply the user's instruction if given, and return ONLY the resulting JSON — no prose, no markdown fences. Preserve the author's keys/intent; never invent unrelated fields.";
    const user =
      `Current JSON payload:\n${json || "{}"}\n\n` +
      (instruction?.trim() ? `Instruction: ${instruction.trim()}\n\n` : "") +
      "Return the improved JSON only.";

    // Routed through core-guardian via `getChatModel`, which is the ONLY door for
    // an LLM call in this Worker. It used to be `c.env.AI.run(...)`, which was
    // account-implicit, always billed the paid account, and could not be metered
    // per-account — the hole an unattended job bills the card through.
    //
    // Going through the AI SDK also deletes the response-shape guessing this
    // route used to need: `env.AI.run` returned `.response`, OpenAI `.choices`,
    // or the gpt-oss `.output[].content[].text` depending on the model, so two
    // helpers existed purely to dig the text out. `generateText` normalises it.
    const { text } = await generateText({
      model: await getChatModel(c.env),
      system,
      prompt: user,
    });

    const formatted = extractJson(text);
    // Validate before returning so the client always gets parseable JSON (or a 422).
    try {
      JSON.parse(formatted);
    } catch {
      return c.json(
        {
          error: "The model did not return valid JSON. Try again or adjust your instruction.",
          raw: text.slice(0, 2000),
        },
        422,
      );
    }
    // Pretty-print for the editor.
    return c.json({ formatted: JSON.stringify(JSON.parse(formatted), null, 2) });
  },
);
