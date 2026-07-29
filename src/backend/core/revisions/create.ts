/**
 * @fileoverview Creating revisions — the tree's write path: `submit_edit`,
 * `fork_revision`, `retry_revision`. All three funnel through one internal
 * `createEditRevision` so fork/retry/submit share identical validation,
 * fingerprinting, attempt allocation, and approval gating.
 *
 * WHAT PHASE 2 DOES: creates the revision row in `queued` (or `awaiting_approval`)
 * and publishes the event. It does NOT call a provider — model dispatch is Phase
 * 4, which picks up `queued` revisions via a separate `executeRevision` seam.
 *
 * ATTEMPT ALLOCATION: `attempt_number` is `MAX(existing for
 * session+parent+fingerprint) + 1`, allocated in an optimistic loop that retries
 * on the `uniq_revisions_retry` unique-constraint violation two concurrent
 * retries would cause. This is the "hammer the same edit" case; the DB
 * constraint is the source of truth and the loop simply re-reads and re-inserts.
 */

import { and, desc, eq } from "drizzle-orm";

import { masks, revisions, sessions } from "@/backend/db/schema";
import type { Mask, Revision, Session } from "@/backend/db/schema";
import { requireModel } from "@/backend/ai/registry";
import type { CoreContext } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { isUniqueViolation } from "../errors";
import { EventType } from "../events";
import { editFingerprint } from "../fingerprint";
import { requireMask } from "../masks";
import { assertReferenceCaps, upsertSessionReferences, type ReferenceInput } from "../sessions/references";
import { findRevisionByIdempotencyKey, requireRevision, requireRevisionInSession } from "./query";

/** How long an unapproved revision lives before the expiry sweep marks it expired. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
/** Mask coverage above this fraction auto-escalates to approval (a huge mask is
 * usually a failed mask). Cost-ceiling and low-confidence-semantic escalation are
 * Phase 4/5, once model cost + segmentation confidence exist. */
const COVERAGE_ESCALATION_THRESHOLD = 0.6;
/** Optimistic attempt-allocation retry budget. */
const MAX_ATTEMPT_RETRIES = 25;

export type MaskMode = "none" | "inpaint" | "preserve";

export interface SubmitEditInput {
  sessionUuid: string;
  /** The node to branch/edit from. Real edits ALWAYS have a parent (the seed is
   * the only null-parent node). */
  parentRevisionId: string;
  /** The full prompt, stored verbatim. May be '' for a structured-only edit. */
  promptText?: string;
  /** Structured edit (instruction and/or field changes). Required for a real edit. */
  editPayload: unknown;
  /** Model the caller wants. Required (the CHECK enforces it for real edits). */
  requestedModel: string;
  provider?: string | null;
  maskId?: string | null;
  maskMode?: MaskMode;
  blueprint?: unknown | null;
  /**
   * Additional reference images (beyond the base/parent image) for a
   * multi-reference edit, each tagged with a role. Ordered base → object → style
   * for provider assembly. Upserted into the session pool; the ordered ids are
   * recorded on the revision as editPayload.reference_image_ids.
   */
  references?: ReferenceInput[];
  createdVia?: "ui" | "api" | "mcp";
  /**
   * Optional client dedup key (unique per session). Resending the SAME key
   * returns the existing revision unchanged (a dropped-response replay); it does
   * NOT create a new attempt. Omit it, or send a NEW key, to force a real new
   * attempt of the same edit.
   */
  idempotencyKey?: string | null;
}

/**
 * Decide whether an edit is gated behind HITL approval. Policy gates plus
 * heuristic auto-escalation that fires even under `auto`.
 */
function decideApproval(
  policy: Session["approvalPolicy"],
  mask: Mask | null,
): { status: "queued" | "awaiting_approval"; approvalRequired: boolean; approvalExpiresAt: Date | null } {
  const gated =
    policy === "always" ||
    (policy === "masked_only" && mask !== null) ||
    (mask !== null && mask.state === "proposed") ||
    (mask !== null && mask.coverageRatio != null && mask.coverageRatio > COVERAGE_ESCALATION_THRESHOLD);

  if (gated) {
    return {
      status: "awaiting_approval",
      approvalRequired: true,
      approvalExpiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    };
  }
  return { status: "queued", approvalRequired: false, approvalExpiresAt: null };
}

/** Internal: shared create path for submit/fork/retry. */
async function createEditRevision(
  ctx: CoreContext,
  params: Required<Pick<SubmitEditInput, "sessionUuid" | "parentRevisionId" | "editPayload" | "requestedModel">> &
    Omit<SubmitEditInput, "sessionUuid" | "parentRevisionId" | "editPayload" | "requestedModel">,
): Promise<Revision> {
  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUuid, params.sessionUuid))
    .limit(1);
  if (!session) throw new NotFoundError(`Session ${params.sessionUuid} not found.`);

  // Idempotency replay: a resent key returns the existing revision untouched —
  // no second row, no wasted model call, no phantom attempt in the tree.
  if (params.idempotencyKey) {
    const existing = await findRevisionByIdempotencyKey(
      ctx,
      params.sessionUuid,
      params.idempotencyKey,
    );
    if (existing) return existing;
  }

  const parent = await requireRevisionInSession(ctx, params.sessionUuid, params.parentRevisionId);

  if (!params.requestedModel?.trim()) {
    throw new ValidationError("A real edit requires a requested model.");
  }
  if (params.editPayload == null) {
    throw new ValidationError("A real edit requires an edit payload.");
  }

  // Mask validation + mode coherence.
  let mask: Mask | null = null;
  let maskMode: MaskMode = params.maskMode ?? "none";
  if (params.maskId) {
    mask = await requireMask(ctx, params.maskId);
    if (mask.sessionUuid !== null && mask.sessionUuid !== params.sessionUuid) {
      throw new ValidationError(
        `Mask ${params.maskId} is scoped to another session and cannot be used here.`,
      );
    }
    if (maskMode === "none") {
      throw new ValidationError("mask_mode must be 'inpaint' or 'preserve' when a mask is used.");
    }
  } else {
    maskMode = "none";
  }

  // The image being edited: the parent's output if it produced one, else what the
  // parent itself started from (so forking a FAILED node re-edits its input).
  const inputImageId = parent.outputImageId ?? parent.inputImageId;

  // Reference images: enforce per-model caps (clear error, not a provider 400),
  // upsert them into the session pool, and fold the ordered ids into editPayload
  // BEFORE fingerprinting so a different ref set is a new node and the same set
  // stacks as a retry. execute.ts resolves reference_image_ids → base64 in order.
  let editPayload = params.editPayload;
  if (params.references && params.references.length > 0) {
    assertReferenceCaps(requireModel(params.requestedModel), params.references);
    const orderedIds = await upsertSessionReferences(ctx, params.sessionUuid, params.references);
    editPayload =
      editPayload && typeof editPayload === "object"
        ? { ...(editPayload as Record<string, unknown>), reference_image_ids: orderedIds }
        : { reference_image_ids: orderedIds };
  }

  const fingerprint = await editFingerprint(editPayload, params.maskId ?? null, maskMode);
  const approval = decideApproval(session.approvalPolicy, mask);

  // Optimistic attempt allocation against uniq_revisions_retry.
  for (let i = 0; i < MAX_ATTEMPT_RETRIES; i++) {
    const [top] = await ctx.db
      .select({ attemptNumber: revisions.attemptNumber })
      .from(revisions)
      .where(
        and(
          eq(revisions.sessionUuid, params.sessionUuid),
          eq(revisions.parentRevisionId, params.parentRevisionId),
          eq(revisions.editFingerprint, fingerprint),
        ),
      )
      .orderBy(desc(revisions.attemptNumber))
      .limit(1);
    const attemptNumber = (top?.attemptNumber ?? 0) + 1;

    // Display label for the edit-node. A retry (attempt > 1) shares the node's
    // existing label; a new node is labeled from the parent: top-level edits are
    // rev1/rev2/… and deeper edits/forks branch with dotted notation
    // (rev2 → rev2.1 → rev2.1.1). The uuid stays the real identifier.
    let revLabel: string | null;
    if (attemptNumber > 1) {
      const [sib] = await ctx.db
        .select({ revLabel: revisions.revLabel })
        .from(revisions)
        .where(
          and(
            eq(revisions.sessionUuid, params.sessionUuid),
            eq(revisions.parentRevisionId, params.parentRevisionId),
            eq(revisions.editFingerprint, fingerprint),
          ),
        )
        .limit(1);
      revLabel = sib?.revLabel ?? null;
    } else {
      const sibs = await ctx.db
        .selectDistinct({ f: revisions.editFingerprint })
        .from(revisions)
        .where(eq(revisions.parentRevisionId, params.parentRevisionId));
      const idx = sibs.length + 1; // 1-based position among sibling edit-nodes
      revLabel =
        parent.parentRevisionId === null ? `rev${idx}` : `${parent.revLabel ?? "rev"}.${idx}`;
    }

    try {
      const [row] = await ctx.db
        .insert(revisions)
        .values({
          sessionUuid: params.sessionUuid,
          parentRevisionId: params.parentRevisionId,
          attemptNumber,
          revLabel,
          editFingerprint: fingerprint,
          status: approval.status,
          promptText: params.promptText ?? "",
          editPayload,
          blueprint: params.blueprint ?? null,
          maskId: params.maskId ?? null,
          maskMode,
          requestedModel: params.requestedModel,
          provider: params.provider ?? null,
          inputImageId,
          approvalRequired: approval.approvalRequired,
          approvalExpiresAt: approval.approvalExpiresAt,
          createdVia: params.createdVia ?? "ui",
          idempotencyKey: params.idempotencyKey ?? null,
        })
        .returning();

      await ctx.events.appendEvent(params.sessionUuid, {
        type: EventType.RevisionCreated,
        revisionId: row.id,
        payload: {
          revisionId: row.id,
          parentRevisionId: row.parentRevisionId,
          attemptNumber: row.attemptNumber,
          status: row.status,
        },
      });
      if (row.status === "awaiting_approval") {
        await ctx.events.appendEvent(params.sessionUuid, {
          type: EventType.ApprovalRequested,
          revisionId: row.id,
          payload: {
            revisionId: row.id,
            maskId: row.maskId,
            approvalExpiresAt: row.approvalExpiresAt,
          },
        });
      }
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Two unique indexes can bite here. If an idempotency key was supplied and
        // a concurrent replay inserted first, return that row (replay wins the
        // race). Otherwise it's the attempt_number race — re-read and retry.
        if (params.idempotencyKey) {
          const existing = await findRevisionByIdempotencyKey(
            ctx,
            params.sessionUuid,
            params.idempotencyKey,
          );
          if (existing) return existing;
        }
        continue;
      }
      throw err;
    }
  }
  throw new ConflictError(
    `Could not allocate an attempt number for the edit after ${MAX_ATTEMPT_RETRIES} retries (excessive concurrent retries).`,
  );
}

/**
 * Submit an edit off `parentRevisionId`. If an identical edit already exists under
 * that parent, this is naturally a retry (attempt_number increments); the first
 * one is attempt 1.
 */
export async function submitEdit(ctx: CoreContext, input: SubmitEditInput): Promise<Revision> {
  return createEditRevision(ctx, input);
}

/**
 * Explicit fork: branch a NEW edit from any node (including a failed one). Same
 * mechanics as submitEdit with the forked-from node as parent.
 */
export async function forkRevision(
  ctx: CoreContext,
  input: { fromRevisionId: string } & Omit<SubmitEditInput, "sessionUuid" | "parentRevisionId">,
): Promise<Revision> {
  const from = await requireRevision(ctx, input.fromRevisionId);
  const { fromRevisionId, ...edit } = input;
  return createEditRevision(ctx, {
    ...edit,
    sessionUuid: from.sessionUuid,
    parentRevisionId: fromRevisionId,
  });
}

/**
 * Retry a revision: a new attempt sharing the SAME parent + edit_fingerprint,
 * `attempt_number` incremented. Reuses the original's edit inputs verbatim so the
 * fingerprint matches and the UI stacks them as one node.
 */
export async function retryRevision(
  ctx: CoreContext,
  input: { revisionId: string; createdVia?: "ui" | "api" | "mcp"; idempotencyKey?: string | null },
): Promise<Revision> {
  const orig = await requireRevision(ctx, input.revisionId);
  if (orig.parentRevisionId === null) {
    throw new ValidationError("The seed node cannot be retried.");
  }
  return createEditRevision(ctx, {
    sessionUuid: orig.sessionUuid,
    parentRevisionId: orig.parentRevisionId,
    promptText: orig.promptText,
    editPayload: orig.editPayload,
    requestedModel: orig.requestedModel ?? "",
    provider: orig.provider,
    maskId: orig.maskId,
    maskMode: orig.maskMode as MaskMode,
    blueprint: orig.blueprint,
    createdVia: input.createdVia ?? orig.createdVia,
    // The retry's OWN dedup key — never the original's, or the retry would just
    // return the original. Omitted unless the client is deduping its retry call.
    idempotencyKey: input.idempotencyKey ?? null,
  });
}
