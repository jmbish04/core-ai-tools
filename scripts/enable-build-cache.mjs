#!/usr/bin/env node
/**
 * @fileoverview Turn Workers Builds build caching on for this Worker's build trigger.
 *
 * This exists because build caching is NOT a Wrangler setting. There is no field
 * for it anywhere in `wrangler/config-schema.json` (checked against 4.114.0:
 * `build_caching`, `buildCaching` and `build_cache` are all absent), and the only
 * `build` block the file accepts is Custom Builds — `command`/`cwd`/`watch_dir` —
 * which Cloudflare documents as NOT honoured by Workers Builds
 * (developers.cloudflare.com/workers/ci-cd/builds/configuration/). The setting
 * lives on the build TRIGGER, a Cloudflare-side resource, so it is reachable only
 * from the dashboard (Settings > Build > Build cache) or this endpoint:
 *
 *   PATCH /accounts/{account_id}/builds/triggers/{trigger_uuid}
 *   { "build_caching_enabled": true }
 *
 * Nothing in the repo needs to change for the cache to be effective once on: it
 * auto-detects pnpm (caches `.pnpm-store`) and Astro (caches
 * `node_modules/.astro`) from `package.json`. Setting a custom pnpm `store-dir`
 * in an `.npmrc` would silently opt the project out of dependency caching.
 *
 * PREFER the Cloudflare API MCP's `workers_cicd_configure` ({ build_caching_enabled })
 * when that connector is working — per the ecosystem briefing, account state goes
 * through the MCP, and it works in sandboxes that cannot run a shell. This script is
 * the fallback for when it is not (measured 2026-09-28: it returned a malformed
 * result that failed MCP schema validation).
 *
 * TWO measured facts this script exists to encode, both of which silently break a
 * hand-written call (ecosystem briefing, AGENTS-cloudflare-workers.md):
 *
 *   1. Builds endpoints identify a Worker by its immutable TAG, never its name. The
 *      name returns "Resource not found". So the tag is resolved first, from
 *      GET /accounts/{id}/workers/scripts (the `tag` field — NOT `etag`, which is a
 *      different value on the same row).
 *   2. /builds/* requires a USER-scoped API token. An account-scoped token returns
 *      401 / 12006 "Invalid token" on every /builds/* path while working fine on
 *      /workers/scripts — so a token that looks healthy fails only here. Verified
 *      2026-09-28: /workers/scripts returned 200 with 218 scripts while
 *      /builds/workers/.../triggers returned 12006 on the same credential.
 *      That asymmetry is detected below and reported as scope, not as a dead key.
 *
 * Usage (token and account id come from the environment — never hardcode either):
 *   CLOUDFLARE_API_TOKEN=$(tokens show CLOUDFLARE_WRANGLER_API_TOKEN --value-only) \
 *   CLOUDFLARE_ACCOUNT_ID=$(tokens show CLOUDFLARE_ACCOUNT_ID --value-only) \
 *   node scripts/enable-build-cache.mjs
 *
 * Flags:
 *   --worker <name>  Worker to configure (default: core-ai-tools)
 *   --disable        Set build_caching_enabled to false instead of true
 *   --dry-run        Report the current state and the intended change, write nothing
 */

// Overridable so the tag-resolution and token-scope branches can be exercised
// against a stub (scripts/__tests__/enable-build-cache.test.mjs). Never set this
// in normal use.
const API = process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const worker = opt("worker", "core-ai-tools");
const enable = !flag("disable");
const dryRun = flag("dry-run");

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.error(
    "Missing CLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ACCOUNT_ID in the environment.\n" +
      "Get them from the tokens CLI; do not paste literals into this file:\n" +
      "  CLOUDFLARE_API_TOKEN=$(tokens show CLOUDFLARE_WRANGLER_API_TOKEN --value-only) \\\n" +
      "  CLOUDFLARE_ACCOUNT_ID=$(tokens show CLOUDFLARE_ACCOUNT_ID --value-only) \\\n" +
      "  node scripts/enable-build-cache.mjs",
  );
  process.exit(2);
}

/**
 * Call the Cloudflare API and fail loud on a non-success envelope.
 *
 * @param {string} path Path under /client/v4, starting with a slash.
 * @param {{method?: string, body?: unknown}} [init] Method and JSON body.
 * @returns {Promise<any>} The `result` field of the response envelope.
 * @throws {Error} When the HTTP status or the `success` flag says the call failed.
 *   The token is never echoed into the message.
 */
async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errors = json.errors ?? [];
    const detail = errors.map((e) => `${e.code}: ${e.message}`).join("; ");
    const err = new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${detail}`);
    err.codes = errors.map((e) => e.code);
    throw err;
  }
  return json.result;
}

/**
 * Resolve a Worker's immutable tag, which is what the builds endpoints key off.
 *
 * @param {string} name The Worker name, as `wrangler.jsonc` spells it.
 * @returns {Promise<string>} The tag.
 * @throws {Error} When no script on the account carries that name.
 * @example await resolveTag("core-ai-tools") // "079fa83f09934c06916d0bee1ea1b07a"
 */
async function resolveTag(name) {
  const scripts = await api(`/accounts/${accountId}/workers/scripts`);
  const hit = (scripts ?? []).find((s) => s.id === name);
  if (!hit?.tag) {
    throw new Error(
      `No Worker named "${name}" on this account, so its build tag cannot be resolved. ` +
        `Pass --worker with the name as wrangler.jsonc spells it.`,
    );
  }
  return hit.tag;
}

// The tag lookup also doubles as the control for fact 2: if /workers/scripts
// succeeds and /builds/* then 401s, the token is account-scoped, not invalid.
const tag = await resolveTag(worker);

let triggers;
try {
  triggers = await api(`/accounts/${accountId}/builds/workers/${tag}/triggers`);
} catch (err) {
  if (err.codes?.includes(12006)) {
    console.error(
      `The Builds API rejected this token (12006), but /workers/scripts accepted it ` +
        `just now — so the token is valid and ACCOUNT-scoped, and /builds/* needs a ` +
        `USER-scoped one. Supply a user-scoped token rather than rotating this one:\n` +
        `  ${err.message}`,
    );
    process.exit(3);
  }
  throw err;
}

if (!Array.isArray(triggers) || triggers.length === 0) {
  console.error(
    `No Workers Builds triggers found for "${worker}". Connect the repository first ` +
      `(Workers & Pages > ${worker} > Settings > Build), then re-run.`,
  );
  process.exit(1);
}

for (const trigger of triggers) {
  const uuid = trigger.trigger_uuid ?? trigger.uuid;
  const label = trigger.trigger_name ?? uuid;
  const before = trigger.build_caching_enabled === true;

  if (before === enable) {
    console.log(`${label}: build caching already ${enable ? "on" : "off"} — nothing to do.`);
    continue;
  }
  if (dryRun) {
    console.log(`${label}: would set build_caching_enabled ${before} -> ${enable}.`);
    continue;
  }

  const updated = await api(`/accounts/${accountId}/builds/triggers/${uuid}`, {
    method: "PATCH",
    body: { build_caching_enabled: enable },
  });
  // Report what came back rather than what was sent: the write is only real if
  // the server echoes it.
  console.log(
    `${label}: build_caching_enabled ${before} -> ${updated?.build_caching_enabled === true}.`,
  );
}
