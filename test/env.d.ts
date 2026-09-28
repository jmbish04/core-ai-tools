/**
 * Types for the extra Miniflare bindings the test pool injects.
 *
 * `@cloudflare/vitest-pool-workers` types `env` as `Cloudflare.Env` — the
 * `ProvidedEnv` interface this file used to augment on the `cloudflare:test`
 * module no longer exists, so that augmentation compiled without complaint and
 * left `env.TEST_MIGRATIONS` untyped. It went unnoticed because `test/**` was
 * outside `tsconfig.json#include`, so nothing ever typechecked this directory;
 * it is inside now.
 *
 * `Cloudflare.Env` is deliberately NOT augmented: adding a required property to
 * it makes every `Env` in the Worker (every agent, every route) fail to satisfy
 * the interface. The setup file narrows locally instead — see
 * `./apply-migrations.ts`.
 */

/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "cloudflare:test";

/** The pool's `env`, plus the bindings `vitest.config.mts` adds for the suite. */
export type TestEnv = Cloudflare.Env & {
  /** The project's real migrations, read from ./drizzle by vitest.config.mts. */
  TEST_MIGRATIONS: D1Migration[];
  /** The app shell's rail section ids, read out of the block's own data module. */
  RAIL_SECTION_IDS: string[];
};
