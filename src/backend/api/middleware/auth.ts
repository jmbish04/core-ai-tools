/**
 * @fileoverview Auth middleware — accepts EITHER of two credentials:
 *
 *   1. `Authorization: Bearer <WORKER_API_KEY>` — for programmatic callers
 *      (scripts, MCP tooling, curl). The same single-owner key used elsewhere.
 *   2. A valid signed session cookie — for the browser (issued by
 *      `/api/auth/login`, validated HMAC + expiry, no DB lookup).
 *
 * On success sets `authed = true`; otherwise 401. Single-user template auth.
 */

import type { Context, Next } from "hono";

import type { Variables } from "@/backend/api/index";
import { verifySessionCookie } from "@/backend/lib/cookies";
import { getWorkerApiKey } from "@/backend/utils/secrets";

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
) {
  // 1. WORKER_API_KEY bearer (programmatic access).
  const authz = c.req.header("Authorization");
  if (authz?.startsWith("Bearer ")) {
    const token = authz.slice(7).trim();
    const key = (await getWorkerApiKey(c.env))?.trim();
    if (key && token === key) {
      c.set("authed", true);
      return next();
    }
  }

  // 2. Signed session cookie (browser).
  if (await verifySessionCookie(c.env, c.req.header("Cookie"))) {
    c.set("authed", true);
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
}
