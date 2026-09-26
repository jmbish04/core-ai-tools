/**
 * @fileoverview `FolderDO` — one Durable Object instance per library folder
 * (`env.FOLDER_DO.getByName(folderId)`), the realtime fanout channel for that
 * folder's contents. Mirrors `SessionDO`: a plain DO (NOT an Agents-SDK agent)
 * using HIBERNATABLE WebSockets (`acceptWebSocket` / `webSocketMessage`) so an
 * idle folder costs nothing and survives eviction without dropping subscribers.
 *
 * D1 IS THE SOURCE OF TRUTH. This DO is fanout plus the sole allocator of the
 * folder's monotonic `seq` — one instance owns a whole folder, so its calls are
 * serialized and seq allocation is contention-free by construction (no
 * `MAX()+1` race, same reasoning as `revision_events.seq` in `SessionDO`).
 *
 * WHERE THE REPLAY BUFFER LIVES — and why it is NOT D1: folder events are
 * notifications about rows that already live in `library_folders` /
 * `library_images`, not an authoritative log, so there is no folder-events table
 * and none is wanted. The last {@link FOLDER_REPLAY_BUFFER_SIZE} frames are kept
 * in the DO's own durable storage, which survives hibernation and eviction. A
 * client whose cursor predates the buffer is told `resync_required` and refetches
 * from the API — it is NEVER handed a partial replay it would mistake for a
 * complete one.
 *
 * Events are published via `emitFolderEvent` (native DO RPC, `getByName`), never
 * `stub.fetch`; the only `stub.fetch` is the raw WebSocket-upgrade proxy in
 * `src/_worker.ts`.
 */

import { DurableObject } from "cloudflare:workers";

import {
  FOLDER_REPLAY_BUFFER_SIZE,
  resolveReplay,
  type FolderControlFrame,
  type FolderEvent,
  type FolderEventFrame,
} from "./folder-events";

const SEQ_KEY = "seq";
const BUFFER_KEY = "buffer";
const FOLDER_ID_KEY = "folderId";

export class FolderDO extends DurableObject<Env> {
  /** Cached head seq. Safe to cache: the DO is single-threaded per instance, and
   * it is reloaded from storage on first use after an eviction. */
  private seq: number | null = null;

  /**
   * Append an event to this folder's channel: allocate the next seq, retain the
   * frame for reconnect replay, and broadcast to every connected socket. RPC
   * entrypoint for `emitFolderEvent` — serialized by the DO, so no seq contention.
   *
   * @param event the typed folder event (its `folderId` is the channel id).
   * @returns the assigned monotonic sequence number.
   */
  async appendEvent(event: FolderEvent): Promise<number> {
    if (this.seq === null) this.seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0;
    const seq = this.seq + 1;

    const frame: FolderEventFrame = { ...event, seq, at: Date.now() };

    const buffer = await this.readBuffer();
    buffer.push(frame);
    // ponytail: rewrite the whole capped array, one storage write per event.
    // Upgrade to keyed per-seq entries only if the buffer ever needs to be large.
    await this.ctx.storage.put({
      [SEQ_KEY]: seq,
      [BUFFER_KEY]: buffer.slice(-FOLDER_REPLAY_BUFFER_SIZE),
      // Recorded so a control frame can name its channel even once the buffer
      // has been fully drained by the size cap.
      [FOLDER_ID_KEY]: event.folderId,
    });
    this.seq = seq;

    this.broadcast(JSON.stringify(frame));
    return seq;
  }

  /** Current head seq — cheap probe for tests and health checks. */
  async currentSeq(): Promise<number> {
    if (this.seq === null) this.seq = (await this.ctx.storage.get<number>(SEQ_KEY)) ?? 0;
    return this.seq;
  }

  /** WebSocket upgrade — accepted for hibernation. Auth is enforced upstream in
   * `_worker.ts` (session cookie) before the request ever reaches this DO. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("FolderDO: expected a WebSocket upgrade.", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // hibernatable
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Client → DO. `{ lastSeq }` resumes from a cursor: every retained frame after
   * `lastSeq` is replayed, then a `synced` control frame carries the head. If the
   * cursor is older than the buffer, `resync_required` is sent INSTEAD of a
   * truncated replay — the client must refetch folder state from the API.
   * `lastSeq: 0` from a fresh client just gets the head (no history flood).
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let msg: { lastSeq?: number };
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      msg = JSON.parse(text);
    } catch {
      return; // ignore malformed frames
    }
    if (typeof msg.lastSeq !== "number") return;

    const buffer = await this.readBuffer();
    const head = await this.currentSeq();
    const folderId = (await this.ctx.storage.get<string>(FOLDER_ID_KEY)) ?? "";
    const { resync, frames } = resolveReplay(buffer, msg.lastSeq);

    const control: FolderControlFrame = resync
      ? { type: "resync_required", folderId, seq: head }
      : { type: "synced", folderId, seq: head };

    try {
      for (const f of frames) ws.send(JSON.stringify({ ...f, replay: true }));
      ws.send(JSON.stringify(control));
    } catch {
      // socket died mid-replay; nothing to clean up (hibernation API owns it)
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  private async readBuffer(): Promise<FolderEventFrame[]> {
    return (await this.ctx.storage.get<FolderEventFrame[]>(BUFFER_KEY)) ?? [];
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
