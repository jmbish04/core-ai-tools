#!/usr/bin/env node
/**
 * @fileoverview Gate: every committed D1 migration must be re-runnable, except the
 * grandfathered ones. Never mutates `drizzle/`.
 *
 * `db:generate` makes NEW migrations idempotent by running the managed
 * `fix-d1-migrations.mjs`. This is the other half: it fails the build when a
 * migration reaches the repo unfixed, which is the case `db:generate` cannot cover —
 * CI runs `migrate:deploy`, which deliberately never generates, so an unfixed file
 * pushed by someone who skipped `db:generate` would otherwise apply raw SQL to
 * PRODUCTION D1.
 *
 * ## It drives the managed script; it does NOT import it
 *
 * `scripts/fix-d1-migrations.mjs` runs its CLI body at module load, so
 * `import { fixSql }` REWRITES every file in ./drizzle as a side effect. That is not
 * hypothetical — a read-only measurement of this repo silently rewrote 16 shipped
 * migrations. So this spawns it as a child process against a COPY in a temp dir and
 * diffs the result. One transform, one source of truth, no side effect, and no
 * second copy of the regexes to drift.
 *
 * ## Why a baseline instead of just fixing everything
 *
 * 16 of the 18 migrations already shipped to the production D1, and AGENTS.md forbids
 * rewriting a shipped migration: wrangler's ledger records the FILENAME, so an edited
 * file is never re-run and the databases diverge. Those 16 are listed in
 * `migration-idempotency-baseline.txt` and allowed to stay as they are. Anything NOT
 * in that list must be idempotent.
 *
 * The baseline also works as a tamper detector, which is the reason it fails both
 * ways: a baselined file that has BECOME idempotent means somebody edited a shipped
 * migration, so that is an error too, naming the rule. The list can only shrink
 * deliberately.
 *
 * ## What cannot be fixed at all
 *
 * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This reports the count so
 * it stays visible, and never fails on it — a half-applied column-adding migration is
 * wrangler ledger bookkeeping, not something any rewrite can paper over.
 *
 * Usage:
 *   node scripts/check-migrations.mjs [--dir drizzle] [--baseline FILE] [--quiet]
 *
 * Exit codes: 0 ok · 1 a migration needs fixing (or a baseline entry is stale)
 *             2 the managed fixer or the migrations dir is missing
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname;
const FIXER = path.join(HERE, "fix-d1-migrations.mjs");
const DEFAULT_BASELINE = path.join(HERE, "migration-idempotency-baseline.txt");

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const dirFlag = args.indexOf("--dir");
const MIGRATIONS = path.resolve(dirFlag === -1 ? "drizzle" : args[dirFlag + 1]);
const baseFlag = args.indexOf("--baseline");
const BASELINE = baseFlag === -1 ? DEFAULT_BASELINE : path.resolve(args[baseFlag + 1]);

const log = (...m) => { if (!quiet) console.log(...m); };

/** Filenames allowed to stay non-idempotent, because they already shipped. */
function readBaseline() {
  if (!fs.existsSync(BASELINE)) return new Set();
  return new Set(
    fs.readFileSync(BASELINE, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

function fail(code, msg) {
  console.error(`check-migrations: ${msg}`);
  process.exit(code);
}

if (!fs.existsSync(FIXER)) {
  fail(2, `${path.relative(process.cwd(), FIXER)} is missing. It is a colby-ecosystem ` +
          `managed script — run .agents/ecosystem/pull-agents to restore it.`);
}
if (!fs.existsSync(MIGRATIONS)) {
  fail(2, `${MIGRATIONS} not found (pass --dir if the migrations live elsewhere)`);
}

const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  log("check-migrations: no .sql files, nothing to check");
  process.exit(0);
}

// Copy to a temp dir, fix the COPY, diff against the original. The real directory is
// never written to — that is the whole point of not importing the fixer.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-migrations-"));
try {
  for (const f of files) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(tmp, f));

  const run = spawnSync(process.execPath, [FIXER, tmp], { encoding: "utf8" });
  if (run.status !== 0) {
    fail(2, `the managed fixer exited ${run.status}: ${(run.stderr || run.stdout || "").trim()}`);
  }

  const baseline = readBaseline();
  const needsFix = [];   // not idempotent and not baselined -> error
  const grandfathered = []; // not idempotent but baselined -> allowed
  const staleBaseline = []; // baselined yet idempotent -> a shipped file was edited

  for (const f of files) {
    const differs =
      fs.readFileSync(path.join(MIGRATIONS, f), "utf8") !==
      fs.readFileSync(path.join(tmp, f), "utf8");
    if (differs && baseline.has(f)) grandfathered.push(f);
    else if (differs) needsFix.push(f);
    else if (baseline.has(f)) staleBaseline.push(f);
  }

  const missing = [...baseline].filter((f) => !files.includes(f));
  const addColumns = files.reduce(
    (n, f) => n + (fs.readFileSync(path.join(MIGRATIONS, f), "utf8")
      .match(/ALTER\s+TABLE[^;]*\bADD\b/gi)?.length ?? 0),
    0,
  );

  log(`check-migrations: ${files.length} migration(s), ` +
      `${grandfathered.length} grandfathered, ${addColumns} unguardable ADD COLUMN`);

  let bad = false;

  if (needsFix.length) {
    bad = true;
    console.error(
      `\ncheck-migrations: ${needsFix.length} migration(s) are NOT re-runnable:\n` +
      needsFix.map((f) => `  ${f}`).join("\n") +
      `\n\nRun \`node scripts/fix-d1-migrations.mjs\` and commit the result. ` +
      `\`pnpm run db:generate\` does this for you, so this usually means a migration ` +
      `was committed without it.`,
    );
  }

  if (staleBaseline.length) {
    bad = true;
    console.error(
      `\ncheck-migrations: ${staleBaseline.length} baselined migration(s) are now ` +
      `idempotent, which means a SHIPPED migration was edited:\n` +
      staleBaseline.map((f) => `  ${f}`).join("\n") +
      `\n\nAGENTS.md: never rewrite a migration that has shipped remote — wrangler's ` +
      `ledger records the filename, not the contents, so an edited file is never ` +
      `re-run and the databases diverge. Either revert the edit, or, if it was ` +
      `deliberate, drop the name from ${path.basename(BASELINE)} in the same commit.`,
    );
  }

  if (missing.length) {
    bad = true;
    console.error(
      `\ncheck-migrations: ${missing.length} baseline entr(ies) name a file that does ` +
      `not exist:\n` + missing.map((f) => `  ${f}`).join("\n") +
      `\n\nA migration was renamed or deleted. Fix ${path.basename(BASELINE)}.`,
    );
  }

  if (bad) process.exit(1);
  log("check-migrations: ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
