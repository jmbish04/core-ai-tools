/**
 * The SSE frame reader.
 *
 * `postSse` is where a streamed agent turn becomes frames, and the thing that
 * actually goes wrong here is buffering: a `data:` line is not guaranteed to
 * arrive in one chunk. Code that parses each chunk as a frame works perfectly
 * until a reply is long enough to be split across two reads — that is, exactly
 * when the streaming is doing anything worth watching — and then it drops text
 * silently, with no error anywhere.
 *
 * So the cases below are about chunk boundaries, not about the happy path.
 */

import { describe, expect, it } from "vitest";

import { postSse } from "@/lib/sse";

/** Serve `chunks` as one SSE response body, one read per chunk. */
function serve(chunks: string[], init: ResponseInit = {}): void {
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" }, ...init },
    )) as typeof fetch;
}

async function collect(): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const frame of postSse("/api/agent/turn/stream", { message: "hi" })) out.push(frame);
  return out;
}

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

describe("postSse", () => {
  it("reads frames that arrive one per chunk", async () => {
    serve([frame({ type: "delta", text: "a" }), frame({ type: "done" })]);
    expect(await collect()).toEqual([{ type: "delta", text: "a" }, { type: "done" }]);
  });

  it("reassembles a frame split across chunks", async () => {
    // The failure this test exists for: the reply is long, the frame is split,
    // and a per-chunk parser drops it without a sound.
    const whole = frame({ type: "delta", text: "a long piece of the reply" });
    for (const cut of [5, 12, whole.length - 3, whole.length - 1]) {
      serve([whole.slice(0, cut), whole.slice(cut)]);
      expect({ cut, frames: await collect() }).toEqual({
        cut,
        frames: [{ type: "delta", text: "a long piece of the reply" }],
      });
    }
  });

  it("reads several frames delivered in one chunk", async () => {
    serve([frame({ type: "delta", text: "a" }) + frame({ type: "delta", text: "b" }) + frame({ type: "done" })]);
    expect(await collect()).toHaveLength(3);
  });

  it("skips a frame it cannot parse instead of ending the turn", async () => {
    // One malformed frame must not cost the user the rest of a live reply.
    serve([frame({ type: "delta", text: "a" }), "data: {not json\n\n", frame({ type: "done" })]);
    expect(await collect()).toEqual([{ type: "delta", text: "a" }, { type: "done" }]);
  });

  it("ignores a trailing partial frame rather than emitting half of it", async () => {
    serve([frame({ type: "delta", text: "a" }), 'data: {"type":"del']);
    expect(await collect()).toEqual([{ type: "delta", text: "a" }]);
  });

  it("surfaces the server's message when the response is not OK", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "A message is required." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await expect(collect()).rejects.toThrow("A message is required.");
  });

  it("still throws when the error body is not JSON", async () => {
    globalThis.fetch = (async () => new Response("upstream exploded", { status: 502 })) as typeof fetch;
    await expect(collect()).rejects.toThrow(/502/);
  });
});
