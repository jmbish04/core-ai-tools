/**
 * @fileoverview Secret + signing-key helpers for the template.
 *
 * Reads values from the Secrets Store bindings declared in `wrangler.jsonc`
 * (which expose an async `.get()`), falling back to plain env vars for local
 * development. Domain-specific helpers (Google service accounts, R2 access
 * keys, third-party integrations) were removed when this repo was slimmed to
 * a template — add your own as you wire new integrations.
 */

/**
 * Generic helper to read a secret value by binding name.
 *
 * Precedence:
 * 1. Secrets Store / Secret binding (async `.get()`)
 * 2. Plain env var (string) — local/dev fallback
 */
export async function getSecret(env: Env, key: string): Promise<string | undefined> {
  const envVal = (env as Record<string, any>)[key];
  if (envVal && typeof envVal?.get === "function") {
    return await envVal.get();
  }
  return envVal;
}

/**
 * Fetch the WORKER_API_KEY (used for the single-user login + GitHub webhook
 * signature verification).
 */
export async function getWorkerApiKey(env: Env): Promise<string | undefined> {
  if (env.WORKER_API_KEY) {
    return typeof env.WORKER_API_KEY === "string"
      ? env.WORKER_API_KEY
      : await (env.WORKER_API_KEY as any).get();
  }
  return getSecret(env, "WORKER_API_KEY");
}

/** Fetch the Cloudflare API token (Wrangler / provisioning operations). */
export async function getCloudflareApiToken(env: Env): Promise<string | undefined> {
  if (env.CLOUDFLARE_WRANGLER_API_TOKEN) {
    return typeof env.CLOUDFLARE_WRANGLER_API_TOKEN === "string"
      ? env.CLOUDFLARE_WRANGLER_API_TOKEN
      : await (env.CLOUDFLARE_WRANGLER_API_TOKEN as any).get();
  }
  return getSecret(env, "CLOUDFLARE_WRANGLER_API_TOKEN");
}

/**
 * Fetch the Cloudflare Images account hash — the public identifier embedded in
 * delivery URLs (`imagedelivery.net/<HASH>/<image_id>/<variant>`). Not secret,
 * but stored in the Secrets Store so there is a single resolution path.
 */
export async function getImagesAccountHash(env: Env): Promise<string | undefined> {
  return getSecret(env, "CLOUDFLARE_IMAGES_ACCOUNT_HASH");
}

/**
 * Purpose-scoped Cloudflare Images REST token (direct upload, variants, delete).
 * Prefer this least-privilege token; the Images adapter falls back to the broad
 * wrangler token (`getCloudflareApiToken`) if this one lacks Images write scope.
 */
export async function getImagesApiToken(env: Env): Promise<string | undefined> {
  return getSecret(env, "CLOUDFLARE_IMAGES_STREAM_TOKEN");
}

/** Google Gemini API key (header `x-goog-api-key`, never a query string). */
export async function getGeminiApiKey(env: Env): Promise<string | undefined> {
  return getSecret(env, "GEMINI_API_KEY");
}

/** OpenAI API key (header `Authorization: Bearer`). */
export async function getOpenAiApiKey(env: Env): Promise<string | undefined> {
  return getSecret(env, "OPENAI_API_KEY");
}

/**
 * AI Gateway auth token — sent as `cf-aig-authorization: Bearer <token>` when a
 * request is routed through an authenticated Cloudflare AI Gateway. Optional: if
 * unset, the gateway must be unauthenticated (or we call the provider directly).
 */
export async function getAiGatewayToken(env: Env): Promise<string | undefined> {
  return getSecret(env, "AI_GATEWAY_TOKEN");
}

/** Fetch the Cloudflare account id. */
export async function getCloudflareAccountId(env: Env): Promise<string | undefined> {
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    return typeof env.CLOUDFLARE_ACCOUNT_ID === "string"
      ? env.CLOUDFLARE_ACCOUNT_ID
      : await (env.CLOUDFLARE_ACCOUNT_ID as any).get();
  }
  return getSecret(env, "CLOUDFLARE_ACCOUNT_ID");
}

/**
 * HMAC key used to sign the session cookie.
 *
 * Stored in the `SESSIONS` KV namespace (not the Secrets Store) so it can be
 * rotated at runtime without a redeploy. Auto-provisions a random key on first
 * use, with a dev fallback if KV is unavailable.
 */
export async function getCookieSigningKey(env: Env): Promise<string> {
  // Derive the cookie signing key DETERMINISTICALLY from the worker key. This is
  // stable across deploys, isolates, and regions with no KV dependency — the old
  // KV approach fell back to a DIFFERENT constant on any KV read hiccup, which
  // silently re-signed with the wrong key and logged the user out. A static
  // version salt namespaces it so the raw worker key is never the HMAC secret.
  const base = await getWorkerApiKey(env);
  if (base) return `cr_session_v1:${base.trim()}`;

  // Fallback only if the worker key is somehow unavailable: reuse the legacy KV
  // key so existing sessions still verify.
  try {
    let key = await env.SESSIONS.get("COOKIE_SIGNING_KEY");
    if (key) return key;
    key = crypto.randomUUID();
    await env.SESSIONS.put("COOKIE_SIGNING_KEY", key);
    return key;
  } catch (e) {
    console.warn("Failed to read/write COOKIE_SIGNING_KEY from KV", e);
    return "default_dev_key_fallback";
  }
}

/**
 * GitHub webhook secret. Maps to WORKER_API_KEY in this template.
 */
export async function getGitHubWebhookSecret(env: Env): Promise<string> {
  const secret = await getWorkerApiKey(env);
  if (!secret) {
    throw new Error("Missing WORKER_API_KEY in Secrets Store");
  }
  return secret;
}
