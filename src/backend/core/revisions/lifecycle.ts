/**
 * @fileoverview Revision lifecycle transitions: pin, cancel, HITL approve/reject,
 * the execution status transitions (running/succeeded/failed), and the
 * approval-expiry sweep.
 *
 * Approval is available identically from all three surfaces — the only recorded
 * difference is `approved_by_surface`. Approving a revision that referenced a
 * PROPOSED mask also confirms that mask. Model dispatch itself is Phase 4;
 * `markRunning`/`markSucceeded`/`markFailed` are the state hooks it will call.
 */

import { and, eq, lt } from "drizzle-orm";

import { revisions } from "@/backend/db/schema";
import type { Revision } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { ValidationError } from "../errors";
import { EventType } from "../events";
import { propagateLineage } from "../assets/lineage";
import { confirmMask } from "../masks";
import { clearVideoExpiryForOutput } from "../library/video";
import { requireRevision } from "./query";

type Surface = "ui" | "api" | "mcp";

/** Emit a status-change event with before/after. */
async function emitStatusChange(
  ctx: CoreContext,
  row: Revision,
  from: Revision["status"],
): Promise<void> {
  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.RevisionStatusChanged,
    revisionId: row.id,
    payload: { revisionId: row.id, from, to: row.status },
  });
}

/** Pin (or unpin) a revision as the accepted result on its branch. */
export async function pinRevision(
  ctx: CoreContext,
  input: { revisionId: string; pinned?: boolean },
): Promise<Revision> {
  await requireRevision(ctx, input.revisionId);
  const [row] = await ctx.db
    .update(revisions)
    .set({ isPinned: input.pinned ?? true })
    .where(eq(revisions.id, input.revisionId))
    .returning();
  // Pinning protects a video output from the TTL sweep (spec §8): the user's
  // explicit "this is the good one" must not be auto-deleted 90 days later.
  if (row.isPinned && row.outputImageId) {
    await clearVideoExpiryForOutput(ctx, row.outputImageId);
  }
  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.RevisionPinned,
    revisionId: row.id,
    payload: { revisionId: row.id, isPinned: row.isPinned },
  });
  return row;
}

/** Cancel in-flight or pending work. No-op-safe only from cancellable states. */
export async function cancelRevision(ctx: CoreContext, revisionId: string): Promise<Revision> {
  const current = await requireRevision(ctx, revisionId);
  if (!["queued", "awaiting_approval", "running"].includes(current.status)) {
    throw new ValidationError(`Revision in status '${current.status}' cannot be cancelled.`);
  }
  const [row] = await ctx.db
    .update(revisions)
    .set({ status: "cancelled" })
    .where(eq(revisions.id, revisionId))
    .returning();
  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.RevisionCancelled,
    revisionId: row.id,
    payload: { revisionId: row.id },
  });
  await emitStatusChange(ctx, row, current.status);
  return row;
}

/**
 * Approve a gated revision. Transitions `awaiting_approval` → `queued`, records
 * the approving surface, and confirms the referenced mask if it was proposed.
 */
export async function approveRevision(
  ctx: CoreContext,
  input: { revisionId: string; approvedBySurface: Surface },
): Promise<Revision> {
  const current = await requireRevision(ctx, input.revisionId);
  if (current.status !== "awaiting_approval") {
    throw new ValidationError(
      `Only a revision awaiting approval can be approved (status '${current.status}').`,
    );
  }
  const [row] = await ctx.db
    .update(revisions)
    .set({
      status: "queued",
      approvedBySurface: input.approvedBySurface,
      approvedAt: new Date(),
    })
    .where(eq(revisions.id, input.revisionId))
    .returning();

  if (row.maskId) {
    // Confirm a proposed mask on approval; already-confirmed masks are idempotent.
    await confirmMask(ctx, row.maskId).catch(() => undefined);
  }

  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.ApprovalDecided,
    revisionId: row.id,
    payload: { revisionId: row.id, decision: "approved", surface: input.approvedBySurface },
  });
  await emitStatusChange(ctx, row, current.status);
  return row;
}

/** Reject a gated revision. The node STAYS in the tree with its reason. */
export async function rejectRevision(
  ctx: CoreContext,
  input: { revisionId: string; rejectionReason?: string | null; rejectedBySurface?: Surface },
): Promise<Revision> {
  const current = await requireRevision(ctx, input.revisionId);
  if (current.status !== "awaiting_approval") {
    throw new ValidationError(
      `Only a revision awaiting approval can be rejected (status '${current.status}').`,
    );
  }
  const [row] = await ctx.db
    .update(revisions)
    .set({ status: "rejected", rejectionReason: input.rejectionReason ?? null })
    .where(eq(revisions.id, input.revisionId))
    .returning();
  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.ApprovalDecided,
    revisionId: row.id,
    payload: {
      revisionId: row.id,
      decision: "rejected",
      surface: input.rejectedBySurface ?? null,
      reason: row.rejectionReason,
    },
  });
  await emitStatusChange(ctx, row, current.status);
  return row;
}

/**
 * Sweep lapsed approvals to `expired` so they don't accumulate as zombie nodes.
 * Backed by `idx_revisions_expiry`. Returns the number expired. (Wired to a cron
 * trigger in a later phase.)
 */
export async function expireStaleApprovals(ctx: CoreContext, now: Date = new Date()): Promise<number> {
  const stale = await ctx.db
    .select({ id: revisions.id, sessionUuid: revisions.sessionUuid, status: revisions.status })
    .from(revisions)
    .where(and(eq(revisions.status, "awaiting_approval"), lt(revisions.approvalExpiresAt, now)));

  for (const r of stale) {
    await ctx.db.update(revisions).set({ status: "expired" }).where(eq(revisions.id, r.id));
    await ctx.events.appendEvent(r.sessionUuid, {
      type: EventType.RevisionStatusChanged,
      revisionId: r.id,
      payload: { revisionId: r.id, from: "awaiting_approval", to: "expired" },
    });
  }
  return stale.length;
}

// --- Execution transitions (invoked by the Phase 4 dispatch layer) -----------

/** Mark a queued revision as running. */
export async function markRunning(ctx: CoreContext, revisionId: string): Promise<Revision> {
  const current = await requireRevision(ctx, revisionId);
  const [row] = await ctx.db
    .update(revisions)
    .set({ status: "running" })
    .where(eq(revisions.id, revisionId))
    .returning();
  await ctx.events.appendEvent(row.sessionUuid, {
    type: EventType.RevisionProgress,
    revisionId: row.id,
    payload: { revisionId: row.id, phase: "running" },
  });
  await emitStatusChange(ctx, row, current.status);
  return row;
}

export interface SucceededInput {
  revisionId: string;
  outputImageId: string;
  servedModel: string;
  provider: string;
  fallbackReason?: string | null;
  maskEmulated?: boolean;
  latencyMs?: number | null;
  tokenUsage?: unknown;
  costEstimate?: number | null;
  /** Provider multi-turn handle for children to chain from. */
  providerInteractionId?: string | null;
  /** True if provider conversation state was lost and inline fallback was used. */
  providerConversationLost?: boolean;
  /** `gateway` | `direct` — makes AI Gateway coverage auditable. */
  servedVia?: "gateway" | "direct" | null;
  /** Grounding search_suggestions HTML (rendered per ToS). */
  groundingSearchSuggestions?: string | null;
  groundingCitations?: unknown;
}

/** Mark a revision succeeded with its generated output + provenance. */
export async function markSucceeded(ctx: CoreContext, input: SucceededInput): Promise<Revision> {
  const current = await requireRevision(ctx, input.revisionId);
  const [row] = await ctx.db
    .update(revisions)
    .set({
      status: "succeeded",
      outputImageId: input.outputImageId,
      servedModel: input.servedModel,
      provider: input.provider,
      fallbackReason: input.fallbackReason ?? null,
      maskEmulated: input.maskEmulated ?? false,
      latencyMs: input.latencyMs ?? null,
      tokenUsage: input.tokenUsage ?? null,
      costEstimate: input.costEstimate ?? null,
      providerInteractionId: input.providerInteractionId ?? null,
      providerConversationLost: input.providerConversationLost ?? false,
      servedVia: input.servedVia ?? null,
      groundingSearchSuggestions: input.groundingSearchSuggestions ?? null,
      groundingCitations: input.groundingCitations ?? null,
    })
    .where(eq(revisions.id, input.revisionId))
    .returning();
  // Asset lineage: the output inherits whatever assets its INPUT descends from.
  // This one call is what makes lineage survive forks (a fork's input IS the
  // forked-from node's output) and retries (same parent → same input image).
  // Bookkeeping, not the result: a lineage write that fails must not turn a
  // finished generation into a failed one. The image is already produced and
  // stored by this point; losing its asset trace is a gap on the asset page,
  // while throwing here would mark a succeeded revision as failed.
  if (row.outputImageId) {
    try {
      await propagateLineage(ctx, {
        fromImageId: row.inputImageId,
        toImageId: row.outputImageId,
        sessionUuid: row.sessionUuid,
        revisionId: row.id,
      });
    } catch (err) {
      console.error(
        `[lineage] propagation failed for revision ${row.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  await emitStatusChange(ctx, row, current.status);
  return row;
}

/** Mark a revision failed with error detail. The node stays forkable. */
export async function markFailed(
  ctx: CoreContext,
  input: { revisionId: string; errorCode?: string | null; errorMessage?: string | null },
): Promise<Revision> {
  const current = await requireRevision(ctx, input.revisionId);
  const [row] = await ctx.db
    .update(revisions)
    .set({
      status: "failed",
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    })
    .where(eq(revisions.id, input.revisionId))
    .returning();
  await emitStatusChange(ctx, row, current.status);
  return row;
}
