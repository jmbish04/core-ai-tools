/**
 * @fileoverview Cloudflare Images named variants + delivery-URL construction.
 *
 * All image bytes live in Cloudflare Images; D1 stores the id. Delivery URLs are
 * `https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>`. The three
 * named variants must be created on the account out-of-band (dashboard or the
 * `/images/v1/variants` API). The tree canvas uses `thumb` EXCLUSIVELY, or a
 * large session is unusable.
 *
 * URL construction FAILS LOUD if the account hash is unresolved — emitting
 * `imagedelivery.net/undefined/...` would 404 in a way that looks like a missing
 * image rather than missing configuration.
 */

import { getImagesAccountHash } from "@/backend/utils/secrets";
import { ConfigError } from "../errors";

/** The named variants this product relies on. */
export const IMAGE_VARIANTS = {
  /** Tree-canvas thumbnails — the ONLY variant the node graph loads. */
  THUMB: "thumb",
  /** Detail-pane preview. */
  PREVIEW: "preview",
  /** Full-resolution delivery + what the provider fetch path uses. */
  FULL: "full",
} as const;

export type ImageVariant = (typeof IMAGE_VARIANTS)[keyof typeof IMAGE_VARIANTS];

const DELIVERY_HOST = "https://imagedelivery.net";

/**
 * Pure delivery-URL builder. Throws (fail loud) if `accountHash` is empty so a
 * misconfiguration never becomes a silently-broken `/undefined/` URL.
 */
export function buildVariantUrl(
  accountHash: string,
  cfImageId: string,
  variant: ImageVariant,
): string {
  if (!accountHash) {
    throw new ConfigError(
      "Cannot build a Cloudflare Images delivery URL: account hash is empty. Refusing to emit imagedelivery.net/undefined/...",
    );
  }
  if (!cfImageId) {
    throw new ConfigError("Cannot build a delivery URL: cfImageId is empty.");
  }
  return `${DELIVERY_HOST}/${accountHash}/${cfImageId}/${variant}`;
}

/** Resolve the account hash from the env and build one variant URL. */
export async function variantUrl(
  env: Env,
  cfImageId: string,
  variant: ImageVariant,
): Promise<string> {
  const hash = await getImagesAccountHash(env);
  if (!hash) {
    throw new ConfigError(
      "CLOUDFLARE_IMAGES_ACCOUNT_HASH did not resolve. Set the secret / binding before building delivery URLs.",
    );
  }
  return buildVariantUrl(hash, cfImageId, variant);
}

/** All three variant URLs for an image (one hash lookup). */
export async function variantUrls(
  env: Env,
  cfImageId: string,
): Promise<{ thumb: string; preview: string; full: string }> {
  const hash = await getImagesAccountHash(env);
  if (!hash) {
    throw new ConfigError(
      "CLOUDFLARE_IMAGES_ACCOUNT_HASH did not resolve. Set the secret / binding before building delivery URLs.",
    );
  }
  return {
    thumb: buildVariantUrl(hash, cfImageId, IMAGE_VARIANTS.THUMB),
    preview: buildVariantUrl(hash, cfImageId, IMAGE_VARIANTS.PREVIEW),
    full: buildVariantUrl(hash, cfImageId, IMAGE_VARIANTS.FULL),
  };
}
