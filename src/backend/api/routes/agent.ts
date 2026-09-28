/**
 * @fileoverview `/api/agent` — one turn of the folder conversation.
 *
 * Thin, like every route here: parse → core → serialize. The agent itself lives
 * in `ai/agent/folder-agent.ts`; this exists so the browser can reach it.
 *
 * Two surfaces over the same turn. `/turn` buffers and answers with JSON;
 * `/turn/stream` answers with SSE, emitting the reply as it is written and each
 * tool as it finishes. Both go through `prepareTurn` in the agent module, so the
 * streamed turn cannot quietly become a different agent with different tools.
 *
 * `/turn` is kept rather than replaced: it is what an MCP client or a script
 * wants, and it is the fallback the UI uses when the stream cannot be opened.
 * Only `/turn` is registered with zod-openapi — an SSE response has no JSON
 * schema to declare, and `createRoute`'s return-type contract fights a streamed
 * body.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { runFolderTurn, streamFolderTurn } from "@/backend/ai/agent/folder-agent";

export const agentRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * The turn request, shared by BOTH routes.
 *
 * It lives here rather than inline because `/turn/stream` used to parse its body
 * by hand and cast every field with `as never`, so it silently accepted shapes
 * `/turn` rejects — an unbounded `history`, and entries with roles other than
 * user/assistant, which then go straight into the prompt of a guardian-routed
 * agent holding 15 mutating tools. Both routes are behind `authMiddleware`, so
 * this was never reachable by a stranger; it was still two endpoints disagreeing
 * about their own contract, and the streamed one is what the panel now uses.
 */
const turnBody = z.object({
  /** The folder the user is looking at. Null when they are not in one. */
  folderId: z.string().nullish(),
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .optional(),
  /** Defaults to guardian's `auto` alias, which routes within budget. */
  model: z.string().optional(),
  /**
   * `onboarding` runs the wizard's copilot: no tools (the project
   * folder does not exist yet) and a settled `proposal` in the
   * response for the wizard to write on finish.
   */
  mode: z.enum(["folder", "onboarding"]).optional(),
  /** The wizard's draft so far. Only read in `onboarding` mode. */
  draft: z
    .object({
      name: z.string().nullish(),
      parentFolderName: z.string().nullish(),
      inherited: z
        .object({
          defaultPrompt: z.string().nullish(),
          contextText: z.string().nullish(),
          useCase: z.string().nullish(),
        })
        .optional(),
      useCase: z.string().nullish(),
      scenario: z.string().nullish(),
      defaultPrompt: z.string().nullish(),
      contextText: z.string().nullish(),
      images: z.array(z.object({ title: z.string(), role: z.string() })).max(50).optional(),
      assets: z.array(z.string()).max(50).optional(),
    })
    .optional(),
});

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
            schema: turnBody,

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
      mode: body.mode,
      draft: body.draft as never,
    });
    return c.json(turn);
  },
);

/**
 * The same turn, streamed as Server-Sent Events.
 *
 * Each `data:` line is one `FolderTurnFrame` as JSON. The stream always ends
 * with exactly one `done` or one `error` frame — a client that sees the socket
 * close without either should treat it as a failure, not as an empty reply.
 *
 * Not `c.body(stream)` from a generator directly: the turn must keep running if
 * the client goes away mid-write, otherwise a user closing the tab abandons an
 * agent halfway through renaming their folders. The writer swallows a write
 * failure and lets the generator finish.
 */
agentRouter.post("/api/agent/turn/stream", async (c) => {
  // Validated against the SAME schema as /turn, so the two cannot disagree
  // about what a turn is. A hand-rolled parse here is how they drifted.
  const parsed = turnBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body.", code: "validation" },
      400,
    );
  }
  const body = parsed.data;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const pump = async () => {
    let open = true;
    const send = async (frame: unknown) => {
      if (!open) return;
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      } catch {
        // The client hung up. Keep consuming the turn so the agent's tool calls
        // finish, but stop trying to write.
        open = false;
      }
    };
    try {
      for await (const frame of streamFolderTurn(c.env, {
        folderId: body.folderId ?? null,
        message: body.message,
        history: body.history,
        model: body.model,
        mode: body.mode,
        draft: body.draft as never,
      })) {
        await send(frame);
      }
    } catch (err) {
      await send({
        type: "error",
        message: err instanceof Error ? err.message : "The agent could not be reached.",
      });
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed by the client */
      }
    }
  };

  c.executionCtx.waitUntil(pump());

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Miniflare and some proxies buffer without this, which turns a stream
      // back into one big response at the end — the exact thing being fixed.
      "x-accel-buffering": "no",
    },
  });
});
