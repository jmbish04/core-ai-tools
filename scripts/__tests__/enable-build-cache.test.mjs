#!/usr/bin/env node
/**
 * @fileoverview Drives scripts/enable-build-cache.mjs against a stub Cloudflare API.
 *
 * Not in the vitest suite: that runs inside workerd, and this is a Node CLI. Run it
 * directly — `node scripts/__tests__/enable-build-cache.test.mjs`.
 *
 * It exists because the two things the script encodes are exactly the things that
 * fail silently, and neither could be checked against the real API from a container
 * with no Cloudflare token:
 *
 *   1. The builds path must carry the Worker's TAG, not its name. A name gives
 *      "Resource not found" — which reads as "no CI/CD configured", not as a bug.
 *   2. A 12006 on /builds/* after /workers/scripts succeeded means the token is
 *      account-scoped, not dead. Reporting it as dead sends someone to rotate a
 *      working credential.
 *
 * Each case is planted: it asserts the stub saw the TAG (so passing the name fails
 * the test), and that the scope case exits 3 with the word "scoped".
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

const SCRIPT = path.join(import.meta.dirname, "..", "enable-build-cache.mjs");
const NAME = "core-ai-tools";
const TAG = "079fa83f09934c06916d0bee1ea1b07a";

/** Start a stub Cloudflare API. `mode` picks which failure to simulate. */
function stub(mode) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const ok = (result) => send(200, { success: true, result, errors: [], messages: [] });

    if (req.url.endsWith("/workers/scripts")) {
      // etag is deliberately a DIFFERENT value: picking the wrong field must fail.
      return ok([{ id: NAME, tag: TAG, etag: "wrong-field-do-not-use" }]);
    }
    if (req.url.includes("/builds/workers/")) {
      if (mode === "scope") {
        return send(401, {
          success: false, result: null, messages: [],
          errors: [{ code: 12006, message: "Invalid token" }],
        });
      }
      // Cloudflare's real answer when the path carries a NAME instead of a tag.
      if (!req.url.includes(TAG)) {
        return send(404, {
          success: false, result: null, messages: [],
          errors: [{ code: 10007, message: "Resource not found" }],
        });
      }
      return ok([{ trigger_uuid: "t-1", trigger_name: "production", build_caching_enabled: false }]);
    }
    if (req.url.includes("/builds/triggers/")) {
      if (mode === "noecho") {
        // 200, but the flag is absent — the shape that used to exit 0 reporting
        // "false -> false", i.e. a failure that read as "nothing to do".
        return ok({ trigger_uuid: "t-1" });
      }
      return ok({ trigger_uuid: "t-1", build_caching_enabled: true });
    }
    return send(404, { success: false, result: null, errors: [], messages: [] });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, seen, port: server.address().port }),
    );
  });
}

function run(port, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...process.env,
        CLOUDFLARE_API_BASE: `http://127.0.0.1:${port}`,
        CLOUDFLARE_API_TOKEN: "stub-token",
        CLOUDFLARE_ACCOUNT_ID: "stub-account",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) {
    failures++;
    if (detail) console.log(`      ${detail.trim().split("\n").join("\n      ")}`);
  }
};

// Case 1 — the happy path must address the builds endpoint BY TAG.
{
  const { server, seen, port } = await stub("ok");
  const { code, out } = await run(port);
  server.close();
  const buildsCalls = seen.filter((s) => s.includes("/builds/workers/"));
  check("enables caching and exits 0", code === 0, out);
  check("reports the server's echoed value", /build_caching_enabled false -> true/.test(out), out);
  check(
    "addresses /builds/workers by TAG, not name",
    buildsCalls.length === 1 && buildsCalls[0].includes(TAG) && !buildsCalls[0].includes(NAME),
    `builds calls: ${JSON.stringify(buildsCalls)}`,
  );
  check(
    "does not use the etag field",
    !buildsCalls.some((c) => c.includes("wrong-field-do-not-use")),
    `builds calls: ${JSON.stringify(buildsCalls)}`,
  );
}

// Case 2 — a 12006 must be reported as SCOPE, not as an invalid credential.
{
  const { server, port } = await stub("scope");
  const { code, out } = await run(port);
  server.close();
  check("exits 3 on a Builds-API 12006", code === 3, out);
  check("names the scope, not a dead key", /scoped/i.test(out), out);
  // Intent, not wording: it may mention rotation only to rule it OUT, and it must
  // name the credential that actually works. An earlier version of this check pattern-
  // matched one exact phrasing and failed a message that had been IMPROVED to
  // "Do NOT rotate this token" — a check that fails on a better answer is not a check.
  const mentionsRotation = /rotat/i.test(out);
  const rotationIsNegated = /(do ?n[o']?t|never|rather than|instead of)[^.\n]{0,24}rotat/i.test(out);
  check(
    "never advises rotating the working token",
    !mentionsRotation || rotationIsNegated,
    out,
  );
  check(
    "names the user-scoped token as the fix",
    /CLOUDFLARE_USER_WRANGLER_API_TOKEN/.test(out),
    out,
  );
}

// Case 3 — an unknown Worker name fails before any builds call.
{
  const { server, seen, port } = await stub("ok");
  const { code, out } = await run(port, ["--worker", "no-such-worker"]);
  server.close();
  check("unknown worker name exits non-zero", code !== 0, out);
  check(
    "never reaches /builds/* with an unresolved name",
    !seen.some((s) => s.includes("/builds/")),
    `saw: ${JSON.stringify(seen)}`,
  );
}

// Case 4 — a PATCH that returns 200 without echoing the flag must FAIL LOUDLY.
{
  const { server, port } = await stub("noecho");
  const { code, out } = await run(port);
  server.close();
  check("exits non-zero when the echo does not confirm the write", code !== 0, out);
  check("says the setting is NOT changed", /NOT changed/i.test(out), out);
  // The old code's exact symptom: a result line reading "false -> false", printed on
  // stdout beside exit 0, which a reader parses as "already correct, nothing to do".
  // An earlier version of this check looked for "false -> true" — a string the bug
  // never produced — so it passed against the broken code and reported nothing.
  check(
    "does not print a result line for a write it could not confirm",
    !/build_caching_enabled false -> false/.test(out),
    out,
  );
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
