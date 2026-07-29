/**
 * @fileoverview Revision read helpers shared across the revision operations.
 */

import { and, eq } from "drizzle-orm";

import { revisions } from "@/backend/db/schema";
import type { Revision } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError } from "../errors";

/** Fetch one revision or throw NotFound. */
export async function requireRevision(ctx: CoreContext, revisionId: string): Promise<Revision> {
  const [row] = await ctx.db
    .select()
    .from(revisions)
    .where(eq(revisions.id, revisionId))
    .limit(1);
  if (!row) throw new NotFoundError(`Revision ${revisionId} not found.`);
  return row;
}

/**
 * Fetch a revision that must belong to a given session — guards against
 * cross-session parent/target references.
 */
export async function requireRevisionInSession(
  ctx: CoreContext,
  sessionUuid: string,
  revisionId: string,
): Promise<Revision> {
  const [row] = await ctx.db
    .select()
    .from(revisions)
    .where(and(eq(revisions.id, revisionId), eq(revisions.sessionUuid, sessionUuid)))
    .limit(1);
  if (!row) {
    throw new NotFoundError(`Revision ${revisionId} not found in session ${sessionUuid}.`);
  }
  return row;
}

/**
 * Look up an existing revision by its client idempotency key within a session.
 * Returns null when the key has not been used — the "first time" path.
 */
export async function findRevisionByIdempotencyKey(
  ctx: CoreContext,
  sessionUuid: string,
  idempotencyKey: string,
): Promise<Revision | null> {
  const [row] = await ctx.db
    .select()
    .from(revisions)
    .where(
      and(eq(revisions.sessionUuid, sessionUuid), eq(revisions.idempotencyKey, idempotencyKey)),
    )
    .limit(1);
  return row ?? null;
}

/** All revisions for a session, oldest first (tree building consumes this). */
export async function listSessionRevisions(
  ctx: CoreContext,
  sessionUuid: string,
): Promise<Revision[]> {
  return ctx.db
    .select()
    .from(revisions)
    .where(eq(revisions.sessionUuid, sessionUuid))
    .orderBy(revisions.createdAt);
}
