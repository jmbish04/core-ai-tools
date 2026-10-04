/**
 * @fileoverview How the Worker classifies a request path, as pure predicates.
 *
 * These live outside `_worker.ts` for ONE reason: so they can be tested. The
 * entry module imports Astro's virtual manifest, which does not resolve outside
 * a build, so nothing in the vitest suite can import it — which meant the rule
 * deciding "is this a page the auth gate owns?" had no test at all, and the only
 * way to check it was to read the source and reason.
 *
 * That is exactly how `/health` ended up behind the login page: it is not
 * `/login`, not under `/api`, and has no file extension, so it fell through to
 * `isPageRequest` and an unauthenticated monitor got the sign-in HTML with a
 * 200. `test/health-endpoint.test.ts` now pins both predicates.
 *
 * Keep them PURE — path in, boolean out. No env, no bindings, no I/O.
 */

/**
 * True for paths the Hono API owns (REST + OpenAPI doc surfaces + `/health`).
 *
 * Checked BEFORE the page gate in `_worker.ts`, so anything listed here is
 * reachable without a session cookie and must enforce its own auth.
 */
export function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    // `/health` must reach Hono, not the page gate. Without this it falls
    // through to isPageRequest() and an unauthenticated monitor gets a 302 to
    // /login, then HTTP 200 and the sign-in HTML — UP, while reporting nothing.
    // Measured on the deployed Worker 2026-10-01.
    pathname === "/health" ||
    pathname === "/openapi.json" ||
    pathname === "/swagger" ||
    pathname === "/scalar" ||
    pathname === "/scaler"
  );
  // NOTE: `/docs` is intentionally NOT an API path — it is served as an Astro
  // SSR page (`src/frontend/pages/docs/index.astro`). The docs metadata API is
  // mounted at `/api/docs/*`, which is covered by the `/api/` prefix above.
}

/**
 * Internal path the Hono app actually serves a public path from.
 *
 * `/health` is the conventional endpoint every uptime monitor and runbook
 * reaches for, but the router is mounted once, at `/api/health`. Rewriting here
 * rather than mounting the router twice keeps `openapi.json` valid: a second
 * mount re-registers every operation under a new path with the SAME
 * `operationId` (measured: 6 paths, 3 duplicate ids), and `operationId` must be
 * unique. It would also have published `/health/run` and `/health/latest`,
 * which nothing asked for.
 *
 * Identity for everything else, so adding an entry here is the only way a
 * public path can differ from its served path.
 */
export function apiPathFor(pathname: string): string {
  return pathname === "/health" ? "/api/health" : pathname;
}

/**
 * True for an HTML page navigation that should be gated behind the session
 * cookie. Excludes `/login` (the gate's own escape hatch), the API +
 * agent/ws/mcp surfaces (they enforce their own auth), OAuth discovery, Astro
 * islands/assets (`/_*`), and any request for a file with an extension
 * (favicon, .css, .js…).
 *
 * Anything `isApiPath` claims is excluded here too, so the two cannot disagree
 * about a path — an earlier version listed the prefixes twice and `/health`
 * satisfied neither list's intent.
 */
export function isPageRequest(pathname: string): boolean {
  if (pathname === "/login") return false;
  if (isApiPath(pathname)) return false;
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/agents") ||
    pathname.startsWith("/ws") ||
    pathname.startsWith("/realtime") ||
    pathname === "/mcp" ||
    pathname.startsWith("/_") ||
    pathname.startsWith("/.well-known")
  ) {
    return false;
  }
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  return true;
}
