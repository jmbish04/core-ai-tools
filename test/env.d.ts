/**
 * Type augmentation for the `cloudflare:test` module env used in tests. Extends
 * the Worker's global `Env` with the migrations array we inject via Miniflare
 * bindings so `applyD1Migrations` is fully typed.
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
