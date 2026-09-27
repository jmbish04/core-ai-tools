/**
 * @fileoverview `core/assets` barrel — the curated asset library and asset→image
 * lineage. Bytes still live in Cloudflare Images via `library_images`; this domain
 * adds "images the user returns to" and "everything this asset ever produced".
 */

export * from "./assets";
export * from "./lineage";
export * from "./place";
