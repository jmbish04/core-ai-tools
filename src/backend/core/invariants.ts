/**
 * @fileoverview Service-layer mirror checks for the two load-bearing DB
 * invariants. The database enforces both (partial unique index + CHECK); these
 * exist so a violation surfaces a readable `InvariantError`/`ValidationError`
 * instead of a raw SQLite constraint string, and so callers can assert BEFORE a
 * write when that gives a better message.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { revisions } from "@/backend/db/schema";
import type { CoreContext } from "./context";
import { InvariantError, ValidationError } from "./errors";

/**
 * Assert a session has at most one seed node (null parent). Mirrors the partial
 * unique index `uniq_revisions_root_per_session`. Call after any operation that
 * could theoretically introduce a second root.
 */
export async function assertOneSeedPerSession(
  ctx: CoreContext,
  sessionUuid: string,
): Promise<void> {
  const [{ count }] = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(revisions)
    .where(and(eq(revisions.sessionUuid, sessionUuid), isNull(revisions.parentRevisionId)));
  if (count > 1) {
    throw new InvariantError(
      `Session ${sessionUuid} has ${count} root revisions; exactly one is allowed.`,
    );
  }
}

/**
 * Assert a revision-to-be is well-formed: a real edit (non-null parent) must
 * carry both an edit payload and a requested model. Mirrors the CHECK
 * `ck_revisions_real_edit_has_model`. Pure — call before insert.
 */
export function assertRealEditHasModel(candidate: {
  parentRevisionId: string | null;
  editPayload: unknown;
  requestedModel: string | null | undefined;
}): void {
  if (candidate.parentRevisionId === null) return; // the seed is exempt
  if (candidate.editPayload == null || !candidate.requestedModel) {
    throw new ValidationError(
      "A real edit (non-seed revision) must have both an edit payload and a requested model.",
    );
  }
}
