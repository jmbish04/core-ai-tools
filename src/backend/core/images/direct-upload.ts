/**
 * @fileoverview Direct Creator Upload — mint a one-time upload URL so browser
 * bytes go STRAIGHT to Cloudflare Images and never proxy through the Worker
 * (§2.4). This is a REST call (the Images binding does not mint creator URLs):
 * `POST /accounts/{id}/images/v2/direct_upload`.
 *
 * Token: prefer the purpose-scoped `CLOUDFLARE_IMAGES_STREAM_TOKEN`; if it lacks
 * Images write scope (403), fall back to the broad wrangler token and log a note
 * — never block on it. Secrets are read only through `utils/secrets.ts`, only
 * inside this function (never module scope), and are NEVER logged (the error
 * paths below quote status + response body, which carry no credential).
 */

import {
  getCloudflareAccountId,
  getCloudflareApiToken,
  getImagesApiToken,
} from "@/backend/utils/secrets";
import { ConfigError } from "../errors";

export interface DirectUploadIntent {
  /** One-time URL the client POSTs the raw file to (multipart `file`). */
  uploadURL: string;
  /** The Cloudflare Images id the uploaded image will have. */
  cfImageId: string;
}

export interface MintOptions {
  requireSignedURLs?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Mint a direct creator upload URL. The returned `uploadURL` is what the browser
 * uploads to directly; `cfImageId` is registered on the library row at completion.
 */
export async function mintDirectUploadUrl(
  env: Env,
  opts: MintOptions = {},
): Promise<DirectUploadIntent> {
  const accountId = await getCloudflareAccountId(env);
  if (!accountId) {
    throw new ConfigError("CLOUDFLARE_ACCOUNT_ID did not resolve; cannot mint an upload URL.");
  }
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2/direct_upload`;

  const buildBody = () => {
    const form = new FormData();
    if (opts.requireSignedURLs != null) {
      form.set("requireSignedURLs", String(opts.requireSignedURLs));
    }
    if (opts.metadata) form.set("metadata", JSON.stringify(opts.metadata));
    return form;
  };

  // First attempt: the least-privilege Images token.
  let token = await getImagesApiToken(env);
  let res = token
    ? await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: buildBody(),
      })
    : undefined;

  // Fall back to the wrangler token on a missing/unscoped Images token.
  if (!res || res.status === 401 || res.status === 403) {
    token = await getCloudflareApiToken(env);
    if (!token) {
      throw new ConfigError("No usable Cloudflare API token resolved for Images direct upload.");
    }
    if (res) {
      console.warn(
        "[images] CLOUDFLARE_IMAGES_STREAM_TOKEN missing/unscoped for direct_upload; fell back to CLOUDFLARE_WRANGLER_API_TOKEN",
      );
    }
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: buildBody(),
    });
  }

  if (!res.ok) {
    // Body is a Cloudflare error envelope (no credential); safe to surface.
    const body = await res.text().catch(() => "");
    throw new Error(`Direct upload mint failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    result?: { uploadURL?: string; id?: string };
    success?: boolean;
  };
  const uploadURL = json.result?.uploadURL;
  const cfImageId = json.result?.id;
  if (!uploadURL || !cfImageId) {
    throw new Error("Direct upload mint returned no uploadURL/id.");
  }
  return { uploadURL, cfImageId };
}
