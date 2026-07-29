/**
 * @fileoverview The synthetic root/seed revision — single source of truth for
 * its shape, used by session creation and by invariant checks/tests.
 *
 * The seed is NOT an edit. It is created in the same transaction as its session
 * and anchors the tree. Consequences enforced here:
 *   - `parent_revision_id = null` — and the partial unique index
 *     `uniq_revisions_root_per_session` makes it the ONLY null-parent row per
 *     session, so retrying the first real edit (non-null parent) is fully
 *     guarded by `uniq_revisions_retry`.
 *   - `edit_payload = null`, `requested_model = null` — permitted by the CHECK
 *     `ck_revisions_real_edit_has_model` precisely because the parent is null.
 *   - `output_image_id = input_image_id = origin image`, `status = succeeded`,
 *     `attempt_number = 0`, `edit_fingerprint = 'seed'`. No model call is made.
 *
 * Because the seed's output IS the original image, diff/compare is uniform:
 * always `parent.output_image_id`, with no first-edit special case.
 */

import type { NewRevision, Revision } from "@/backend/db/schema";

/** The reserved fingerprint marking the seed node. */
export const SEED_FINGERPRINT = "seed";

export interface SeedRevisionInput {
  id: string;
  sessionUuid: string;
  originImageId: string;
  createdVia: "ui" | "api" | "mcp";
}

/** Build the insert values for a session's seed revision. */
export function seedRevisionValues(input: SeedRevisionInput): NewRevision {
  return {
    id: input.id,
    sessionUuid: input.sessionUuid,
    parentRevisionId: null,
    attemptNumber: 0,
    editFingerprint: SEED_FINGERPRINT,
    status: "succeeded",
    promptText: "",
    editPayload: null,
    blueprint: null,
    maskId: null,
    maskMode: "none",
    maskEmulated: false,
    requestedModel: null,
    servedModel: null,
    provider: null,
    fallbackReason: null,
    inputImageId: input.originImageId,
    outputImageId: input.originImageId,
    createdVia: input.createdVia,
    isPinned: false,
    approvalRequired: false,
  };
}

/** True for the synthetic root node (the only node with a null parent). */
export function isSeedRevision(revision: Pick<Revision, "parentRevisionId">): boolean {
  return revision.parentRevisionId === null;
}
