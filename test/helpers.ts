/**
 * Shared test helpers: a CoreContext over the test D1 and a quick way to seed a
 * library image (every session needs an origin image).
 */

import { env } from "cloudflare:test";

import { createCoreContext, registerImage } from "@/backend/core";
import type { CoreContext } from "@/backend/core";
import type { LibraryImage } from "@/backend/db/schema";

/** Build a fresh CoreContext over the test database. */
export function ctx(): CoreContext {
  return createCoreContext(env);
}

/** Register a throwaway library image and return the row. */
export async function seedImage(
  c: CoreContext,
  kind: "stock" | "staged" | "generated" = "stock",
): Promise<LibraryImage> {
  return registerImage(c, {
    cfImageId: `cf-${crypto.randomUUID()}`,
    deliveryUrl: "https://images.example/deliver",
    originalFilename: "room.jpg",
    contentType: "image/jpeg",
    width: 1024,
    height: 768,
    bytes: 123456,
    kind,
  });
}
