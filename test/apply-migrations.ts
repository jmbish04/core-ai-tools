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

import type { TestEnv } from "./env";

// `env` is typed as the Worker's own `Cloudflare.Env`, which knows nothing about
// the suite-only bindings vitest.config.mts adds. Narrowed here rather than by
// augmenting `Cloudflare.Env`, because a required property on that interface
// breaks every `Env` in the Worker.
const testEnv = env as unknown as TestEnv;

beforeEach(async () => {
  await reset();
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});
