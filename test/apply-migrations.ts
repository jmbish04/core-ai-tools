/**
 * Vitest setup: per-test storage isolation.
 *
 * `@cloudflare/vitest-pool-workers` v4 no longer auto-isolates storage per test
 * (v3 did). Instead it exposes `reset()`, which wipes all attached bindings. So
 * we reset AND re-apply the project's real migrations before every test, giving
 * each test a clean, migrated database — the isolation the pool used to provide
 * implicitly. `applyD1Migrations` is idempotent and cheap against local D1.
 */

import { applyD1Migrations, env, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
