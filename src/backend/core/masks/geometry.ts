/**
 * @fileoverview Mask geometry helpers — the boundary where a factor-of-1000
 * coordinate bug would otherwise hide. Gemini segmentation returns coordinates
 * normalised 0–1000; our `masks.geometry` is normalised 0–1. Convert on ingest,
 * here, explicitly and tested.
 */

/** A polygon as normalised points. */
export type NormalizedPolygon = { points: Array<{ x: number; y: number }> };

/** Convert a Gemini box_2d `[ymin, xmin, ymax, xmax]` (0–1000) to a 0–1 bbox. */
export function box2dTo01(box: [number, number, number, number]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const [ymin, xmin, ymax, xmax] = box.map((v) => v / 1000) as [number, number, number, number];
  return { x: xmin, y: ymin, w: Math.max(0, xmax - xmin), h: Math.max(0, ymax - ymin) };
}

/** Convert a Gemini mask polygon (flat or point pairs, 0–1000) to a 0–1 polygon. */
export function polygon1000To01(points: Array<{ x: number; y: number }>): NormalizedPolygon {
  return { points: points.map((p) => ({ x: p.x / 1000, y: p.y / 1000 })) };
}

/**
 * Fraction of the frame a normalised polygon covers, via the shoelace formula.
 * Coordinates are already 0–1, so the raw area IS the coverage ratio. Clamped to
 * [0, 1]. Feeds the §4.3 auto-escalation heuristic (coverage > 0.6).
 */
export function polygonCoverageRatio(poly: NormalizedPolygon): number {
  const pts = poly.points;
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.min(1, Math.max(0, Math.abs(area) / 2));
}

/** Coverage of a normalised bbox (w*h). */
export function bboxCoverageRatio(bbox: { w: number; h: number }): number {
  return Math.min(1, Math.max(0, bbox.w * bbox.h));
}
