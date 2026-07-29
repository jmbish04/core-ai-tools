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

    // env.AI.run text-generation. Response shape varies by model; coerce to text.
    const raw = (await c.env.AI.run(model as never, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    } as never)) as unknown;
    const text =
      typeof raw === "string"
        ? raw
        : ((raw as { response?: string; output_text?: string })?.response ??
          (raw as { output_text?: string })?.output_text ??
          "");

    const formatted = extractJson(String(text));
    // Validate before returning so the client always gets parseable JSON (or a 422).
    try {
      JSON.parse(formatted);
    } catch {
      return c.json(
        { error: "The model did not return valid JSON. Try again or adjust your instruction.", raw: String(text).slice(0, 1000) },
        422,
      );
    }
    // Pretty-print for the editor.
    return c.json({ formatted: JSON.stringify(JSON.parse(formatted), null, 2) });
  },
);
