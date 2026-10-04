#!/usr/bin/env node
/**
 * @fileoverview Asserts the repo has NO Workers AI binding and no `env.AI` call.
 *
 * `env.AI.run` is account-implicit: it always lands on the paid account and
 * cannot be metered per-account, so it is the one inference path that bills the
 * card while staying invisible to budget checks and the breaker. Core-guardian
 * is the only door — `GUARDIAN` (the `GuardianRpc` entrypoint) for RPC, plus
 * `GUARDIAN_HTTP` for its REST surface.
 *
 * Why a test and not a line in AGENTS.md: the binding is ONE line, the upstream
 * template ships with it, and re-adding it makes `wrangler types` put `AI` back
 * on `Env` so every `env.AI.run` call site typechecks again. Prose cannot fail.
 *
 * Why plain node rather than the vitest suite: that suite runs inside workerd,
 * which has no real filesystem — `fs.readFileSync` on a repo file throws there.
 * These are source-level invariants, so they need the same home as
 * check-migrations.
 *
 * Run: `node scripts/__tests__/no-ai-binding.test.mjs` (via `pnpm run test:scripts`).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
let failures = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** wrangler.jsonc with comments and trailing commas stripped. */
function wranglerConfig() {
  const raw = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const noComments = raw.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
}

/** Every .ts/.tsx under src/. */
function sourceFiles(dir = path.join(ROOT, "src")) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const cfg = wranglerConfig();

// ------------------------------------------------------------- the binding
check("wrangler.jsonc declares no `ai` block", cfg.ai === undefined, JSON.stringify(cfg.ai));

const types = fs.readFileSync(path.join(ROOT, "worker-configuration.d.ts"), "utf8");
check(
  "the generated Env does not carry an AI binding",
  !/^\s*AI:\s/m.test(types),
  (types.match(/^\s*AI:\s.*$/m) || [])[0],
);

// ------------------------------------------------------- guardian, both doors
const services = cfg.services ?? [];
const rpc = services.find((s) => s.binding === "GUARDIAN");
const http = services.find((s) => s.binding === "GUARDIAN_HTTP");

check("GUARDIAN is bound to core-guardian", rpc?.service === "core-guardian", JSON.stringify(rpc));
// Naming the entrypoint is what makes `.run()` reach the RPC door rather than
// guardian's default fetch handler.
check("GUARDIAN names the GuardianRpc entrypoint", rpc?.entrypoint === "GuardianRpc", JSON.stringify(rpc));
check("GUARDIAN_HTTP is bound to core-guardian", http?.service === "core-guardian", JSON.stringify(http));
// One binding cannot serve both doors: naming an entrypoint changes what
// `.fetch()` resolves to, so the REST surface needs its own plain binding.
check("GUARDIAN_HTTP names no entrypoint", http?.entrypoint === undefined, JSON.stringify(http));

// ------------------------------------------------------------ no env.AI calls
const offenders = [];
for (const file of sourceFiles()) {
  fs.readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      // Strip line comments and block-comment bodies so the explanations of why
      // this is banned do not trip the check.
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (/\benv\.AI\b/.test(code)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      }
    });
}
check(
  "no source file calls env.AI — route through core-guardian",
  offenders.length === 0,
  offenders.join("\n      "),
);

// ------------------------------------------------- the enabling dependency
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
// This package exists only to wire `env.AI` into the AI SDK; keeping it
// installed is a standing invitation to re-add the binding.
check("workers-ai-provider is not a dependency", deps["workers-ai-provider"] === undefined);

// --------------------------------------------- the picker speaks guardian
const chatModels = fs.readFileSync(
  path.join(ROOT, "src/backend/ai/models/chat-models.ts"),
  "utf8",
);
const ids = [...chatModels.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
check("the chat picker offers at least one option", ids.length > 0, JSON.stringify(ids));
// A `@cf/...` id only ever meant anything to the Workers AI binding.
check(
  "no chat option is a provider model id",
  ids.every((id) => !id.startsWith("@")),
  JSON.stringify(ids.filter((id) => id.startsWith("@"))),
);
check("`auto` is among the guardian aliases", ids.includes("auto"), JSON.stringify(ids));

// ----------------------------------------------- the MODEL_* vars follow suit
const llmVars = ["MODEL_CHAT", "MODEL_EXTRACT", "MODEL_DRAFT"];
const bad = llmVars.filter((k) => String(cfg.vars?.[k] ?? "").startsWith("@"));
check(
  "LLM MODEL_* vars are guardian aliases, not @cf/ ids",
  bad.length === 0,
  bad.map((k) => `${k}=${cfg.vars[k]}`).join(", "),
);

console.log(failures === 0 ? "\nno-ai-binding: all checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
