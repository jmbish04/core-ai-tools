/**
 * @fileoverview Turns the FLAT iteration rows from `GET /api/assets/:id/iterations`
 * back into the revision tree they came from.
 *
 * The API returns flat rows on purpose — grouping is the surface's job. The one
 * thing a surface must NOT do is flatten the shape further: the revision tree
 * genuinely forks. A fork makes a new node under any parent, so `rev2` can have
 * both `rev2.1` and `rev2.2` beneath it, and those two are siblings, not a
 * sequence. Rendering them as one line is a lie about what the user did.
 *
 * The only structure the rows carry is `revLabel`'s dotted notation, minted in
 * `core/revisions/create.ts`:
 *
 * - the seed revision is labelled `Original` (older rows may carry `null`)
 * - a top-level edit is `rev1`, `rev2`, … — one per distinct edit off the seed
 * - a deeper edit appends a segment: `rev2` → `rev2.1` → `rev2.1.1`
 * - a RETRY keeps its node's existing label, so two rows can share one label.
 *   Those are attempts at the same node, not two nodes.
 *
 * So the parent of `rev2.1.1` is `rev2.1`, the parent of `rev2` is the seed, and
 * depth is the segment count. Labels are minted per SESSION, which is why every
 * node is keyed by session too — `rev1` in two sessions is two different nodes,
 * and merging them would invent a fork that never happened.
 */

import type { AssetIteration } from "@/components/assets/types";

/** What a session's seed node is called when no row names it. */
export const ORIGIN_LABEL = "Original";

/** Key for rows whose `sessionUuid` is null — they still group together. */
const NO_SESSION = "\u0000no-session";

/** One node of the revision tree, as the rows let us reconstruct it. */
export interface EvolutionNode {
  /** Unique within a forest: session plus canonical label. */
  key: string;
  /** `rev2.1`, or {@link ORIGIN_LABEL} for a session's seed node. */
  label: string;
  sessionUuid: string | null;
  /** `[2, 1]` for `rev2.1`; empty for a seed node. Length is the depth. */
  segments: number[];
  /**
   * Every row carrying this label, oldest first. More than one means retries of
   * the same edit. Empty means the node is inferred — see {@link inferred}.
   */
  attempts: AssetIteration[];
  children: EvolutionNode[];
  /**
   * True when no row carried this label but a descendant's label implies it —
   * an intermediate revision whose output is not in this group (a different
   * folder, or an image never registered against the asset). It is kept rather
   * than collapsed away, because collapsing it would make cousins look like
   * siblings. Absence of a row is not evidence the step did not happen.
   */
  inferred: boolean;
}

export interface EvolutionForest {
  /** One per session, oldest session first. */
  roots: EvolutionNode[];
  /** Every node, including inferred ones and the roots. */
  nodes: EvolutionNode[];
  /**
   * True when the history branches: a node with more than one child, or more
   * than one root. This is the switch between the linear timeline and the flow
   * canvas — a forest that branches must not be drawn as a line.
   */
  forked: boolean;
  /** Rows placed into the forest. Equals `iterations.length`. */
  attemptCount: number;
}

/**
 * `rev2.1` → `[2, 1]`. Null for anything that is not a dotted rev label: the
 * seed's `Original`, a null label, or a label some future writer invents. Those
 * become the session's root rather than being guessed at.
 */
export function segmentsOf(label: string | null | undefined): number[] | null {
  if (!label) return null;
  const parts = label.trim().split(".");
  const head = /^rev(\d+)$/i.exec(parts[0] ?? "");
  if (!head) return null;
  const segments = [Number(head[1])];
  for (const part of parts.slice(1)) {
    if (!/^\d+$/.test(part)) return null;
    segments.push(Number(part));
  }
  return segments;
}

/** The canonical label for a segment path, so `REV2.1` and `rev2.1` are one node. */
function labelOf(segments: number[]): string {
  return `rev${segments.join(".")}`;
}

function msOf(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Earliest attempt in a subtree, for ordering roots and sibling ties. */
function earliestMs(node: EvolutionNode): number {
  const own = node.attempts.length ? msOf(node.attempts[0]!.createdAt) : Infinity;
  return Math.min(own, ...node.children.map(earliestMs));
}

/**
 * Rebuild the revision tree from flat iteration rows.
 *
 * @param iterations Rows from `GET /api/assets/:id/iterations`, any order.
 * @returns The forest, plus whether it branches.
 *
 * @example
 * const { roots, forked } = buildEvolutionForest(iterations);
 * // rows rev1, rev2, rev2.1, rev2.2 → one root with 2 children,
 * // rev2 holding 2 children of its own, forked === true
 */
export function buildEvolutionForest(iterations: AssetIteration[]): EvolutionForest {
  const rows = [...iterations].sort((a, b) => msOf(a.createdAt) - msOf(b.createdAt));
  const byKey = new Map<string, EvolutionNode>();
  const roots: EvolutionNode[] = [];

  const sessionKey = (uuid: string | null) => uuid ?? NO_SESSION;

  /** Get or create a node, creating every ancestor it implies on the way up. */
  function ensure(uuid: string | null, segments: number[]): EvolutionNode {
    const key = `${sessionKey(uuid)}|${segments.length ? labelOf(segments) : ORIGIN_LABEL}`;
    const existing = byKey.get(key);
    if (existing) return existing;

    const node: EvolutionNode = {
      key,
      label: segments.length ? labelOf(segments) : ORIGIN_LABEL,
      sessionUuid: uuid,
      segments,
      attempts: [],
      children: [],
      inferred: true,
    };
    byKey.set(key, node);

    if (segments.length === 0) {
      roots.push(node);
    } else {
      // Drop the last segment: rev2.1.1's parent is rev2.1, rev2's is the seed.
      ensure(uuid, segments.slice(0, -1)).children.push(node);
    }
    return node;
  }

  for (const row of rows) {
    const segments = segmentsOf(row.revLabel);
    const node = ensure(row.sessionUuid, segments ?? []);
    node.attempts.push(row);
    node.inferred = false;
    // A row whose label the API gave us wins over the canonical spelling, so the
    // UI shows what is actually stored.
    if (segments && row.revLabel) node.label = row.revLabel;
  }

  // Siblings order by their own segment, so rev2.1 precedes rev2.2 whatever
  // order the rows arrived in; equal segments fall back to time.
  for (const node of byKey.values()) {
    node.children.sort(
      (a, b) =>
        (a.segments.at(-1) ?? 0) - (b.segments.at(-1) ?? 0) || earliestMs(a) - earliestMs(b),
    );
  }
  roots.sort((a, b) => earliestMs(a) - earliestMs(b));

  const nodes = [...byKey.values()];
  return {
    roots,
    nodes,
    forked: roots.length > 1 || nodes.some((n) => n.children.length > 1),
    attemptCount: rows.length,
  };
}

/**
 * The forest flattened to one chain, parent before child. Only meaningful when
 * `forked` is false — the linear timeline uses it, the flow canvas does not.
 */
export function chainOf(forest: EvolutionForest): EvolutionNode[] {
  const chain: EvolutionNode[] = [];
  for (let node = forest.roots[0]; node; node = node.children[0]!) {
    chain.push(node);
    if (node.children.length === 0) break;
  }
  return chain;
}
