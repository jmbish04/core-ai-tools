/**
 * @fileoverview `/api/agent` — one turn of the folder conversation.
 *
 * Thin, like every route here: parse → core → serialize. The agent itself lives
 * in `ai/agent/folder-agent.ts`; this exists so the browser can reach it.
 *
 * Not streamed yet. A turn that calls tools takes seconds, and the folder's
 * WebSocket already shows the work landing as it happens — the tree updates
 * while the reply is still being written — so the reply arriving whole is a
 * smaller gap than it looks. Streaming is a later pass, not a missing piece of
 * this one.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { runFolderTurn } from "@/backend/ai/agent/folder-agent";

export const agentRouter = new OpenAPIHono<{ Bindings: Env }>();

const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };

agentRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/agent/turn",
    tags: ["agent"],
    summary: "Send one message to the folder agent and get its reply",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              /** The folder the user is looking at. Null when they are not in one. */
              folderId: z.string().nullish(),
              message: z.string().min(1),
              history: z
                .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
                .max(40)
                .optional(),
              /** Defaults to guardian's `auto` alias, which routes within budget. */
              model: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: ok,
  }),
  async (c) => {
    const body = c.req.valid("json");
    const turn = await runFolderTurn(c.env, {
      folderId: body.folderId ?? null,
      message: body.message,
      history: body.history,
      model: body.model,
    });
    return c.json(turn);
  },
);
