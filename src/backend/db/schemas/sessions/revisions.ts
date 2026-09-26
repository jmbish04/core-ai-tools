/**
 * @fileoverview `revisions` — THE tree. Every edit attempt, from any surface,
 * is one node here. Editing is never destructive and never linear.
 *
 * Tree semantics (implemented in the service layer, shaped by this schema):
 *   - FORK   = new revision whose parent_revision_id is any existing node
 *              (including failed ones) → branching.
 *   - RETRY  = new revision with the SAME parent_revision_id AND the SAME
 *              edit_fingerprint as an existing sibling, attempt_number++ →
 *              the UI stacks these as one node's attempt group, not N branches.
 *
 * parent_revision_id is nullable ONLY for the root node. The row stores the
 * FULL prompt verbatim (prompt_text) plus the structured payload, so any
 * revision can be replayed exactly. Because replay depends on the referenced
 * mask and output image, `mask_id` and `output_image_id` use ON DELETE RESTRICT
 * (both targets are soft-delete-only tables) — a hard delete fails loudly
 * rather than silently nulling a pointer replay needs.
 *
 * A single UNIQUE index (session_uuid, parent_revision_id, edit_fingerprint,
 * attempt_number) does triple duty: it prevents concurrent retries from
 * colliding on attempt_number, and its leftmost prefixes serve the
 * children-of-a-node and retry-sibling read shapes. A second index on
 * (status, approval_expires_at) backs the approval-expiry cron sweep.
 */

import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryImages } from "../library/images";
import { masks } from "./masks";
import { sessions } from "./sessions";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

/** Human-readable description of the `revisions` table for the docs UI. */
export const REVISIONS_TABLE_DESCRIPTION =
  "The revision tree. Every edit attempt from every surface is one node. Fork = new node off any parent; retry = new node sharing a parent+edit_fingerprint with a sibling (attempt_number++). Stores the full prompt verbatim and enough context to replay exactly. Records requested vs served model for fallback badging.";

/** Per-column descriptions surfaced in the documentation schema viewer. */
export const REVISIONS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key, generated via crypto.randomUUID().",
  session_uuid: "FK into sessions.session_uuid — the session this revision belongs to.",
  parent_revision_id:
    "Self-FK into revisions.id. Null ONLY for the synthetic root/seed node (enforced unique per session by a partial index). Any node is forkable, including failed ones.",
  attempt_number:
    "Retry counter. Real edits are 1-based and share parent+edit_fingerprint; the synthetic seed node is 0.",
  edit_fingerprint:
    "Stable hash of the normalised edit payload. Retries of the same edit share this value; the seed node uses 'seed'.",
  status:
    "queued | awaiting_approval | running | succeeded | failed | rejected | expired | cancelled.",
  prompt_text: "The full prompt, verbatim, always. Never truncated.",
  edit_payload: "JSON structured edit (instruction and/or field-level changes). Null only for the seed node.",
  blueprint: "JSON structured decomposition of the image (from decompose_image), or null.",
  mask_id: "FK into masks.id (ON DELETE RESTRICT — masks are soft-delete-only) — the mask this edit uses, or null for an unmasked edit.",
  mask_mode: "none | inpaint (change inside mask) | preserve (change everything except inside mask).",
  mask_emulated:
    "True when the provider lacks native mask-channel support and the adapter composited output over the original outside the mask.",
  requested_model: "Model id the caller asked for. Null only for the seed node (no model call).",
  served_model: "Model id that actually served the request (differs from requested on fallback). Null until dispatch.",
  provider: "Provider that served the request (google, openai, workers-ai, ...).",
  fallback_reason: "Why a different model served the request, or null when requested == served.",
  input_image_id: "FK into library_images.id — the image fed to the provider.",
  output_image_id: "FK into library_images.id (ON DELETE RESTRICT — images are soft-delete-only) — the generated result, or null until success.",
  error_code: "Machine-readable error code on failure, or null.",
  error_message: "Human-readable error detail on failure, or null.",
  latency_ms: "End-to-end generation latency in milliseconds, or null.",
  token_usage: "JSON token/usage accounting from the provider, or null.",
  cost_estimate: "Estimated cost of this edit in USD, or null.",
  created_via: "Surface that created the revision: ui, api, or mcp.",
  idempotency_key:
    "Optional client dedup key, unique per session. A replay with the same key returns the existing revision; a new key means a deliberate new attempt.",
  is_pinned: "Marks the accepted result on a branch.",
  approval_required: "Whether this revision is gated behind HITL approval.",
  approved_by_surface: "Surface that approved the revision: ui, api, or mcp; null if not approved.",
  approved_at: "Unix timestamp (seconds) of approval, or null.",
  rejection_reason: "Reason captured when a revision is rejected, or null.",
  approval_expires_at: "Unix timestamp (seconds) after which an unapproved revision is swept to 'expired'.",
  created_at: "Unix timestamp (seconds) when the revision was created.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sessionUuid: text("session_uuid")
      .notNull()
      .references(() => sessions.sessionUuid, { onDelete: "cascade" }),
    /** Self-FK. Null ONLY for the root node. Orphan (set null) rather than cascade. */
    parentRevisionId: text("parent_revision_id").references(
      (): AnySQLiteColumn => revisions.id,
      { onDelete: "set null" },
    ),
    attemptNumber: integer("attempt_number").notNull().default(1),
    /**
     * Human display name for the edit-node (NOT the uuid). Seed = "Original";
     * top-level edits = rev1, rev2, …; forks branch with dotted notation
     * (rev2.1, rev2.1.1). Assigned once per edit-node at creation and shared by
     * that node's retry attempts. The uuid (`id`) remains the real identifier.
     */
    revLabel: text("rev_label"),
    editFingerprint: text("edit_fingerprint").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "awaiting_approval",
        "running",
        "succeeded",
        "failed",
        "rejected",
        "expired",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    promptText: text("prompt_text").notNull(),
    // Nullable ONLY for the synthetic root/seed node (edit_payload = null). The
    // service layer requires it non-null for every real edit.
    editPayload: text("edit_payload", { mode: "json" }).$type<unknown>(),
    blueprint: text("blueprint", { mode: "json" }).$type<unknown>(),
    maskId: text("mask_id").references(() => masks.id, { onDelete: "restrict" }),
    maskMode: text("mask_mode", { enum: ["none", "inpaint", "preserve"] })
      .notNull()
      .default("none"),
    maskEmulated: integer("mask_emulated", { mode: "boolean" }).notNull().default(false),
    // Nullable ONLY for the synthetic root/seed node (no model call is ever
    // made for it). The service layer requires it non-null for every real edit.
    requestedModel: text("requested_model"),
    servedModel: text("served_model"),
    provider: text("provider"),
    fallbackReason: text("fallback_reason"),
    /**
     * Provider-side multi-turn handle (e.g. Gemini interaction id), populated on
     * success. A child edit passes the parent's value as `previous_interaction_id`
     * so forking resumes that node's provider conversation natively.
     */
    providerInteractionId: text("provider_interaction_id"),
    /**
     * True when the provider's interaction state was unavailable/expired and the
     * adapter fell back to sending the parent's output image inline — the result
     * differs subtly and the user needs to know.
     */
    providerConversationLost: integer("provider_conversation_lost", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Grounding: `search_suggestions` HTML — MUST be rendered (ToS) when Image Search grounding is used. */
    groundingSearchSuggestions: text("grounding_search_suggestions"),
    /** Grounding: `url_citation` annotations (JSON). */
    groundingCitations: text("grounding_citations", { mode: "json" }).$type<unknown>(),
    /** Which path served the request — `gateway` (AI Gateway) or `direct`. Makes coverage auditable. */
    servedVia: text("served_via", { enum: ["gateway", "direct", "guardian"] }),
    inputImageId: text("input_image_id")
      .notNull()
      .references(() => libraryImages.id, { onDelete: "restrict" }),
    outputImageId: text("output_image_id").references(() => libraryImages.id, {
      onDelete: "restrict",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    tokenUsage: text("token_usage", { mode: "json" }).$type<unknown>(),
    costEstimate: real("cost_estimate"),
    createdVia: text("created_via", { enum: ["ui", "api", "mcp"] })
      .notNull()
      .default("ui"),
    /**
     * Optional client-supplied dedup key. A client resending the SAME key means
     * "I'm not sure you got my request" → the existing revision is returned
     * unchanged. A NEW key with the same edit means "do it again" → a real new
     * attempt. Enforced by the partial unique index below.
     */
    idempotencyKey: text("idempotency_key"),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    approvalRequired: integer("approval_required", { mode: "boolean" })
      .notNull()
      .default(false),
    approvedBySurface: text("approved_by_surface", { enum: ["ui", "api", "mcp"] }),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    rejectionReason: text("rejection_reason"),
    approvalExpiresAt: integer("approval_expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // Retry-race guard AND the two hot read shapes in one index.
    //
    // UNIQUE (session_uuid, parent_revision_id, edit_fingerprint, attempt_number):
    // two surfaces retrying the same stuck edit concurrently both read
    // attempt_number=2 and both try to write 3 — this constraint makes the
    // second write fail so the service layer can re-read and retry, instead of
    // silently creating a duplicate attempt. The service layer allocates
    // attempt_number inside a transaction and retries on constraint violation.
    //
    // Its leftmost prefixes also serve every read we had separate indexes for:
    //   (session_uuid, parent_revision_id)                      -> children-of-node / fork lookup
    //   (session_uuid, parent_revision_id, edit_fingerprint)    -> retry-sibling lookup
    // so the former idx_revisions_session_parent and
    // idx_revisions_session_fingerprint are redundant and intentionally dropped
    // (see the Phase 1 correction report). Cheap to re-add if profiling ever
    // wants a narrower index.
    uniqueIndex("uniq_revisions_retry").on(
      t.sessionUuid,
      t.parentRevisionId,
      t.editFingerprint,
      t.attemptNumber,
    ),
    // The 24h approval-expiry cron sweeps WHERE status='awaiting_approval' AND
    // approval_expires_at < now — without this it full-scans revisions per tick.
    index("idx_revisions_expiry").on(t.status, t.approvalExpiresAt),
    // Exactly-one-root-per-session enforced at the DB. SQLite treats NULLs as
    // distinct in a normal unique index, so uniq_revisions_retry does NOT guard
    // the root (parent_revision_id IS NULL). This PARTIAL unique index does:
    // at most one row per session may have a null parent — the synthetic seed
    // node. Every real edit has a non-null parent and is covered by
    // uniq_revisions_retry instead. The service layer keeps a mirror check so
    // violations surface a useful error, not a raw constraint message.
    uniqueIndex("uniq_revisions_root_per_session")
      .on(t.sessionUuid)
      .where(sql`${t.parentRevisionId} is null`),
    // Idempotency: at most one revision per (session, idempotency_key). A replay
    // with the same key hits this and the service layer returns the existing
    // revision instead of creating a duplicate. Partial so null keys are exempt.
    uniqueIndex("uniq_revisions_idempotency")
      .on(t.sessionUuid, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    // Seed-node nullability, enforced at the DB. The synthetic root
    // (parent_revision_id IS NULL) may have null edit_payload + requested_model;
    // every REAL edit (non-null parent) must carry both. Mirrors the columns
    // made nullable for the seed node. prompt_text stays NOT NULL but is NOT
    // required non-empty here — a structured-only edit (payload, no NL
    // instruction) can legitimately have prompt_text = '' and the service layer
    // normalises it; over-constraining that at the DB would reject valid edits.
    check(
      "ck_revisions_real_edit_has_model",
      sql`${t.parentRevisionId} is null or (${t.editPayload} is not null and ${t.requestedModel} is not null)`,
    ),
  ],
);

export const insertRevisionSchema = createInsertSchema(revisions);
export const selectRevisionSchema = createSelectSchema(revisions);
export type Revision = typeof revisions.$inferSelect;
export type NewRevision = typeof revisions.$inferInsert;
