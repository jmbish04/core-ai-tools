/**
 * MCP serialization: every image reference a response carries must be decorated
 * with resolvable url fields (thumbUrl/imageUrl). The test D1 has no account hash
 * bound, so the urls resolve to null — this asserts the DECORATION WIRING (the
 * recursive tree walk + reference-set extraction + library-row attach), which is
 * the new logic; real url construction is covered by images.test.ts.
 */

import { describe, expect, it } from "vitest";

import { createSession, getSessionTree, listLibrary } from "@/backend/core";
import { serializeLibrary, serializeSessionTree } from "@/backend/mcp/serialize";
import { ctx, seedImage } from "./helpers";

const BASE = "https://app.example";

describe("mcp serialize — image url decoration", () => {
  it("decorates every attempt in the tree with input/output/reference url fields", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session } = await createSession(c, { title: "Test session", originLibraryImageId: img.id });

    const tree = await getSessionTree(c, session.sessionUuid);
    type Rev = {
      inputImageUrls: { thumbUrl: string | null; imageUrl: string | null };
      outputImageUrls: { thumbUrl: string | null; imageUrl: string | null };
      referenceImageUrls: unknown[];
    };
    const out = (await serializeSessionTree(c, tree, BASE)) as {
      root: ({ latest: Rev; attempts: Rev[] }) | null;
      nodes: unknown[];
    };

    expect(out.root).not.toBeNull();
    // Url fields live on each revision (latest + every attempt), not the node.
    const seed = out.root!.latest;
    expect(seed.inputImageUrls).toHaveProperty("thumbUrl");
    expect(seed.inputImageUrls).toHaveProperty("imageUrl");
    expect(seed.outputImageUrls).toHaveProperty("thumbUrl");
    expect(Array.isArray(seed.referenceImageUrls)).toBe(true);
    expect(out.root!.attempts.every((a) => "inputImageUrls" in a)).toBe(true);
    expect(out.nodes.length).toBeGreaterThan(0);
  });

  it("attaches thumbUrl/imageUrl to every library row", async () => {
    const c = ctx();
    await seedImage(c);
    const rows = await listLibrary(c, { limit: 5 });
    const out = (await serializeLibrary(c, rows, BASE)) as Array<Record<string, unknown>>;
    for (const r of out) {
      expect(r).toHaveProperty("thumbUrl");
      expect(r).toHaveProperty("imageUrl");
    }
  });
});
