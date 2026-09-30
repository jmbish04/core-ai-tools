#!/usr/bin/env node
/**
 * @fileoverview Drives scripts/check-migrations.mjs against fixture migration dirs.
 *
 * Not in the vitest suite: that runs inside workerd, and this is a Node CLI. Run it
 * directly — `node scripts/__tests__/check-migrations.test.mjs`.
 *
 * Every case is planted — each was confirmed to go red by breaking the script on
 * purpose first. The two that matter most, because both fail silently:
 *
 *   1. NO MUTATION. The obvious "simplification" of this gate is to import `fixSql`
 *      from the managed fixer, or to point the fixer at the real directory. Either
 *      one rewrites every committed migration as a side effect — which is exactly
 *      how 16 shipped migrations in this repo got silently rewritten during a
 *      read-only measurement. `mutation` asserts the input bytes are untouched after
 *      both a passing and a failing run, so that shortcut fails the test.
 *   2. THE BASELINE FAILS BOTH WAYS. A grandfathered file is allowed to stay
 *      non-idempotent, but a grandfathered file that has BECOME idempotent means a
 *      shipped migration was edited, which AGENTS.md forbids. A gate that only
 *      checked one direction would pass through the edit it exists to catch.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dirname, "..", "check-migrations.mjs");

const RAW = "CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL);";
const FIXED = "CREATE TABLE IF NOT EXISTS `a` (`id` text PRIMARY KEY NOT NULL);";

let failures = 0;

/** Build a fixture dir: `files` maps name -> contents; `baseline` is a name list. */
function fixture(files, baseline = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mig-fixture-"));
  const dir = path.join(root, "drizzle");
  fs.mkdirSync(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, "utf8");
  }
  const baselinePath = path.join(root, "baseline.txt");
  fs.writeFileSync(baselinePath, `# fixture\n${baseline.join("\n")}\n`, "utf8");
  return { root, dir, baselinePath };
}

function run({ dir, baselinePath }) {
  const r = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--baseline", baselinePath], {
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Snapshot every file's bytes, so a side effect anywhere is visible. */
function snapshot(dir) {
  return Object.fromEntries(
    fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]),
  );
}

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- happy path
{
  const fx = fixture({ "0001_shipped.sql": RAW, "0002_new.sql": FIXED }, ["0001_shipped.sql"]);
  const { code, out } = run(fx);
  check("grandfathered non-idempotent + idempotent new file passes", code === 0, out);
  check("reports the grandfathered count", /1 grandfathered/.test(out), out);
  fs.rmSync(fx.root, { recursive: true, force: true });
}

// ------------------------------------------- a NEW unfixed migration must fail
{
  const fx = fixture(
    { "0001_shipped.sql": RAW, "0003_bad.sql": "CREATE UNIQUE INDEX `u` ON `a` (`id`);" },
    ["0001_shipped.sql"],
  );
  const { code, out } = run(fx);
  check("a new non-idempotent migration fails the gate", code === 1, out);
  check("names the offending file", out.includes("0003_bad.sql"), out);
  check("does NOT name the grandfathered file as an error",
        !/NOT re-runnable:[\s\S]*0001_shipped/.test(out), out);
  fs.rmSync(fx.root, { recursive: true, force: true });
}

// ------------------------------- a baselined file that became idempotent must fail
{
  const fx = fixture({ "0001_shipped.sql": FIXED }, ["0001_shipped.sql"]);
  const { code, out } = run(fx);
  check("an edited shipped migration fails the gate", code === 1, out);
  check("explains that a shipped migration was edited", /shipped/i.test(out), out);
  fs.rmSync(fx.root, { recursive: true, force: true });
}

// ------------------------------------------ a baseline entry with no file must fail
{
  const fx = fixture({ "0002_new.sql": FIXED }, ["0099_renamed_away.sql"]);
  const { code, out } = run(fx);
  check("a stale baseline entry fails the gate", code === 1, out);
  check("names the missing entry", out.includes("0099_renamed_away.sql"), out);
  fs.rmSync(fx.root, { recursive: true, force: true });
}

// ------------------------------------------------------- the gate never mutates
{
  // Both a passing and a failing run, because the side effect would land either way.
  for (const [label, files, baseline] of [
    ["passing run", { "0001_shipped.sql": RAW, "0002_new.sql": FIXED }, ["0001_shipped.sql"]],
    ["failing run", { "0003_bad.sql": RAW }, []],
  ]) {
    const fx = fixture(files, baseline);
    const before = snapshot(fx.dir);
    run(fx);
    const after = snapshot(fx.dir);
    check(`leaves every migration byte-identical (${label})`,
          JSON.stringify(before) === JSON.stringify(after),
          `before=${JSON.stringify(before)}\n       after=${JSON.stringify(after)}`);
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// ------------------------------------------------- a missing dir is a setup error
{
  const r = spawnSync(process.execPath, [SCRIPT, "--dir", "/nope/not/here"], { encoding: "utf8" });
  check("a missing migrations dir exits 2, not 1", r.status === 2, `${r.stdout}${r.stderr}`);
}

console.log(failures === 0 ? "\ncheck-migrations tests: all passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
