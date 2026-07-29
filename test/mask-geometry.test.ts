/**
 * Mask geometry tests — the factor-of-1000 coordinate boundary and coverage.
 */

import { describe, expect, it } from "vitest";

import {
  bboxCoverageRatio,
  box2dTo01,
  polygon1000To01,
  polygonCoverageRatio,
} from "@/backend/core";

describe("mask geometry — 0–1000 → 0–1 conversion", () => {
  it("converts a Gemini box_2d [ymin,xmin,ymax,xmax] to a 0–1 bbox", () => {
    // upper-left quarter
    expect(box2dTo01([0, 0, 500, 500])).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(box2dTo01([250, 500, 750, 1000])).toEqual({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
  });

  it("converts a polygon from 0–1000 to 0–1", () => {
    const p = polygon1000To01([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    expect(p.points[1]).toEqual({ x: 1, y: 0 });
    expect(p.points[2]).toEqual({ x: 1, y: 1 });
  });

  it("computes coverage of a full-frame polygon as ~1.0", () => {
    const full = polygon1000To01([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]);
    expect(polygonCoverageRatio(full)).toBeCloseTo(1, 5);
  });

  it("computes coverage of a quarter-frame polygon as ~0.25", () => {
    const quarter = polygon1000To01([
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
      { x: 0, y: 500 },
    ]);
    expect(polygonCoverageRatio(quarter)).toBeCloseTo(0.25, 5);
  });

  it("bbox coverage is w*h", () => {
    expect(bboxCoverageRatio({ w: 0.5, h: 0.5 })).toBeCloseTo(0.25, 5);
  });
});
