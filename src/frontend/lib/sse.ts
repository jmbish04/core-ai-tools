/**
 * @fileoverview Reading a Server-Sent Events response from `fetch`.
 *
 * Small on purpose, and not `EventSource`: `EventSource` only does GET and
 * cannot send a body, and every streamed turn here is a POST carrying the
 * message, the history and the draft.
 *
 * The parsing that matters is the buffering. A `data:` line is not guaranteed to
 * arrive in one chunk — a frame can be split across two reads, and two frames
 * can arrive in one — so anything that parses each chunk as a frame works right
 * up until the reply gets long enough to be split, which is exactly when a user
 * would notice.
 */

/** A parsed SSE `data:` payload. Frames are JSON in this codebase. */
export type SseFrame = Record<string, unknown>;

/**
 * POST a JSON body and yield each SSE frame as it arrives.
 *
 * @param url    The endpoint, already prefixed (`/api/…`).
 * @param body   The JSON request body.
 * @param signal Aborts the request; the generator ends.
 * @yields Each `data:` payload, JSON-parsed. Unparseable frames are skipped
 *   rather than thrown, so one bad frame cannot end a live turn.
 * @throws Error when the response is not OK, carrying the server's message.
 * @example for await (const f of postSse("/api/agent/turn/stream", body)) { … }
 */
export async function* postSse(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let message = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* not JSON — keep the status message */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Everything after the last one is
      // an incomplete frame and stays in the buffer.
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            yield JSON.parse(data) as SseFrame;
          } catch {
            /* a frame we cannot read must not end the turn */
          }
        }
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releasing the lock lets an abort actually cancel the body.
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
