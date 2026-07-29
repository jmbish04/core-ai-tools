/**
 * @fileoverview `SessionEventEmitter` — the seam through which EVERY mutating
 * core operation publishes to a session's event log, regardless of surface.
 *
 * WHY AN INTERFACE (not a direct D1 insert): `revision_events.seq` is a
 * monotonic-per-session counter that also drives the WebSocket replay buffer.
 * Two surfaces mutating one session concurrently (an MCP edit + a UI action, the
 * exact scenario this product is built around) would collide on `MAX(seq)+1`.
 * The allocator therefore belongs in the single-threaded `SessionDO` (Phase 6),
 * which hands out seq without contention. Phase 2 ships a temporary direct-D1
 * implementation behind this interface so the core is testable standalone; that
 * implementation is a documented **Phase 6 casualty**.
 *
 * Whatever the implementation, a seq collision is RETRIED internally and never
 * surfaced or dropped — a gap in the replay buffer is unacceptable.
 */

/** Canonical session event types. Kept as string constants (not an enum) so new
 * event kinds can be added without a breaking enum change; the DB column is free
 * text and the WS client treats unknown types as opaque. */
export const EventType = {
  SessionCreated: "session_created",
  RevisionCreated: "revision_created",
  RevisionStatusChanged: "revision_status_changed",
  RevisionProgress: "revision_progress",
  RevisionPinned: "revision_pinned",
  RevisionCancelled: "revision_cancelled",
  ApprovalRequested: "approval_requested",
  ApprovalDecided: "approval_decided",
  MaskCreated: "mask_created",
  MaskConfirmed: "mask_confirmed",
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

/** A single event to append. `revisionId` is null for session-level events. */
export interface SessionEventInput {
  type: EventTypeValue | string;
  revisionId?: string | null;
  payload?: unknown;
}

/**
 * Publishes events to a session's log. The ONLY way core operations emit.
 * Implementations MUST allocate `seq` safely under concurrency and return the
 * assigned seq.
 */
export interface SessionEventEmitter {
  /**
   * Append one event to `session_uuid`'s log, allocating the next `seq`.
   * @returns the assigned monotonic sequence number.
   */
  appendEvent(sessionUuid: string, event: SessionEventInput): Promise<number>;
}
