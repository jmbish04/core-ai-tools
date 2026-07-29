/**
 * @fileoverview `CoreContext` — the dependency bundle every core operation
 * takes as its first argument. Keeping dependencies explicit (rather than
 * reaching for module-level singletons) is what makes the core testable with no
 * surfaces attached: a test constructs a context over a test D1 + an emitter and
 * calls the functions directly.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";

import type { SessionEventEmitter } from "./events";

export interface CoreContext {
  /** Drizzle client over D1 — the source of truth for all domain state. */
  db: DrizzleD1Database;
  /**
   * The session event channel. Every mutating operation publishes through this
   * after its D1 write commits, which is what makes an edit issued from one
   * surface appear live on another.
   */
  events: SessionEventEmitter;
  /**
   * The Worker env — bindings (IMAGES) and, via `utils/secrets.ts`, secrets.
   * Needed by capability operations (Cloudflare Images from Phase 3, model
   * providers from Phase 4). Domain-only operations ignore it.
   */
  env: Env;
}
