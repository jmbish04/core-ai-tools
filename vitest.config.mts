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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * The app shell's rail section ids, read from the block's own data module.
 *
 * The module is TSX importing lucide-react, which the workers pool cannot load,
 * so the ids are extracted here and handed to the suite as a binding — the same
 * trick the migrations use. Read rather than transcribed on purpose: a
 * transcription is a second copy of the truth, and `test/shell-nav.test.ts`
 * exists precisely to catch the two lists disagreeing.
 */
async function readRailSectionIds(): Promise<string[]> {
  const source = await readFile(
    path.join(__dirname, "src/frontend/components/blocks/app-shell-22/components/data.tsx"),
    "utf8",
  );
  // Only the RAIL_* arrays declare records with an `href`; NAV/HERO records do not.
  return [...source.matchAll(/\bid:\s*"([a-z0-9-]+)",\s*\n\s*label:/g)].map((m) => m[1]);
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));
  const railSectionIds = await readRailSectionIds();

  return {
    // Mirror the tsconfig path aliases the code under test relies on. `@/lib/*`
    // is here so the frontend's pure helpers (no JSX, no DOM) can be tested —
    // `lib/nav.ts`, which decides every page's shell chrome, is one of them.
    resolve: {
      alias: [
        // Most specific first — a bare `@/db` must not be eaten by `@/backend/*`.
        // These two are what `api/routes/health.ts` imports; without them the
        // health route could not be imported by a test at all, which is part of
        // why its "returns 200 while running zero checks" bug went unnoticed.
        { find: /^@db\/schemas$/, replacement: path.resolve(__dirname, "src/backend/db/schema") },
        { find: /^@\/db$/, replacement: path.resolve(__dirname, "src/backend/db") },
        { find: /^@\/db\/(.*)$/, replacement: path.resolve(__dirname, "src/backend/db/$1") },
        { find: /^@\/backend\/(.*)$/, replacement: path.resolve(__dirname, "src/backend/$1") },
        { find: /^@\/lib\/(.*)$/, replacement: path.resolve(__dirname, "src/frontend/lib/$1") },
        {
          find: /^@\/components\/(.*)$/,
          replacement: path.resolve(__dirname, "src/frontend/components/$1"),
        },
      ],
    },
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-05-25",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["R2_VIDEO_BUCKET"],
          // Passed through to `env.TEST_MIGRATIONS` for the setup file, and
          // `env.RAIL_SECTION_IDS` for the shell-navigation contract test.
          bindings: { TEST_MIGRATIONS: migrations, RAIL_SECTION_IDS: railSectionIds },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
