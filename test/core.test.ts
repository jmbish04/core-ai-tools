/**
 * Core service-layer unit tests. Run in workerd via vitest-pool-workers against a
 * real migrated D1 — so batch atomicity, crypto.subtle fingerprints, and every
 * SQLite constraint (CHECK, unique, partial-unique) are exercised for real, with
 * no surfaces attached.
 */

import { describe, expect, it } from "vitest";

import {
  archiveSession,
  approveRevision,
  cancelRevision,
  canonicalStringify,
  createFolder,
  createMask,
  createSession,
  editFingerprint,
  expireStaleApprovals,
  forkRevision,
  getSessionTree,
  listLibrary,
  listMasks,
  listSessionsForImage,
  moveFolder,
  pinRevision,
  rejectRevision,
  requireRevision,
  resumeSession,
  retryRevision,
  softDeleteImage,
  submitEdit,
  assertOneSeedPerSession,
  DirectD1Emitter,
} from "@/backend/core";
import { NotFoundError, ValidationError } from "@/backend/core";
import { ctx, seedImage } from "./helpers";

describe("fingerprint", () => {
  it("is stable across key order", async () => {
    const a = await editFingerprint({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    const b = await editFingerprint({ a: 2, b: 1, nested: { x: 2, y: 1 } });
    expect(a).toBe(b);
  });

  it("differs on payload, mask, and mode", async () => {
    const base = await editFingerprint({ instruction: "brighten" });
    expect(await editFingerprint({ instruction: "darken" })).not.toBe(base);
    expect(await editFingerprint({ instruction: "brighten" }, "mask-1", "inpaint")).not.toBe(base);
    expect(await editFingerprint({ instruction: "brighten" }, "mask-1", "preserve")).not.toBe(
      await editFingerprint({ instruction: "brighten" }, "mask-1", "inpaint"),
    );
  });

  it("canonicalizes arrays in order but objects by sorted key", () => {
    expect(canonicalStringify({ b: [3, 1, 2], a: 1 })).toBe('{"a":1,"b":[3,1,2]}');
  });
});

describe("sessions + seed node", () => {
  it("creates session and its seed node atomically", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, { originLibraryImageId: img.id });

    expect(session.rootRevisionId).toBe(seedRevisionId);
    expect(session.approvalPolicy).toBe("masked_only");

    const { tree } = await resumeSession(c, session.sessionUuid);
    expect(tree.root).not.toBeNull();
    const seed = tree.root!.latest;
    expect(seed.id).toBe(seedRevisionId);
    expect(seed.parentRevisionId).toBeNull();
    expect(seed.attemptNumber).toBe(0);
    expect(seed.status).toBe("succeeded");
    expect(seed.editPayload).toBeNull();
    expect(seed.requestedModel).toBeNull();
    expect(seed.outputImageId).toBe(img.id);
    expect(seed.inputImageId).toBe(img.id);

    await assertOneSeedPerSession(c, session.sessionUuid); // must not throw
  });

  it("rejects a session from a missing image", async () => {
    const c = ctx();
    await expect(createSession(c, { originLibraryImageId: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("lists every session spawned from one image (the FK payoff)", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const s1 = await createSession(c, { originLibraryImageId: img.id });
    const s2 = await createSession(c, { originLibraryImageId: img.id });
    const list = await listSessionsForImage(c, img.id);
    expect(list.map((s) => s.sessionUuid).sort()).toEqual(
      [s1.session.sessionUuid, s2.session.sessionUuid].sort(),
    );
  });
});

describe("edits: submit / retry / fork / tree grouping", () => {
  async function freshSession(policy?: "auto" | "masked_only" | "always") {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      originLibraryImageId: img.id,
      approvalPolicy: policy ?? "auto",
    });
    return { c, img, session, seedRevisionId };
  }

  it("submits a first edit as attempt 1, queued, child of seed", async () => {
    const { c, session, seedRevisionId, img } = await freshSession();
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "new countertop" },
      requestedModel: "google:imagen",
    });
    expect(rev.attemptNumber).toBe(1);
    expect(rev.status).toBe("queued");
    expect(rev.parentRevisionId).toBe(seedRevisionId);
    expect(rev.inputImageId).toBe(img.id); // parent(seed).output == origin
  });

  it("requires a model (mirrors the CHECK)", async () => {
    const { c, session, seedRevisionId } = await freshSession();
    await expect(
      submitEdit(c, {
        sessionUuid: session.sessionUuid,
        parentRevisionId: seedRevisionId,
        editPayload: { instruction: "x" },
        requestedModel: "  ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("groups retries of one edit as a single node with stacked attempts", async () => {
    const { c, session, seedRevisionId } = await freshSession();
    const edit = {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "same edit" },
      requestedModel: "google:imagen",
    };
    const a1 = await submitEdit(c, edit); // attempt 1
    const a2 = await submitEdit(c, edit); // same parent+fingerprint -> attempt 2
    const a3 = await retryRevision(c, { revisionId: a1.id }); // -> attempt 3

    expect([a1.attemptNumber, a2.attemptNumber, a3.attemptNumber]).toEqual([1, 2, 3]);
    expect(a1.editFingerprint).toBe(a3.editFingerprint);

    const tree = await getSessionTree(c, session.sessionUuid);
    // seed node + one edit node
    expect(tree.nodes).toHaveLength(2);
    const editNode = tree.root!.children[0];
    expect(editNode.attempts).toHaveLength(3);
    expect(editNode.latest.attemptNumber).toBe(3);
  });

  it("forks a separate branch from a node", async () => {
    const { c, session, seedRevisionId } = await freshSession();
    const first = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "edit A" },
      requestedModel: "google:imagen",
    });
    const forked = await forkRevision(c, {
      fromRevisionId: first.id,
      editPayload: { instruction: "edit B off A" },
      requestedModel: "google:imagen",
    });
    expect(forked.parentRevisionId).toBe(first.id);

    const tree = await getSessionTree(c, session.sessionUuid);
    // seed -> A -> B
    expect(tree.root!.children).toHaveLength(1); // A
    expect(tree.root!.children[0].children).toHaveLength(1); // B under A
  });

  it("refuses to retry the seed node", async () => {
    const { c, seedRevisionId } = await freshSession();
    await expect(retryRevision(c, { revisionId: seedRevisionId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("idempotency: same key replays, new key is a deliberate new attempt", async () => {
    const { c, session, seedRevisionId } = await freshSession();
    const edit = {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "same edit" },
      requestedModel: "google:imagen",
    };
    const first = await submitEdit(c, { ...edit, idempotencyKey: "k1" });
    // Same key -> returns the SAME revision, even if the payload differs
    // ("I'm not sure you got that"), and creates no new row.
    const replay = await submitEdit(c, {
      ...edit,
      editPayload: { instruction: "totally different" },
      idempotencyKey: "k1",
    });
    expect(replay.id).toBe(first.id);
    expect(replay.attemptNumber).toBe(1);

    // New key, same edit -> a deliberate new attempt ("do it again").
    const again = await submitEdit(c, { ...edit, idempotencyKey: "k2" });
    expect(again.id).not.toBe(first.id);
    expect(again.attemptNumber).toBe(2);

    // The replay must not have added a tree node: seed + one edit node (2 attempts).
    const tree = await getSessionTree(c, session.sessionUuid);
    expect(tree.nodes).toHaveLength(2);
    expect(tree.root!.children[0].attempts).toHaveLength(2);
  });
});

describe("HITL approval gating", () => {
  async function sessionWithMask(
    policy: "auto" | "masked_only" | "always",
    maskOpts?: { state?: "proposed" | "confirmed"; coverageRatio?: number },
  ) {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      originLibraryImageId: img.id,
      approvalPolicy: policy,
    });
    const mask = await createMask(c, {
      sessionUuid: session.sessionUuid,
      sourceImageId: img.id,
      kind: "bbox",
      geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      state: maskOpts?.state ?? "proposed",
      coverageRatio: maskOpts?.coverageRatio ?? 0.05,
    });
    return { c, session, seedRevisionId, mask, img };
  }

  it("gates a masked edit under masked_only and approving confirms the mask", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("masked_only");
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "inpaint here" },
      requestedModel: "google:imagen",
      maskId: mask.id,
      maskMode: "inpaint",
    });
    expect(rev.status).toBe("awaiting_approval");
    expect(rev.approvalRequired).toBe(true);
    expect(rev.approvalExpiresAt).not.toBeNull();

    const approved = await approveRevision(c, {
      revisionId: rev.id,
      approvedBySurface: "mcp",
    });
    expect(approved.status).toBe("queued");
    expect(approved.approvedBySurface).toBe("mcp");
    const [confirmed] = await listMasks(c, { sessionUuid: session.sessionUuid });
    expect(confirmed.state).toBe("confirmed");
  });

  it("requires a mask mode when a mask is present", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("auto");
    await expect(
      submitEdit(c, {
        sessionUuid: session.sessionUuid,
        parentRevisionId: seedRevisionId,
        editPayload: { instruction: "x" },
        requestedModel: "google:imagen",
        maskId: mask.id,
        // maskMode omitted -> defaults 'none' -> invalid with a mask
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does NOT gate a confirmed low-coverage mask under auto", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("auto", {
      state: "confirmed",
      coverageRatio: 0.1,
    });
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "small tweak" },
      requestedModel: "google:imagen",
      maskId: mask.id,
      maskMode: "inpaint",
    });
    expect(rev.status).toBe("queued");
  });

  it("auto-escalates a >0.6 coverage mask even under auto", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("auto", {
      state: "confirmed",
      coverageRatio: 0.75,
    });
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "huge mask" },
      requestedModel: "google:imagen",
      maskId: mask.id,
      maskMode: "preserve",
    });
    expect(rev.status).toBe("awaiting_approval");
  });

  it("rejects a gated revision, leaving it in the tree", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("always");
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "y" },
      requestedModel: "google:imagen",
      maskId: mask.id,
      maskMode: "inpaint",
    });
    const rejected = await rejectRevision(c, { revisionId: rev.id, rejectionReason: "wrong region" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("wrong region");
    const tree = await getSessionTree(c, session.sessionUuid);
    expect(tree.nodes).toHaveLength(2); // still present
  });

  it("expires stale approvals", async () => {
    const { c, session, seedRevisionId, mask } = await sessionWithMask("always");
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "z" },
      requestedModel: "google:imagen",
      maskId: mask.id,
      maskMode: "inpaint",
    });
    expect(rev.status).toBe("awaiting_approval");
    const future = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const n = await expireStaleApprovals(c, future);
    expect(n).toBe(1);
    const swept = await requireRevision(c, rev.id);
    expect(swept.status).toBe("expired");
  });

  it("can cancel and pin", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      originLibraryImageId: img.id,
      approvalPolicy: "auto",
    });
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "q" },
      requestedModel: "google:imagen",
    });
    const pinned = await pinRevision(c, { revisionId: rev.id });
    expect(pinned.isPinned).toBe(true);
    const cancelled = await cancelRevision(c, rev.id);
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("library folders (no-cycle move)", () => {
  it("rejects moving a folder into its own descendant", async () => {
    const c = ctx();
    const root = await createFolder(c, { name: "root" });
    const child = await createFolder(c, { name: "child", parentFolderId: root.id });
    const grandchild = await createFolder(c, { name: "gc", parentFolderId: child.id });

    // Moving root under grandchild would create a cycle.
    await expect(moveFolder(c, { folderId: root.id, newParentId: grandchild.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Into itself.
    await expect(moveFolder(c, { folderId: root.id, newParentId: root.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A valid move (grandchild to root) is fine.
    const moved = await moveFolder(c, { folderId: grandchild.id, newParentId: root.id });
    expect(moved.parentFolderId).toBe(root.id);
  });
});

describe("library images", () => {
  it("lists with folderId:undefined without binding undefined to D1 (regression)", async () => {
    const c = ctx();
    await seedImage(c);
    // The REST route passes { folderId: undefined } when no query param is set —
    // this must NOT become `folder_id = ?` with an undefined bind (D1 throws).
    await expect(listLibrary(c, { folderId: undefined })).resolves.toHaveLength(1);
  });

  it("registers, lists, and soft-deletes", async () => {
    const c = ctx();
    const img = await seedImage(c);
    expect(await listLibrary(c)).toHaveLength(1);
    await softDeleteImage(c, img.id);
    expect(await listLibrary(c)).toHaveLength(0); // soft-deleted excluded
  });
});

describe("event emitter seq allocation", () => {
  it("allocates monotonic seq and never drops under concurrent appends", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session } = await createSession(c, { originLibraryImageId: img.id });
    const emitter = new DirectD1Emitter(c.db);

    // createSession already emitted seq=1. Fire many concurrent appends.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        emitter.appendEvent(session.sessionUuid, { type: "revision_progress", payload: { i } }),
      ),
    );
    const seqs = results.slice().sort((a, b) => a - b);
    // All distinct, contiguous, and above the session_created seq.
    expect(new Set(seqs).size).toBe(10);
    expect(seqs[0]).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });
});

describe("session archive reaps orphaned masks", () => {
  it("soft-deletes never-referenced session masks, keeps used ones", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      originLibraryImageId: img.id,
      approvalPolicy: "auto",
    });
    // Used mask: referenced by an edit.
    const usedMask = await createMask(c, {
      sessionUuid: session.sessionUuid,
      sourceImageId: img.id,
      kind: "bbox",
      geometry: { x: 0, y: 0, w: 0.1, h: 0.1 },
      state: "confirmed",
    });
    await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "use mask" },
      requestedModel: "google:imagen",
      maskId: usedMask.id,
      maskMode: "inpaint",
    });
    // Orphan mask: never referenced.
    const orphan = await createMask(c, {
      sessionUuid: session.sessionUuid,
      sourceImageId: img.id,
      kind: "bbox",
      geometry: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      state: "proposed",
    });

    const { session: archived, reapedMaskIds } = await archiveSession(c, session.sessionUuid);
    expect(archived.status).toBe("archived");
    expect(reapedMaskIds).toContain(orphan.id);
    expect(reapedMaskIds).not.toContain(usedMask.id);

    const liveMasks = await listMasks(c, { sessionUuid: session.sessionUuid });
    expect(liveMasks.map((m) => m.id)).toContain(usedMask.id);
    expect(liveMasks.map((m) => m.id)).not.toContain(orphan.id);
  });
});
