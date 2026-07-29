/**
 * @fileoverview `/api/ai` — small Workers AI helpers for the UI. `format-json`
 * repairs/reformats an image-edit JSON payload (optionally following a
 * user instruction) using the `MODEL_DRAFT` text model, and returns ONLY valid
 * JSON so the client can preview + accept/reject it.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const aiRouter = new OpenAPIHono<{ Bindings: Env }>();

const jsonAny = { "application/json": { schema: z.any() } };
const ok = {
  200: { description: "ok", content: jsonAny },
  422: { description: "model did not return valid JSON", content: jsonAny },
};

/** Pull the assistant text out of a Workers AI result across model shapes. */
function extractText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  if (typeof r.response === "string") return r.response;
  if (typeof r.output_text === "string") return r.output_text;
  // OpenAI chat-completions shape.
  const choices = r.choices;
  if (Array.isArray(choices)) {
    const msg = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
    if (typeof msg === "string") return msg;
  }
  // gpt-oss "responses" API: output: [{ type, content: [{ type, text }] }].
  if (Array.isArray(r.output)) {
    const parts: string[] = [];
    for (const item of r.output as unknown[]) {
      const content = (item as { content?: unknown })?.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content as unknown[]) {
          const t = (c as { text?: unknown })?.text;
          if (typeof t === "string") parts.push(t);
        }
      }
    }
    if (parts.length) return parts.join("");
  }
  // Nested { response: { response } } and similar.
  const nested = (r.response as { response?: unknown } | undefined)?.response;
  if (typeof nested === "string") return nested;
  return "";
}

/** JSON.stringify that never throws (circular refs / exotic objects). */
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

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
    const model = (c.env.MODEL_DRAFT as string) || "@cf/openai/gpt-oss-120b";

    const system =
      "You clean up JSON payloads for an AI image-editing tool. Repair invalid JSON, apply the user's instruction if given, and return ONLY the resulting JSON — no prose, no markdown fences. Preserve the author's keys/intent; never invent unrelated fields.";
    const user =
      `Current JSON payload:\n${json || "{}"}\n\n` +
      (instruction?.trim() ? `Instruction: ${instruction.trim()}\n\n` : "") +
      "Return the improved JSON only.";

    // env.AI.run text-generation. Ask for a JSON object; response shape varies by
    // model (plain `.response`, OpenAI chat `.choices`, or the gpt-oss "responses"
    // API `.output[].content[].text`), so extract defensively.
    const raw = (await c.env.AI.run(model as never, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    } as never)) as unknown;

    const text = extractText(raw);
    const formatted = extractJson(text);
    // Validate before returning so the client always gets parseable JSON (or a 422).
    try {
      JSON.parse(formatted);
    } catch {
      return c.json(
        {
          error: "The model did not return valid JSON. Try again or adjust your instruction.",
          raw: (text || safeStringify(raw)).slice(0, 2000),
        },
        422,
      );
    }
    // Pretty-print for the editor.
    return c.json({ formatted: JSON.stringify(JSON.parse(formatted), null, 2) });
  },
);
