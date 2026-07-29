/**
 * Mask rasterisation — the hand-rolled PNG encoder that turns a bbox/polygon
 * into the white=edit / transparent=preserve PNG a provider consumes. Runs in
 * workerd so CompressionStream (used for the IDAT) is the real runtime one.
 */

import { describe, expect, it } from "vitest";

import { rasterizeMaskPng, readPngSize } from "@/backend/core";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("mask rasterisation", () => {
  it("emits a valid PNG whose IHDR matches source dimensions", async () => {
    const buf = await rasterizeMaskPng({
      kind: "bbox",
      geometry: { x: 0.66, y: 0, w: 0.34, h: 1 }, // right third
      sourceWidth: 320,
      sourceHeight: 200,
    });
    const bytes = new Uint8Array(buf);
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIG);
    expect(readPngSize(bytes)).toEqual({ width: 320, height: 200 });
  });

  it("falls back to a 1024² canvas when source size is unknown", async () => {
    const buf = await rasterizeMaskPng({ kind: "bbox", geometry: { x: 0, y: 0, w: 1, h: 1 } });
    expect(readPngSize(new Uint8Array(buf))).toEqual({ width: 1024, height: 1024 });
  });

  it("rasterises a polygon (triangle) without throwing", async () => {
    const buf = await rasterizeMaskPng({
      kind: "polygon",
      geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] },
      sourceWidth: 64,
      sourceHeight: 64,
    });
    expect(new Uint8Array(buf).length).toBeGreaterThan(8);
  });

  it("rejects malformed geometry", async () => {
    await expect(rasterizeMaskPng({ kind: "bbox", geometry: { x: 0 } })).rejects.toThrow();
    await expect(rasterizeMaskPng({ kind: "polygon", geometry: { points: [{ x: 0, y: 0 }] } })).rejects.toThrow();
  });
});
