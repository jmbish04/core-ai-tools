/**
 * @fileoverview TEMPORARY direct-D1 event emitter — a **Phase 6 casualty**.
 *
 * Allocates `seq` with `MAX(seq)+1` and inserts, retrying on the
 * `idx_revision_events_session_seq` unique-constraint violation that a
 * concurrent writer causes. This is correct but contended: under real
 * concurrency it can thrash. Phase 6 replaces it with `SessionDoEmitter`, which
 * routes through the single-threaded `SessionDO` and needs no retry at all.
 *
 * DELETE THIS FILE in Phase 6 once every core caller receives the DO-backed
 * emitter. Until then it keeps the core testable with no Durable Object.
 */

import { desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { revisionEvents } from "@/backend/db/schema";
import { isUniqueViolation } from "../errors";
import type { SessionEventEmitter, SessionEventInput } from "./emitter";

/** Max optimistic retries before giving up — generous; real contention is rare
 * at the direct-D1 stage and vanishes entirely once the DO owns allocation. */
const MAX_SEQ_RETRIES = 25;

export class DirectD1Emitter implements SessionEventEmitter {
  constructor(private readonly db: DrizzleD1Database) {}

  async appendEvent(sessionUuid: string, event: SessionEventInput): Promise<number> {
    for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
      // Read the current high-water mark for this session.
      const [last] = await this.db
        .select({ seq: revisionEvents.seq })
        .from(revisionEvents)
        .where(eq(revisionEvents.sessionUuid, sessionUuid))
        .orderBy(desc(revisionEvents.seq))
        .limit(1);
      const nextSeq = (last?.seq ?? 0) + 1;

      try {
        await this.db.insert(revisionEvents).values({
          sessionUuid,
          revisionId: event.revisionId ?? null,
          seq: nextSeq,
          eventType: event.type,
          payload: event.payload ?? null,
        });
        return nextSeq;
      } catch (err) {
        // Someone else took nextSeq between our read and write — re-read and try
        // again. Any non-unique error is a real failure and propagates.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    // Exhausting retries means pathological contention, not a lost event. Surface
    // it loudly rather than silently dropping — the caller (and the UI) must know.
    throw new Error(
      `DirectD1Emitter: could not allocate seq for session ${sessionUuid} after ${MAX_SEQ_RETRIES} attempts`,
    );
  }
}
