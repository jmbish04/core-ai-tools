/**
 * @fileoverview Cloudflare Images health probe. Returns BOOLEANS ONLY — never a
 * secret value — for the `/health` surface (wired in a later phase). Confirms the
 * binding is present and the config/token resolve, so a broken Images setup is
 * visible before an upload fails mid-session.
 */

import {
  getCloudflareApiToken,
  getImagesAccountHash,
  getImagesApiToken,
} from "@/backend/utils/secrets";

export interface ImagesHealth {
  /** The `IMAGES` binding is present with its hosted namespace. */
  binding: boolean;
  /** `CLOUDFLARE_IMAGES_ACCOUNT_HASH` resolves (needed for delivery URLs). */
  accountHash: boolean;
  /** An Images REST token resolves (stream token, or wrangler-token fallback). */
  restToken: boolean;
}

/** Probe Images configuration. Never returns or logs secret values. */
export async function imagesHealth(env: Env): Promise<ImagesHealth> {
  const binding = typeof env.IMAGES?.hosted?.upload === "function";
  const accountHash = Boolean(await getImagesAccountHash(env).catch(() => undefined));
  const restToken =
    Boolean(await getImagesApiToken(env).catch(() => undefined)) ||
    Boolean(await getCloudflareApiToken(env).catch(() => undefined));
  return { binding, accountHash, restToken };
}
