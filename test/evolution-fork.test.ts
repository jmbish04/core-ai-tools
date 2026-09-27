/**
 * @fileoverview The fork-structure derivation behind the image evolution
 * timeline (`src/frontend/components/evolution/fork-tree.ts`).
 *
 * This is here to fail loudly if the derivation ever flattens a branch. The
 * revision tree forks — `rev2.1` and `rev2.2` are siblings under `rev2` — and a
 * surface that renders that as one line is telling the user something untrue
 * about their own history. Every assertion below is chosen so that a "walk the
 * rows in order and chain them" implementation fails it.
 *
 * Pure module, no DOM: it runs in the same workerd pool as the core tests.
 */

import { describe, expect, it } from "vitest";

import {
  buildEvolutionForest,
  chainOf,
  ORIGIN_LABEL,
  segmentsOf,
} from "../src/frontend/components/evolution/fork-tree";
import type { AssetIteration } from "../src/frontend/components/assets/types";

/** A row as `GET /api/assets/:id/iterations` returns it. */
function row(
  revLabel: string | null,
  opts: { session?: string | null; folder?: string | null; at?: number; id?: string } = {},
): AssetIteration {
  const at = opts.at ?? 0;
  return {
    libraryImageId: opts.id ?? `img-${revLabel ?? "seed"}-${at}`,
    publicId: null,
    deliveryUrl: "https://imagedelivery.net/hash/image/full",
    folderId: opts.folder ?? "folder-1",
    sessionUuid: opts.session === undefined ? "session-a" : opts.session,
    revisionId: `rev-${revLabel ?? "seed"}-${at}`,
    revLabel,
    createdAt: new Date(1_700_000_000_000 + at * 60_000).toISOString(),
  };
}

const labels = (nodes: { label: string }[]) => nodes.map((n) => n.label);

describe("segmentsOf", () => {
  it("reads the dotted notation and rejects everything else", () => {
    expect(segmentsOf("rev2")).toEqual([2]);
    expect(segmentsOf("rev2.1.1")).toEqual([2, 1, 1]);
    expect(segmentsOf("REV10.3")).toEqual([10, 3]);
    expect(segmentsOf(null)).toBeNull();
    expect(segmentsOf("Original")).toBeNull();
    expect(segmentsOf("rev2.x")).toBeNull();
    expect(segmentsOf("draft")).toBeNull();
  });
});

describe("buildEvolutionForest", () => {
  it("keeps sibling branches as siblings", () => {
    // The regression this file exists for. A flattening derivation produces one
    // root with a single child and a chain four deep; the real shape is a root
    // with two children, one of which itself forks.
    const forest = buildEvolutionForest([
      row(null, { at: 0 }),
      row("rev1", { at: 1 }),
      row("rev2", { at: 2 }),
      row("rev2.1", { at: 3 }),
      row("rev2.2", { at: 4 }),
    ]);

    expect(forest.roots).toHaveLength(1);
    const root = forest.roots[0]!;
    expect(root.label).toBe(ORIGIN_LABEL);
    expect(labels(root.children)).toEqual(["rev1", "rev2"]);

    const rev2 = root.children[1]!;
    expect(labels(rev2.children)).toEqual(["rev2.1", "rev2.2"]);
    // Cousins must not become each other's children.
    expect(root.children[0]!.children).toEqual([]);
    expect(rev2.children[0]!.children).toEqual([]);

    expect(forest.forked).toBe(true);
    expect(forest.attemptCount).toBe(5);
  });

  it("nests a deep branch under the right parent", () => {
    const forest = buildEvolutionForest([
      row(null, { at: 0 }),
      row("rev2", { at: 1 }),
      row("rev2.1", { at: 2 }),
      row("rev2.1.1", { at: 3 }),
    ]);

    const rev2 = forest.roots[0]!.children[0]!;
    expect(rev2.label).toBe("rev2");
    expect(labels(rev2.children)).toEqual(["rev2.1"]);
    expect(labels(rev2.children[0]!.children)).toEqual(["rev2.1.1"]);
    expect(rev2.children[0]!.segments).toEqual([2, 1]);
    // One child at every level: this one genuinely is a line.
    expect(forest.forked).toBe(false);
    expect(labels(chainOf(forest))).toEqual([ORIGIN_LABEL, "rev2", "rev2.1", "rev2.1.1"]);
  });

  it("infers a missing intermediate rather than promoting cousins to siblings", () => {
    // Grouping by folder can split a chain: rev2's own output landed elsewhere,
    // so no row here carries it. rev2.1.1 must still hang below rev2.1.
    const forest = buildEvolutionForest([
      row("rev2.1", { at: 1 }),
      row("rev2.1.1", { at: 2 }),
      row("rev2.2", { at: 3 }),
    ]);

    const root = forest.roots[0]!;
    expect(root.inferred).toBe(true);
    expect(labels(root.children)).toEqual(["rev2"]);

    const rev2 = root.children[0]!;
    expect(rev2.inferred).toBe(true);
    expect(rev2.attempts).toEqual([]);
    expect(labels(rev2.children)).toEqual(["rev2.1", "rev2.2"]);
    expect(labels(rev2.children[0]!.children)).toEqual(["rev2.1.1"]);
    // The inferred node is what stops rev2.1.1 and rev2.2 reading as siblings.
    expect(rev2.children[1]!.children).toEqual([]);
    expect(forest.forked).toBe(true);
  });

  it("collects retries of one edit as attempts on a single node", () => {
    const forest = buildEvolutionForest([
      row(null, { at: 0 }),
      row("rev1", { at: 1, id: "attempt-1" }),
      row("rev1", { at: 2, id: "attempt-2" }),
      row("rev1", { at: 3, id: "attempt-3" }),
    ]);

    const rev1 = forest.roots[0]!.children[0]!;
    expect(forest.roots[0]!.children).toHaveLength(1);
    expect(rev1.attempts.map((a) => a.libraryImageId)).toEqual([
      "attempt-1",
      "attempt-2",
      "attempt-3",
    ]);
    // Retries are not a branch.
    expect(forest.forked).toBe(false);
  });

  it("never merges the same label across sessions", () => {
    // revLabel is minted per session, so two sessions both have a rev1. Merging
    // them would invent a fork that never happened.
    const forest = buildEvolutionForest([
      row(null, { session: "session-a", at: 0 }),
      row("rev1", { session: "session-a", at: 1 }),
      row(null, { session: "session-b", at: 2 }),
      row("rev1", { session: "session-b", at: 3 }),
    ]);

    expect(forest.roots).toHaveLength(2);
    expect(forest.roots.map((r) => r.sessionUuid)).toEqual(["session-a", "session-b"]);
    expect(forest.roots.every((r) => r.children.length === 1)).toBe(true);
    // Two roots is itself a fork of the asset's history.
    expect(forest.forked).toBe(true);
  });

  it("treats an unrecognised label as the seed and survives a null session", () => {
    const forest = buildEvolutionForest([
      row("hand-edited", { session: null, at: 0 }),
      row("rev1", { session: null, at: 1 }),
    ]);

    expect(forest.roots).toHaveLength(1);
    expect(forest.roots[0]!.sessionUuid).toBeNull();
    expect(forest.roots[0]!.attempts).toHaveLength(1);
    expect(labels(forest.roots[0]!.children)).toEqual(["rev1"]);
  });

  it("orders siblings by segment, not arrival", () => {
    const forest = buildEvolutionForest([
      row("rev2.10", { at: 5 }),
      row("rev2.2", { at: 1 }),
      row("rev2.1", { at: 9 }),
    ]);

    const rev2 = forest.roots[0]!.children[0]!;
    expect(labels(rev2.children)).toEqual(["rev2.1", "rev2.2", "rev2.10"]);
  });

  it("is empty, not forked, with no rows", () => {
    const forest = buildEvolutionForest([]);
    expect(forest.roots).toEqual([]);
    expect(forest.forked).toBe(false);
    expect(forest.attemptCount).toBe(0);
    expect(chainOf(forest)).toEqual([]);
  });
});
