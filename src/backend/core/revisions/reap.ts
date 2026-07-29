/**
 * @fileoverview Stuck-revision reaper. Auto-execute (API waitUntil / MCP inline)
 * drives a submitted edit `queued → running → succeeded/failed` on its own, and
 * `executeRevision` persists `failed` on any throw. But a revision can still
 * strand if the isolate is killed mid-run (leaving `running`) or if a queued row
 * was created before auto-execute existed. This reaper fails anything stuck past
 * a generous timeout so nothing sits forever; `retryRevision` can then re-enqueue
 * it (a fresh attempt auto-executes).
 */

import { and, inArray, lt } from "drizzle-orm";

import { revisions } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { markFailed } from "./lifecycle";

/** 10 min — well beyond a normal ~20s generation, so live work is never reaped. */
const DEFAULT_STUCK_MS = 10 * 60 * 1000;

/** Fail revisions stuck in queued/running past the timeout. Returns reaped ids. */
export async function reapStuckRevisions(
  ctx: CoreContext,
  olderThanMs: number = DEFAULT_STUCK_MS,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stuck = await ctx.db
    .select({ id: revisions.id })
    .from(revisions)
    .where(and(inArray(revisions.status, ["queued", "running"]), lt(revisions.createdAt, cutoff)))
    .limit(100);

  const reaped: string[] = [];
  const mins = Math.round(olderThanMs / 60000);
  for (const r of stuck) {
    try {
      await markFailed(ctx, {
        revisionId: r.id,
        errorCode: "timeout",
        errorMessage: `Execution did not complete within ${mins} minutes — reaped as stuck. Retry to re-run.`,
      });
      reaped.push(r.id);
    } catch {
      // A concurrent transition already moved it — skip.
    }
  }
  return reaped;
}
