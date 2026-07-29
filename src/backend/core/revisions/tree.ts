/**
 * @fileoverview `get_session_tree` — assembles the revision tree, with retries of
 * the same edit collapsed into a single node's attempt group (never N sprawling
 * sibling branches).
 *
 * A tree NODE is an "edit": a group of revisions sharing the same parent +
 * `edit_fingerprint`. Its `attempts` are the members ordered by `attempt_number`.
 * A node's children are the edit-nodes whose parent revision falls inside this
 * node's attempts.
 *
 * This returns pure data (revision rows in tree shape). Thumbnail/variant URL
 * resolution is a presentation concern layered on in Phase 3 (Cloudflare Images
 * variants) by the surface — the core stays free of URL construction.
 */

import type { Revision } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { listSessionRevisions } from "./query";

export interface RevisionTreeNode {
  /** Group key: `${parentRevisionId}::${editFingerprint}`. */
  key: string;
  parentRevisionId: string | null;
  editFingerprint: string;
  /** All attempts of this edit, oldest attempt first. */
  attempts: Revision[];
  /** The highest-numbered attempt — what the UI shows on top of the stack. */
  latest: Revision;
  children: RevisionTreeNode[];
}

export interface SessionTree {
  sessionUuid: string;
  /** The seed node (root of the tree), or null if the session has no revisions. */
  root: RevisionTreeNode | null;
  /** Flat list of every node, for callers that don't want to walk the tree. */
  nodes: RevisionTreeNode[];
}

/** Group key for a revision — retries collapse into the same key. */
function groupKey(parentRevisionId: string | null, editFingerprint: string): string {
  return `${parentRevisionId ?? "∅"}::${editFingerprint}`;
}

/**
 * Build the session's revision tree from its rows. O(n): one pass to group, one
 * to link.
 */
export async function getSessionTree(ctx: CoreContext, sessionUuid: string): Promise<SessionTree> {
  const rows = await listSessionRevisions(ctx, sessionUuid);
  if (rows.length === 0) return { sessionUuid, root: null, nodes: [] };

  // 1. Group revisions into edit-nodes.
  const groups = new Map<string, Revision[]>();
  const revIdToGroupKey = new Map<string, string>();
  for (const r of rows) {
    const key = groupKey(r.parentRevisionId, r.editFingerprint);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(r);
    revIdToGroupKey.set(r.id, key);
  }

  // 2. Materialise nodes (attempts sorted, latest chosen).
  const nodes = new Map<string, RevisionTreeNode>();
  for (const [key, attempts] of groups) {
    attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
    nodes.set(key, {
      key,
      parentRevisionId: attempts[0].parentRevisionId,
      editFingerprint: attempts[0].editFingerprint,
      attempts,
      latest: attempts[attempts.length - 1],
      children: [],
    });
  }

  // 3. Link children to parents. A node's parent is the group containing the
  //    revision its parentRevisionId points at. The seed (null parent) is root.
  let root: RevisionTreeNode | null = null;
  for (const node of nodes.values()) {
    if (node.parentRevisionId === null) {
      root = node;
      continue;
    }
    const parentKey = revIdToGroupKey.get(node.parentRevisionId);
    const parent = parentKey ? nodes.get(parentKey) : undefined;
    if (parent) {
      parent.children.push(node);
    } else if (root) {
      // Defensive: a dangling parent (should not happen — revisions are never
      // deleted) is reparented under the seed so it stays reachable.
      root.children.push(node);
    }
  }

  return { sessionUuid, root, nodes: [...nodes.values()] };
}
