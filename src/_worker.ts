/**
 * @fileoverview Cloudflare Workers entry point for Astro SSR + Hono API +
 * Durable Objects — the Worker `main` (wrangler.jsonc → `main: src/_worker.ts`).
 *
 * @astrojs/cloudflare v14 dropped the v5-era `workerEntryPoint` +
 * `start(manifest)`/`createExports()` injection. So this is now a plain Worker
 * module that wrangler bundles directly: it exports a default handler and the DO
 * classes, and delegates SSR to the adapter's `handle(request, env, ctx)`
 * (imported from `@astrojs/cloudflare/handler`), which lazily builds the Astro
 * app from the build manifest emitted by `astro build` and also falls through to
 * the `ASSETS` binding for static files. `astro build` emits the SSR output;
 * `wrangler deploy` bundles THIS file as the entry.
 *
 * Routing: `/agents/*` → Agents SDK router; `/ws|/realtime` → SessionDO /
 * FolderDO WS proxies (cookie-gated); `/api/*` + doc URLs → Hono; page navigations → session-cookie
 * gate; everything else → Astro SSR. `/mcp` + OAuth endpoints are owned by the
 * OAuthProvider that wraps this handler's `fetch`. `email(message, env, ctx)` is
 * Cloudflare Email Routing's inbound entry (stores mail in D1 for `/inbox`).
 */

import { handle } from "@astrojs/cloudflare/handler";
import type { ExportedHandler } from "@cloudflare/workers-types";
import { routeAgentRequest } from "agents";

import { app as honoApp } from "./backend/api/index";
import { handleInboundEmail } from "./backend/email/inbound";
import { buildOAuthHandler } from "./backend/mcp/oauth";
import { handleInternalToolCall } from "./backend/mcp/server";
import { verifySessionCookie } from "./backend/lib/cookies";
// Pure path predicates, extracted so the vitest suite can import them — this
// module cannot be imported in tests (Astro virtual manifest), which is why
// the /health gate bug had no test. See routing/path-gates.ts.
import { apiPathFor, isApiPath, isPageRequest } from "./backend/routing/path-gates";
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
import { FolderDO } from "./backend/realtime/folder-do";

// Re-export Durable Object classes so Cloudflare resolves every DO binding
// declared in wrangler.jsonc. wrangler bundles this module as the Worker entry,
// so these named exports ARE the deployed Worker's DO exports.
export { ChatBroker, NotificationsAgent, SessionDO, FolderDO };


/**
 * The base Worker handler. `request as any` at the call sites bridges the
 * lib.dom (Hono) vs @cloudflare/workers-types (`agents` / ASSETS / Astro)
 * `Request` type friction.
 */
const base = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // 1. Agents SDK WebSocket/HTTP routing: /agents/:agent-name/:instance.
    if (url.pathname.startsWith("/agents/")) {
      const agentResponse = await routeAgentRequest(request as any, env);
      if (agentResponse) return agentResponse;
    }

    // NOTE: `/mcp` + the OAuth endpoints (/authorize, /token, /register,
    // /.well-known/*) are handled by the OAuthProvider that wraps THIS handler.
    // They never reach here.

    // 1a. Code-mode sandbox channel. Reached ONLY over this Worker's own SELF
    // service binding from a dynamically-loaded isolate, and authorised by the
    // per-execution nonce the `execute` tool minted (never the API key). Declared
    // before the API/page gates because it is neither.
    if (url.pathname === "/internal/mcp-tool") {
      return handleInternalToolCall(request, env);
    }

    // 1b. SessionDO realtime WebSocket: /ws/session/:uuid. A genuine raw-request
    // proxy (forwarding the caller's WS upgrade) — the sanctioned use of
    // stub.fetch. Accept both `/ws/session/:uuid` and the design build's
    // `/realtime/ws/sessions/:uuid`.
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

    // 1c. FolderDO realtime WebSocket: /ws/folder/:folderId. Same shape as the
    // session channel above — a genuine raw-request proxy of the caller's WS
    // upgrade (the sanctioned stub.fetch), cookie-gated because a browser
    // WebSocket cannot carry a bearer.
    if (url.pathname.startsWith("/ws/folder/")) {
      const folderId = url.pathname.slice("/ws/folder/".length);
      if (folderId) {
        if (!(await verifySessionCookie(env, request.headers.get("Cookie")))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const stub = env.FOLDER_DO.getByName(folderId);
        return stub.fetch(request as any);
      }
    }

    // 2. REST API + OpenAPI docs → Hono. `apiPathFor` maps a public path to the
    // path Hono mounts it at; today that is only `/health` → `/api/health`, so
    // the health router is registered once and openapi.json stays valid.
    if (isApiPath(url.pathname)) {
      const served = apiPathFor(url.pathname);
      if (served !== url.pathname) {
        const rewritten = new URL(url);
        rewritten.pathname = served;
        return honoApp.fetch(new Request(rewritten, request) as any, env, ctx);
      }
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

    // 3. Everything else → Astro SSR. The v14 adapter handler lazily builds the
    // Astro app from the emitted manifest and falls through to ASSETS for static
    // files — without it, SSR pages 404.
    return handle(request as any, env as any, ctx as any);
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
// everything else back to `base`. Email + scheduled stay on the default export
// (OAuthProvider only wraps `fetch`).
const oauth = buildOAuthHandler(base as unknown as import("@cloudflare/workers-types").ExportedHandler<Env>);
const handler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    oauth.fetch(request as never, env as never, ctx as never),
  email: (base as { email: (m: unknown, e: Env, c: ExecutionContext) => Promise<void> }).email,
  scheduled: (base as { scheduled: (e: unknown, env: Env, c: ExecutionContext) => Promise<void> }).scheduled,
} as unknown as ExportedHandler<Env>;

export default handler;
