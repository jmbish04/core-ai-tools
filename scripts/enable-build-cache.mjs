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

const API = "https://api.cloudflare.com/client/v4";

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
    const detail = (json.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${detail}`);
  }
  return json.result;
}

const triggers = await api(
  `/accounts/${accountId}/builds/workers/${encodeURIComponent(worker)}/triggers`,
);

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
