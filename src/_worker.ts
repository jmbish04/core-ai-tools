/**
 * @fileoverview Cloudflare Workers entry point for Astro SSR + Hono API +
 * Durable Objects (the `workerEntryPoint` for `@astrojs/cloudflare`).
 *
 * The adapter's generated `dist/_worker.js/index.js`:
 *   1. calls `start(manifest, args)` (if exported) to hand us the SSR manifest,
 *   2. calls `createExports()` to get the default fetch handler + DO classes,
 *   3. re-exports those DO classes alongside the default handler.
 *
 * Our handler routes:
 *   - `/agents/*`        → the Agents SDK router (`routeAgentRequest`)
 *   - `/api/*` + doc URLs → the Hono app
 *   - everything else    → Astro SSR via the adapter's `handle()` (which also
 *                          falls through to the `ASSETS` binding for static
 *                          files). This is the piece a naive `env.ASSETS.fetch`
 *                          custom entry forgets — without it, SSR pages 404.
 *
 * In addition to `fetch`, the handler exports `email(message, env, ctx)` —
 * Cloudflare Email Routing's inbound entry point. It parses + stores received
 * mail in D1 for the `/inbox` showcase (see `backend/email/inbound.ts`). The
 * handler is attached to BOTH the object returned by `createExports().default`
 * (what the Astro adapter re-exports) AND the standalone default export.
 */

import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import type { ExportedHandler } from "@cloudflare/workers-types";
import { routeAgentRequest } from "agents";

import { app as honoApp } from "./backend/api/index";
import { handleInboundEmail } from "./backend/email/inbound";
import { buildOAuthHandler } from "./backend/mcp/oauth";
import { verifySessionCookie } from "./backend/lib/cookies";
import { createCoreContext, reapStuckRevisions } from "./backend/core";
import { drainUsageOutbox } from "./backend/ai/dispatch";

/**
 * Cron maintenance: reap revisions stranded in queued/running past the timeout,
 * then deliver any buffered guardian usage. Runs on the `crons` trigger.
 */
async function runMaintenance(env: Env): Promise<void> {
  const core = createCoreContext(env);
  try {
    const reaped = await reapStuckRevisions(core);
    if (reaped.length) console.log(`[cron] reaped ${reaped.length} stuck revision(s): ${reaped.join(", ")}`);
  } catch (e) {
    console.error("[cron] reap failed:", e instanceof Error ? e.message : String(e));
  }
  try {
    const drained = await drainUsageOutbox(env, core.db);
    if (drained) console.log(`[cron] drained ${drained} usage record(s) to guardian`);
  } catch (e) {
    console.error("[cron] usage drain failed:", e instanceof Error ? e.message : String(e));
  }
}

// Import Durable Object classes. core-ai-tools keeps ChatBroker (assistant-ui
// chat), NotificationsAgent (realtime feed), and SessionDO (per-session fanout);
// the template's showcase agents were removed (wrangler v2 deleted_classes).
import { ChatBroker } from "./backend/ai/agents/ChatBroker";
import { NotificationsAgent } from "./backend/ai/agents/NotificationsAgent";
import { SessionDO } from "./backend/realtime/session-do";

// Re-export Durable Object classes (Pattern B: the @astrojs/cloudflare adapter
// re-exports these alongside the default handler so Cloudflare resolves every
// DO binding declared in wrangler.jsonc).
export { ChatBroker, NotificationsAgent, SessionDO };

/** True for paths the Hono API owns (REST + OpenAPI doc surfaces). */
/**
 * True for an HTML page navigation that should be gated behind the session
 * cookie. Excludes /login (the gate's own escape hatch), the API + agent/ws/mcp
 * surfaces (they enforce their own auth), OAuth discovery, Astro islands/assets
 * (`/_*`), and any request for a file with an extension (favicon, .css, .js…).
 */
function isPageRequest(pathname: string): boolean {
  if (pathname === "/login") return false;
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

/** True for paths the Hono API owns (REST + OpenAPI doc surfaces). */
function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/openapi.json" ||
    pathname === "/swagger" ||
    pathname === "/scalar" ||
    pathname === "/scaler"
  );
  // NOTE: `/docs` is intentionally NOT an API path — it is served as an Astro
  // SSR page (`src/frontend/pages/docs/index.astro`). The docs metadata API is
  // mounted at `/api/docs/*`, which is covered by the `/api/` prefix above.
}

// Astro SSR app + manifest, populated by `start()` before the first request.
let astroApp: App | undefined;
let astroManifest: any;

/**
 * Called by the adapter's generated entry with the SSR manifest. We build the
 * Astro `App` here so the fetch handler can render pages.
 */
export function start(manifest: any, _args: unknown) {
  astroManifest = manifest;
  astroApp = new App(manifest);
}

/**
 * Build the worker's default fetch handler + the DO class exports. Invoked by
 * the adapter's generated entry (after `start`).
 *
 * NOTE: `request as any` at the call sites bridges the lib.dom (Hono) vs
 * @cloudflare/workers-types (`agents` / ASSETS / Astro) `Request` type friction.
 */
export function createExports() {
  const handler = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);

      // 1. Agents SDK WebSocket/HTTP routing: /agents/:agent-name/:instance.
      if (url.pathname.startsWith("/agents/")) {
        const agentResponse = await routeAgentRequest(request as any, env);
        if (agentResponse) return agentResponse;
      }

      // NOTE: `/mcp` + the OAuth endpoints (/authorize, /token, /register,
      // /.well-known/*) are handled by the OAuthProvider that wraps THIS handler
      // (see the bottom of createExports). They never reach here.

      // 1b. SessionDO realtime WebSocket: /ws/session/:uuid. This is a genuine
      // raw-request proxy (forwarding the caller's WS upgrade), which is the
      // sanctioned use of stub.fetch — NOT method dispatch (that goes via RPC).
      // Accept both the original `/ws/session/:uuid` and the design build's
      // `/realtime/ws/sessions/:uuid`; both proxy the WS upgrade to the SessionDO.
      const wsPrefix = url.pathname.startsWith("/realtime/ws/sessions/")
        ? "/realtime/ws/sessions/"
        : url.pathname.startsWith("/ws/session/")
          ? "/ws/session/"
          : null;
      if (wsPrefix) {
        const uuid = url.pathname.slice(wsPrefix.length);
        if (uuid) {
          // Gate the realtime channel behind the session cookie. The browser WS
          // upgrade carries same-origin cookies; bearer isn't usable on a
          // WebSocket, so cookie-only here.
          if (!(await verifySessionCookie(env, request.headers.get("Cookie")))) {
            return new Response("Unauthorized", { status: 401 });
          }
          const stub = env.SESSION_DO.getByName(uuid);
          return stub.fetch(request as any);
        }
      }

      // 2. REST API + OpenAPI docs → Hono.
      if (isApiPath(url.pathname)) {
        return honoApp.fetch(request as any, env, ctx);
      }

      // 2b. Gate HTML page navigations behind the session cookie. /login is the
      // public escape hatch; the API enforces its own auth (cookie OR
      // WORKER_API_KEY bearer). Unauthenticated page loads redirect to /login.
      if (isPageRequest(url.pathname)) {
        const authed = await verifySessionCookie(env, request.headers.get("Cookie"));
        if (!authed) {
          const to = new URL("/login", url);
          if (url.pathname !== "/") to.searchParams.set("next", url.pathname);
          return new Response(null, { status: 302, headers: { Location: to.toString() } });
        }
      }

      // 3. Everything else → Astro SSR (with static-asset fallthrough).
      if (astroApp) {
        return handle(astroManifest, astroApp, request as any, env as any, ctx as any);
      }
      return env.ASSETS.fetch(request as any);
    },

    // Cloudflare Email Routing inbound handler. Invoked when a routing rule
    // targets this Worker (configured in the dashboard / via `wrangler email
    // routing`). Parses + stores the email in D1 for the `/inbox` showcase.
    async email(message: any, env: Env, ctx: ExecutionContext) {
      await handleInboundEmail(message, env, ctx);
    },

    // Cron trigger — stuck-revision reaper + usage-outbox drain (see wrangler crons).
    async scheduled(_event: unknown, env: Env, ctx: ExecutionContext) {
      ctx.waitUntil(runMaintenance(env));
    },
  } as unknown as ExportedHandler<Env>;

  // Wrap the base handler with the OAuth 2.1 provider: it owns `/mcp` (protected),
  // `/authorize`, `/token`, `/register`, and `/.well-known/*`, delegating
  // everything else back to `handler`. Email routing stays on the default export
  // (OAuthProvider only wraps `fetch`).
  const oauth = buildOAuthHandler(handler as unknown as import("@cloudflare/workers-types").ExportedHandler<Env>);
  const wrapped = {
    fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
      oauth.fetch(request as never, env as never, ctx as never),
    email: (handler as { email: (m: unknown, e: Env, c: ExecutionContext) => Promise<void> }).email,
    scheduled: (handler as { scheduled: (e: unknown, env: Env, c: ExecutionContext) => Promise<void> }).scheduled,
  } as unknown as ExportedHandler<Env>;

  return {
    default: wrapped,
    ChatBroker,
    NotificationsAgent,
    SessionDO,
  };
}

/**
 * Default export for standalone (non-Astro) usage. The Astro build uses
 * `createExports().default` instead; this exists only so the module is also a
 * valid Worker on its own (no SSR — API + assets only).
 */
const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/agents/")) {
      const agentResponse = await routeAgentRequest(request as any, env);
      if (agentResponse) return agentResponse;
    }
    if (isApiPath(url.pathname)) {
      return honoApp.fetch(request as any, env, ctx);
    }
    return env.ASSETS.fetch(request as any);
  },

  // Email Routing inbound handler (mirrors the one on `createExports().default`)
  // so this module is a valid standalone Worker target for a routing rule too.
  async email(message: any, env: Env, ctx: ExecutionContext) {
    await handleInboundEmail(message, env, ctx);
  },
} as unknown as ExportedHandler<Env>;

export default handler;
