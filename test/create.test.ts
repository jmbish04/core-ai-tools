import { describe, expect, it } from "vitest";

import { createSession, getSessionView } from "@/backend/core";
import { ctx, seedImage } from "./helpers";

describe("createSession with references + overrides", () => {
  it("persists non-primary selections as the session reference pool", async () => {
    const c = ctx();
    const primary = await seedImage(c);
    const refA = await seedImage(c);
    const refB = await seedImage(c);

    const { session } = await createSession(c, {
      originLibraryImageId: primary.id,
      title: "Multi ref session",
      references: [
        { imageId: refA.id, role: "object" },
        { imageId: refB.id, role: "style" },
      ],
      modelOverrides: { image_edit: "gemini-3-pro-image" },
    });

    expect(session.modelOverrides).toEqual({ image_edit: "gemini-3-pro-image" });

    const view = await getSessionView(c, session.sessionUuid);
    const pool = (view.references ?? []).map((r) => ({ id: r.image.id, role: r.role })).sort((a, b) => a.id.localeCompare(b.id));
    const expected = [
      { id: refA.id, role: "object" },
      { id: refB.id, role: "style" },
    ].sort((a, b) => a.id.localeCompare(b.id));
    expect(pool).toEqual(expected);
    // Primary is the origin, never in the pool.
    expect((view.references ?? []).some((r) => r.image.id === primary.id)).toBe(false);
  });

  it("rejects the whole create when a reference id is bad (no orphan session)", async () => {
    const c = ctx();
    const primary = await seedImage(c);

    await expect(
      createSession(c, {
        originLibraryImageId: primary.id,
        title: "Bad ref",
        references: [{ imageId: "does-not-exist", role: "object" }],
      }),
    ).rejects.toThrow();

    // No session should have been created for this primary.
    const { listSessionsForImage } = await import("@/backend/core");
    const spawned = await listSessionsForImage(c, primary.id);
    expect(spawned.length).toBe(0);
  });
});
