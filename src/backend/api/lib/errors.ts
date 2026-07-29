/**
 * @fileoverview Maps core `CoreError`s to HTTP responses for the Hono surface.
 * The core throws typed errors carrying a `status` + `code`; routes funnel every
 * catch through here so the mapping lives in one place.
 */

import type { Context } from "hono";

interface CoreLike {
  status?: number;
  code?: string;
  message?: string;
}

/** Serialize any thrown value to a JSON error with the right status. */
export function toHttpError(c: Context, err: unknown): Response {
  const e = err as CoreLike;
  const status = typeof e?.status === "number" ? e.status : 500;
  return c.json(
    { error: e?.message ?? "Internal error", code: e?.code ?? "internal" },
    // Hono wants a ContentfulStatusCode; core statuses are all valid HTTP codes.
    status as 400,
  );
}
