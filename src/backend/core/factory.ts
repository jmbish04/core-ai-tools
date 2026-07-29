/**
 * @fileoverview Composition root for the core. Surfaces (Hono, MCP, cron) build a
 * `CoreContext` here rather than wiring dependencies by hand, so there is ONE
 * place that decides which event emitter is in play.
 *
 * Today that is `DirectD1Emitter` (temporary, Phase 6 casualty). In Phase 6 this
 * factory switches to `SessionDoEmitter` — a single-line change that upgrades
 * every surface at once, which is the whole point of routing through here.
 */

import { getDb } from "@/backend/db";
import type { CoreContext } from "./context";
import { DirectD1Emitter, SessionDoEmitter } from "./events";

/**
 * Build a CoreContext from the Worker env. When the `SESSION_DO` binding is
 * present (production), events route through the DO (single-threaded seq
 * allocation, WS fanout). Where it's absent (unit tests / bare local), the
 * DirectD1Emitter writes the same events to the same D1 — the temporary path.
 */
export function createCoreContext(env: Env): CoreContext {
  const db = getDb(env);
  const hasSessionDO = Boolean((env as unknown as { SESSION_DO?: unknown }).SESSION_DO);
  return {
    db,
    events: hasSessionDO ? new SessionDoEmitter(env) : new DirectD1Emitter(db),
    env,
  };
}
