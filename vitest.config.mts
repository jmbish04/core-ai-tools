/**
 * Vitest configuration for the core service layer. Tests run inside workerd via
 * `@cloudflare/vitest-pool-workers` (v4 API: the `cloudflareTest` Vite plugin),
 * so they exercise the REAL runtime — genuine D1 `batch()` semantics,
 * `crypto.subtle` fingerprinting, and actual SQLite constraint enforcement (the
 * CHECK, the unique indexes, the partial index).
 *
 * We give the pool a minimal inline Miniflare env with just the `DB` D1 binding
 * (not the full wrangler.jsonc — the 12 Durable Objects, assets, browser, etc.
 * are irrelevant to core tests and only complicate setup). The project's real
 * migrations are read from ./drizzle and applied in the setup file.
 */

import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));

  return {
    // Mirror the tsconfig `@/backend/*` path alias the core imports rely on.
    resolve: {
      alias: [
        { find: /^@\/backend\/(.*)$/, replacement: path.resolve(__dirname, "src/backend/$1") },
      ],
    },
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-05-25",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["R2_VIDEO_BUCKET"],
          // Passed through to `env.TEST_MIGRATIONS` for the setup file.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
