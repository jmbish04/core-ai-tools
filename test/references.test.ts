/**
 * Multi-image reference caps + ingest URL parsing — the two bits of non-trivial
 * logic in the reference feature that fail silently if wrong.
 */

import { describe, expect, it } from "vitest";

import { assertReferenceCaps, parseCfImagesUrl } from "@/backend/core";
import { requireModel } from "@/backend/ai/registry";

const pro = requireModel("gemini-3-pro-image"); // 14 total, 6 object, 3 style
const lite = requireModel("gemini-3.1-flash-lite-image"); // 0 refs

const objs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ imageId: `o${i}`, role: "object" as const }));
const styles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ imageId: `s${i}`, role: "style" as const }));

describe("reference caps", () => {
  it("accepts within Pro caps (6 object + 3 style)", () => {
    expect(() => assertReferenceCaps(pro, [...objs(6), ...styles(3)])).not.toThrow();
  });

  it("rejects too many object refs", () => {
    expect(() => assertReferenceCaps(pro, objs(7))).toThrow(/object references/);
  });

  it("rejects too many style refs", () => {
    expect(() => assertReferenceCaps(pro, styles(4))).toThrow(/style references/);
  });

  it("rejects a model that accepts no references", () => {
    expect(() => assertReferenceCaps(lite, objs(1))).toThrow(/does not accept reference/);
  });

  it("no references is always fine", () => {
    expect(() => assertReferenceCaps(lite, [])).not.toThrow();
  });
});

describe("cf images url parsing", () => {
  it("extracts the image id from an imagedelivery.net URL", () => {
    expect(
      parseCfImagesUrl("https://imagedelivery.net/guDBhnmcqEWgPQ1LAcR2gg/showroom-222-abc/public"),
    ).toBe("showroom-222-abc");
  });

  it("returns null for a non-CF host", () => {
    expect(parseCfImagesUrl("https://example.com/a/b/c")).toBeNull();
    expect(parseCfImagesUrl("not a url")).toBeNull();
  });
});
