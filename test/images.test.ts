/**
 * Cloudflare Images pure-logic tests. The binding + REST calls aren't emulated in
 * the pool, so this covers the flagged risk: delivery-URL construction must FAIL
 * LOUD on missing config rather than emit `imagedelivery.net/undefined/...`.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildVariantUrl, ConfigError, IMAGE_VARIANTS, variantUrl } from "@/backend/core";

describe("cloudflare images — variant URLs", () => {
  it("builds a delivery URL for each named variant", () => {
    expect(buildVariantUrl("HASH", "img-1", IMAGE_VARIANTS.THUMB)).toBe(
      "https://imagedelivery.net/HASH/img-1/thumb",
    );
    expect(buildVariantUrl("HASH", "img-1", IMAGE_VARIANTS.FULL)).toBe(
      "https://imagedelivery.net/HASH/img-1/full",
    );
  });

  it("FAILS LOUD on an empty account hash (never emits /undefined/)", () => {
    expect(() => buildVariantUrl("", "img-1", IMAGE_VARIANTS.THUMB)).toThrow(ConfigError);
  });

  it("fails loud on an empty image id", () => {
    expect(() => buildVariantUrl("HASH", "", IMAGE_VARIANTS.FULL)).toThrow(ConfigError);
  });

  it("variantUrl throws when the account hash is unresolved in env", async () => {
    // The test env has no CLOUDFLARE_IMAGES_ACCOUNT_HASH binding, so resolution
    // yields undefined and the builder must refuse rather than emit a bad URL.
    await expect(variantUrl(env, "img-1", IMAGE_VARIANTS.THUMB)).rejects.toBeInstanceOf(ConfigError);
  });

  it("exposes exactly the three named variants", () => {
    expect(Object.values(IMAGE_VARIANTS).sort()).toEqual(["full", "preview", "thumb"]);
  });
});
