/**
 * @fileoverview `SessionDO` — one Durable Object instance per session
 * (`env.SESSION_DO.getByName(sessionUuid)`), the realtime fanout + progress
 * channel. NOT an Agents-SDK agent: a plain DO using HIBERNATABLE WebSockets
 * (`acceptWebSocket` / `webSocketMessage`) so idle sessions cost nothing.
 *
 * D1 IS THE SOURCE OF TRUTH; the DO is fanout + the seq allocator, never a store.
 * Because one instance owns a whole session, its calls are serialized — so it is
 * the sole, contention-free allocator of `revision_events.seq`. Every mutating
 * core op publishes here (via `SessionDoEmitter`) AFTER its D1 write commits.
 *
 * On connect the client sends its last-known seq; the DO replays anything missed
 * from D1 (reconnects are routine).
 */

import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, gt } from "drizzle-orm";

import { getDb } from "@/backend/db";
import { revisionEvents } from "@/backend/db/schema";

interface AppendEventArgs {
  type: string;
  revisionId?: string | null;
  payload?: unknown;
}

export class SessionDO extends DurableObject<Env> {
  /**
   * Append an event to a session's log, allocating the next seq, persisting to
   * D1, and broadcasting to connected sockets. RPC entrypoint for
   * `SessionDoEmitter`. Serialized by the DO → no seq contention.
   */
  async appendEvent(sessionUuid: string, event: AppendEventArgs): Promise<number> {
    const db = getDb(this.env);
    const [last] = await db
      .select({ seq: revisionEvents.seq })
      .from(revisionEvents)
      .where(eq(revisionEvents.sessionUuid, sessionUuid))
      .orderBy(desc(revisionEvents.seq))
      .limit(1);
    const seq = (last?.seq ?? 0) + 1;

    await db.insert(revisionEvents).values({
      sessionUuid,
      revisionId: event.revisionId ?? null,
      seq,
      eventType: event.type,
      payload: event.payload ?? null,
    });

    this.broadcast(
      JSON.stringify({ seq, type: event.type, revisionId: event.revisionId ?? null, payload: event.payload ?? null }),
    );
    return seq;
  }

  /** WebSocket upgrade — accepted for hibernation. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("SessionDO: expected a WebSocket upgrade.", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // hibernatable
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Client → DO messages. `{ sessionUuid, lastSeq }` triggers a replay of every
   * event after `lastSeq` from D1 (the resume-from-cursor path).
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: { sessionUuid?: string; lastSeq?: number };
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      msg = JSON.parse(text);
    } catch {
      return; // ignore malformed frames
    }
    if (!msg.sessionUuid || typeof msg.lastSeq !== "number") return;

    const db = getDb(this.env);
    const missed = await db
      .select()
      .from(revisionEvents)
      .where(and(eq(revisionEvents.sessionUuid, msg.sessionUuid), gt(revisionEvents.seq, msg.lastSeq)))
      .orderBy(revisionEvents.seq);

    for (const e of missed) {
      try {
        ws.send(
          JSON.stringify({ seq: e.seq, type: e.eventType, revisionId: e.revisionId, payload: e.payload, replay: true }),
        );
      } catch {
        break;
      }
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** Fan a message out to every connected (including hibernated) socket. */
  private broadcast(data: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // drop dead sockets silently
      }
    }
  }
}
