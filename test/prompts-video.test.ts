/**
 * Phase 7 (prompt library + grading) + Phase 8 (video TTL/purge) core tests.
 */

import { describe, expect, it } from "vitest";

import {
  clearVideoExpiryForOutput,
  createSession,
  createTemplate,
  DEFAULT_VIDEO_TTL_DAYS,
  gradeRevision,
  listTemplates,
  markSucceeded,
  promoteFromRevision,
  seedPromptTechniques,
  setAssetTtl,
  submitEdit,
  sweepExpiredVideos,
  uploadVideoAsset,
  useTemplate,
  videosExpiringSoon,
} from "@/backend/core";
import { libraryImages } from "@/backend/db/schema";
import { eq } from "drizzle-orm";
import { ctx, seedImage } from "./helpers";

describe("prompt library + grading", () => {
  it("creates, lists, and counts template use", async () => {
    const c = ctx();
    const t = await createTemplate(c, {
      title: "Room reface",
      category: "room-visualisation",
      templateBody: "Reface the [surface] with [material].",
    });
    expect((await listTemplates(c, { category: "room-visualisation" })).length).toBe(1);
    const used = await useTemplate(c, t.id);
    expect(used.useCount).toBe(1);
  });

  it("seeds technique entries idempotently", async () => {
    const c = ctx();
    expect(await seedPromptTechniques(c)).toBe(6);
    expect(await seedPromptTechniques(c)).toBe(0); // second run adds nothing
  });

  it("promotes a revision into a template and rolls up grades", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      originLibraryImageId: img.id,
      approvalPolicy: "auto",
    });
    const rev = await submitEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      editPayload: { instruction: "warm oak floor" },
      requestedModel: "gemini-3.1-flash-image",
    });
    const tpl = await promoteFromRevision(c, {
      revisionId: rev.id,
      title: "Warm oak",
      category: "room-visualisation",
    });
    expect(tpl.source).toBe("promoted");
    expect(tpl.promotedFromRevisionId).toBe(rev.id);

    await gradeRevision(c, { revisionId: rev.id, grade: 4, templateId: tpl.id });
    await gradeRevision(c, { revisionId: rev.id, grade: 2, templateId: tpl.id });
    const [refreshed] = await listTemplates(c, { category: "room-visualisation" });
    expect(refreshed.avgGrade).toBeCloseTo(3, 5);
  });
});

describe("video TTL + purge (two-state)", () => {
  async function makeVideo(ttlDays?: number | null) {
    const c = ctx();
    const asset = await uploadVideoAsset(c, new ArrayBuffer(8), { ttlDays: ttlDays as number });
    return { c, asset };
  }

  it("uploads to R2 with the default 90-day TTL and a worker delivery route", async () => {
    const { asset } = await makeVideo();
    expect(asset.mediaType).toBe("video");
    expect(asset.storage).toBe("r2");
    expect(asset.r2Key).toMatch(/^videos\//);
    expect(asset.ttlDays).toBe(DEFAULT_VIDEO_TTL_DAYS);
    expect(asset.expiresAt).not.toBeNull();
    expect(asset.deliveryUrl).toBe(`/api/video/${asset.id}`);
  });

  it("clears TTL (never expires) and sets it back", async () => {
    const { c, asset } = await makeVideo();
    const never = await setAssetTtl(c, { assetId: asset.id, ttlDays: null, surface: "mcp" });
    expect(never.expiresAt).toBeNull();
    const back = await setAssetTtl(c, { assetId: asset.id, ttlDays: 30, surface: "ui" });
    expect(back.expiresAt).not.toBeNull();
    expect(back.ttlDays).toBe(30);
  });

  it("purge sweep deletes bytes + sets bytes_purged_at, never deleted_at", async () => {
    const { c, asset } = await makeVideo(1);
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(await sweepExpiredVideos(c, future)).toBeGreaterThanOrEqual(1);
    const [after] = await c.db.select().from(libraryImages).where(eq(libraryImages.id, asset.id));
    expect(after.bytesPurgedAt).not.toBeNull();
    expect(after.deletedAt).toBeNull(); // row survives, replayable as instruction
  });

  it("pinning-protection clears expiry; expiring-soon surfaces the warn band", async () => {
    const { c, asset } = await makeVideo(3);
    expect((await videosExpiringSoon(c, 7)).map((a) => a.id)).toContain(asset.id);
    await clearVideoExpiryForOutput(c, asset.id);
    const [after] = await c.db.select().from(libraryImages).where(eq(libraryImages.id, asset.id));
    expect(after.expiresAt).toBeNull();
  });
});
