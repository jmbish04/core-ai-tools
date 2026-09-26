/**
 * @fileoverview W2.4 — the replay-window logic behind `FolderDO`'s reconnect
 * path. `resolveReplay` decides between "here are the frames you missed" and
 * "resync_required", and getting the boundary wrong either floods a client or,
 * worse, hands it a truncated replay it would mistake for complete. That is the
 * non-trivial part, so it is pure and tested here.
 *
 * NOT TESTED HERE: the DO itself. The vitest pool (`vitest.config.mts`) declares
 * only `DB` + `R2_VIDEO_BUCKET` — no Durable Object bindings — and that file is
 * outside this change's territory, so `FOLDER_DO.getByName(...)` cannot be
 * exercised from this suite. Adding `durableObjects: { FOLDER_DO: "FolderDO" }`
 * to the pool's miniflare config would enable a true seq/hibernation test.
 */

import { describe, expect, it } from "vitest";

import {
  FOLDER_REPLAY_BUFFER_SIZE,
  resolveReplay,
  type FolderEventFrame,
} from "@/backend/realtime/folder-events";

/** Build a contiguous buffer of `image_added` frames with seq `from..to`. */
function buffer(from: number, to: number): FolderEventFrame[] {
  const frames: FolderEventFrame[] = [];
  for (let seq = from; seq <= to; seq += 1) {
    frames.push({ type: "image_added", folderId: "f1", imageId: `img-${seq}`, seq, at: seq });
  }
  return frames;
}

describe("resolveReplay", () => {
  it("replays only frames after the cursor", () => {
    const { resync, frames } = resolveReplay(buffer(1, 5), 3);
    expect(resync).toBe(false);
    expect(frames.map((f) => f.seq)).toEqual([4, 5]);
  });

  it("replays the whole buffer for a cursor of 0 when nothing has been evicted", () => {
    const { resync, frames } = resolveReplay(buffer(1, 5), 0);
    expect(resync).toBe(false);
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns nothing for a client already at the head", () => {
    expect(resolveReplay(buffer(1, 5), 5)).toEqual({ resync: false, frames: [] });
  });

  it("demands a resync for a cursor ahead of the head", () => {
    // Only reachable if the DO's counter was lost; the client would otherwise
    // discard the replacement events as already-seen. Absence of history is not
    // evidence that nothing happened.
    expect(resolveReplay(buffer(1, 5), 9)).toEqual({ resync: true, frames: [] });
  });

  it("replays at the exact boundary: cursor is oldest-1", () => {
    const { resync, frames } = resolveReplay(buffer(10, 14), 9);
    expect(resync).toBe(false);
    expect(frames.map((f) => f.seq)).toEqual([10, 11, 12, 13, 14]);
  });

  it("demands a resync one seq past the boundary — never a truncated replay", () => {
    const { resync, frames } = resolveReplay(buffer(10, 14), 8);
    expect(resync).toBe(true);
    expect(frames).toEqual([]);
  });

  it("demands a resync when a stale cursor meets an empty buffer", () => {
    expect(resolveReplay([], 3)).toEqual({ resync: true, frames: [] });
  });

  it("is quiet for a fresh client on an empty folder", () => {
    expect(resolveReplay([], 0)).toEqual({ resync: false, frames: [] });
  });

  it("only resyncs clients that fell outside the retained window", () => {
    // Head 500 with the buffer capped at FOLDER_REPLAY_BUFFER_SIZE frames.
    const capped = buffer(500 - FOLDER_REPLAY_BUFFER_SIZE + 1, 500);
    expect(resolveReplay(capped, 350).resync).toBe(true); // evicted
    expect(resolveReplay(capped, 450).resync).toBe(false); // still retained
    expect(resolveReplay(capped, 499).frames.map((f) => f.seq)).toEqual([500]);
  });
});
