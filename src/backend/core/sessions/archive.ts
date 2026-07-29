/**
 * @fileoverview Session archival. Sessions are never hard-deleted (that would
 * cascade their revision tree away); they are archived. On archive we also REAP
 * orphaned masks: masks scoped to this session that no revision ever referenced
 * are soft-deleted so they don't accumulate. Masks that ARE referenced by a
 * revision — or are library-scoped (session_uuid null) — are left untouched so
 * replay and cross-session reuse keep working.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { masks, revisions, sessions } from "@/backend/db/schema";
import type { Session } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { requireSession } from "./query";

export interface ArchiveResult {
  session: Session;
  /** Ids of masks reaped (soft-deleted) as orphaned during archival. */
  reapedMaskIds: string[];
}

/** Archive a session and reap its orphaned (never-referenced) masks. */
export async function archiveSession(ctx: CoreContext, sessionUuid: string): Promise<ArchiveResult> {
  await requireSession(ctx, sessionUuid);

  const [session] = await ctx.db
    .update(sessions)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(sessions.sessionUuid, sessionUuid))
    .returning();

  // Masks that some revision in this session actually used — keep these.
  const referenced = await ctx.db
    .selectDistinct({ maskId: revisions.maskId })
    .from(revisions)
    .where(and(eq(revisions.sessionUuid, sessionUuid), isNotNull(revisions.maskId)));
  const referencedIds = new Set(referenced.map((r) => r.maskId).filter(Boolean) as string[]);

  // Live masks scoped to this session.
  const sessionMasks = await ctx.db
    .select({ id: masks.id })
    .from(masks)
    .where(and(eq(masks.sessionUuid, sessionUuid), isNull(masks.deletedAt)));

  const orphanIds = sessionMasks.map((m) => m.id).filter((id) => !referencedIds.has(id));
  const now = new Date();
  for (const id of orphanIds) {
    await ctx.db.update(masks).set({ deletedAt: now }).where(eq(masks.id, id));
  }

  return { session, reapedMaskIds: orphanIds };
}
