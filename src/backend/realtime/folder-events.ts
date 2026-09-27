/**
 * @fileoverview The per-folder realtime event contract (W2.4) — the ONE place
 * the folder event union is declared, plus the emit helper every server-side
 * caller uses and the pure replay-window function the DO and its test share.
 *
 * Deliberately free of `cloudflare:workers` imports so a frontend React island
 * can `import type { FolderEvent } from "@/backend/realtime/folder-events"`
 * without dragging the Durable Object runtime into the client bundle.
 *
 * Contract, in one line: **D1 is the source of truth; `FolderDO` is fanout.**
 * A folder event is a notification that something changed in D1, carrying just
 * enough to patch a client's view — never the authoritative row. A client that
 * has fallen behind the DO's replay window is told `resync_required` and refetches
 * from `/api/library`; it is never handed a silently-truncated replay.
 */

/** Canonical folder event types. String constants (not an enum) so new kinds are
 * additive; clients treat an unknown `type` as opaque and refetch if they care. */
export const FolderEventType = {
  FolderCreated: "folder_created",
  FolderRenamed: "folder_renamed",
  FolderMoved: "folder_moved",
  FolderArchived: "folder_archived",
  FolderRestored: "folder_restored",
  FolderSettingsChanged: "folder_settings_changed",
  ImageAdded: "image_added",
  ImageMoved: "image_moved",
  ImageRemoved: "image_removed",
  ImageMetadataChanged: "image_metadata_changed",
} as const;

export type FolderEventTypeValue = (typeof FolderEventType)[keyof typeof FolderEventType];

/**
 * The typed folder event union. Every member is what the DO broadcasts minus the
 * envelope (`seq`, `at`, `replay`) the DO adds — see `FolderEventFrame`.
 *
 * `folderId` is the CHANNEL, i.e. the DO instance the event was emitted into. For
 * a move, the emitter publishes to BOTH the source and destination channels, so
 * both sides of a drag-and-drop update; `fromFolderId`/`toFolderId` say which.
 */
export type FolderEvent =
  | { type: "folder_created"; folderId: string; name: string; parentFolderId: string | null }
  | { type: "folder_renamed"; folderId: string; name: string }
  | { type: "folder_moved"; folderId: string; fromParentId: string | null; toParentId: string | null }
  | { type: "folder_archived"; folderId: string }
  // Restore is its own event, not a re-used folder_created. Emitting "created"
  // for a restore is a lie of provenance in the log, and a client that animates
  // a new folder would animate a restore.
  | { type: "folder_restored"; folderId: string; name: string; parentFolderId: string | null }
  /** `changed` lists the settings keys that moved — values are re-read from the API. */
  | { type: "folder_settings_changed"; folderId: string; changed: string[] }
  | { type: "image_added"; folderId: string; imageId: string }
  | { type: "image_moved"; folderId: string; imageId: string; fromFolderId: string | null; toFolderId: string | null }
  | { type: "image_removed"; folderId: string; imageId: string }
  | { type: "image_metadata_changed"; folderId: string; imageId: string; changed: string[] };

/** A broadcast frame: the event plus the DO's envelope. This is the WebSocket wire shape. */
export type FolderEventFrame = FolderEvent & {
  /** Monotonic per-folder sequence, allocated by the folder's DO. */
  seq: number;
  /** Emit time, epoch ms. */
  at: number;
  /** True when delivered from the replay buffer rather than live. */
  replay?: true;
};

/** Client → DO resume frame: "send me everything after `lastSeq`". */
export interface FolderResumeFrame {
  lastSeq: number;
}

/**
 * DO → client control frame. `resync_required` means the requested `lastSeq` is
 * older than the replay buffer, so the client MUST refetch folder state from the
 * API rather than assume it missed nothing. `synced` carries the current head so
 * a fresh client can start from a known cursor.
 */
export type FolderControlFrame =
  | { type: "resync_required"; folderId: string; seq: number }
  | { type: "synced"; folderId: string; seq: number };

/** How many recent events each folder's DO retains for reconnect replay. */
export const FOLDER_REPLAY_BUFFER_SIZE = 100;

/**
 * Pure replay-window resolution, shared by the DO and its test.
 *
 * @param buffer retained frames, ascending by seq.
 * @param lastSeq the client's cursor (0 = "I have nothing").
 * @returns frames to replay, or `resync: true` when replay cannot be complete —
 *   the cursor predates the buffer, or it is AHEAD of the head (which means the
 *   DO's counter was lost, so the client and the channel disagree about history).
 *   Either way the client must refetch rather than assume it missed nothing.
 */
export function resolveReplay(
  buffer: readonly FolderEventFrame[],
  lastSeq: number,
): { resync: boolean; frames: FolderEventFrame[] } {
  const head = buffer.length ? buffer[buffer.length - 1].seq : 0;
  if (lastSeq === head) return { resync: false, frames: [] }; // already current
  // Cursor beyond our head: the DO lost its counter (storage reset), so seq
  // restarted and the client would silently ignore the replacement events as
  // "already seen". An absence of retained history is NOT evidence of nothing
  // having happened — say so and make the client refetch.
  if (lastSeq > head) return { resync: true, frames: [] };
  const oldest = buffer.length ? buffer[0].seq : head + 1;
  // lastSeq === oldest - 1 is the boundary case that IS replayable: the client's
  // next expected event is the oldest one we still hold.
  if (lastSeq < oldest - 1) return { resync: true, frames: [] };
  return { resync: false, frames: buffer.filter((f) => f.seq > lastSeq) };
}

/** The `FolderDO` RPC surface the emit helper depends on. Keeps the emitter free
 * of a static import of the DO class (and therefore of `cloudflare:workers`). */
interface FolderDoRpc {
  appendEvent(event: FolderEvent): Promise<number>;
}

/**
 * Emit a folder event: the ONE way server code publishes into a folder channel.
 * Native DO RPC via `getByName(folderId)` — NEVER `stub.fetch` for dispatch (the
 * only sanctioned `stub.fetch` is the raw WebSocket-upgrade proxy in `_worker.ts`).
 *
 * Call this AFTER the D1 write commits — the event announces a committed fact.
 * Emitting is best-effort fanout, never a correctness dependency: a throw here
 * must not fail the mutation, so callers either `ctx.waitUntil` it or `await` it
 * inside a try/catch. `event.folderId` selects the channel.
 *
 * @returns the assigned per-folder seq, or `null` when the binding is absent
 *   (tests / a dev env without the DO) so callers need no feature check.
 * @example
 * // in an API handler, after the core call returns:
 * c.executionCtx.waitUntil(emitFolderEvent(c.env, { type: "folder_renamed", folderId: f.id, name: f.name }));
 */
export async function emitFolderEvent(env: Env, event: FolderEvent): Promise<number | null> {
  const ns = (env as unknown as { FOLDER_DO?: DurableObjectNamespace }).FOLDER_DO;
  if (!ns) return null;
  const stub = ns.getByName(event.folderId) as unknown as FolderDoRpc;
  return stub.appendEvent(event);
}

/**
 * Emit a move into BOTH affected folder channels, skipping nulls and the
 * degenerate same-folder case. Used by `moveFolder`/`moveImage`, where a viewer
 * of the source folder and a viewer of the destination both need to update.
 */
export async function emitFolderEventBoth(
  env: Env,
  from: string | null,
  to: string | null,
  make: (folderId: string) => FolderEvent,
): Promise<void> {
  const targets = [...new Set([from, to].filter((id): id is string => !!id))];
  await Promise.all(targets.map((id) => emitFolderEvent(env, make(id))));
}
