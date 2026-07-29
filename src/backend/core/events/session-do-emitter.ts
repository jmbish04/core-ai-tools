/**
 * @fileoverview `SessionDoEmitter` — the REAL cross-Durable-Object event path,
 * stubbed in Phase 2 and completed in Phase 6.
 *
 * This file exists now, unfinished, so the cross-DO seam is EXPLICIT rather than
 * discovered later: `SessionDO` and the MCP `McpAgent` are separate Durable
 * Objects, so an MCP tool call (or a Hono handler) reaches the session's DO by
 * stub to emit an event. The correct invocation is native DO RPC via
 * `getByName` — NEVER `stub.fetch(new Request(...))`:
 *
 * ```ts
 * // Phase 6 body (SESSION_DO binding + SessionDO class must exist first):
 * const stub = env.SESSION_DO.getByName(sessionUuid);
 * return await stub.appendEvent(event); // SessionDO owns seq allocation
 * ```
 *
 * The `SESSION_DO` binding is deliberately not in `wrangler.jsonc` yet (its class
 * ships in Phase 6), so this implementation guards on the binding's presence and
 * throws `NotImplementedError` until then. Callers use `DirectD1Emitter` in the
 * meantime; swapping to this is a one-line change at the composition root.
 */

import { NotImplementedError } from "../errors";
import type { SessionEventEmitter, SessionEventInput } from "./emitter";

export class SessionDoEmitter implements SessionEventEmitter {
  constructor(private readonly env: Env) {}

  async appendEvent(sessionUuid: string, event: SessionEventInput): Promise<number> {
    const ns = (this.env as unknown as { SESSION_DO?: DurableObjectNamespace }).SESSION_DO;
    if (!ns) {
      throw new NotImplementedError(
        "SessionDoEmitter requires the SESSION_DO binding + SessionDO class. Use DirectD1Emitter where it's absent.",
        { sessionUuid, eventType: event.type },
      );
    }
    // Native DO RPC — the session's DO owns seq allocation. NEVER stub.fetch.
    const stub = ns.getByName(sessionUuid) as unknown as {
      appendEvent(sessionUuid: string, event: SessionEventInput): Promise<number>;
    };
    return stub.appendEvent(sessionUuid, event);
  }
}
