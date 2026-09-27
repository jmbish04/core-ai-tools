/**
 * @fileoverview OAuth 2.1 for the `/mcp` server via `@cloudflare/workers-oauth-
 * provider`. This is what Claude.ai needs (it does DCR + PKCE + the browser
 * authorize flow — bearer alone can't connect there). The provider handles
 * discovery (`/.well-known/*`), client registration (`/register`), and `/token`;
 * we supply the `/authorize` consent screen and the protected `/mcp` handler.
 *
 * SINGLE-OWNER GATE: there's no user directory here, so `/authorize` requires the
 * worker key (WORKER_API_KEY) — only someone who knows it can approve a client.
 *
 * DUAL AUTH: `resolveExternalToken` lets a raw `Bearer <WORKER_API_KEY>` through
 * for our own scripts/testing, alongside OAuth-issued tokens. Everything else is
 * 401'd by the provider before reaching the MCP handler.
 */

import OAuthProvider, { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import type { AuthRequest, OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import type { ExportedHandler } from "@cloudflare/workers-types";

import { getWorkerApiKey } from "@/backend/utils/secrets";
import { handleMcp } from "./server";

const SCOPES = ["mcp"];

/** Module-ref to the options so the /authorize handler can build OAuthHelpers. */
let oauthOptions: OAuthProviderOptions<Env>;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The consent page — a single password field (the worker key). */
function consentPage(search: string, error: string | null): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize · core-ai-tools MCP</title>
<style>body{background:#09090b;color:#e4e4e7;font:15px/1.5 ui-sans-serif,system-ui;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#131316;border:1px solid #27272a;border-radius:12px;padding:28px;max-width:360px;width:90%}
h1{font-size:18px;margin:0 0 8px}p{color:#a1a1aa;font-size:13px}
input{width:100%;box-sizing:border-box;background:#09090b;border:1px solid #27272a;border-radius:8px;color:#e4e4e7;padding:10px;margin:12px 0;font-size:14px}
button{width:100%;background:#e4e4e7;color:#09090b;border:0;border-radius:8px;padding:10px;font-weight:600;cursor:pointer}
.err{color:#f87171;font-size:13px}</style></head>
<body><form method="POST" action="/authorize${esc(search)}">
<h1>Authorize MCP access</h1>
<p>A client wants to connect to <strong>core-ai-tools</strong>. Enter the worker key to approve.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<input type="password" name="password" placeholder="Worker key" autofocus autocomplete="off"/>
<button type="submit">Authorize</button></form></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const api = getOAuthApi(oauthOptions, env);
  let authReq: AuthRequest;
  try {
    authReq = await api.parseAuthRequest(request);
  } catch {
    return new Response("Invalid authorization request.", { status: 400 });
  }
  const search = new URL(request.url).search;

  if (request.method === "GET") return consentPage(search, null);

  const form = await request.formData();
  // Trim both sides — a Secrets Store value can carry a trailing newline, which
  // would fail an exact compare against the pasted key.
  const key = String(form.get("password") ?? "").trim();
  const expected = (await getWorkerApiKey(env))?.trim();
  const matched = Boolean(expected) && key === expected;
  console.log(`[oauth] /authorize POST: key match=${matched} client=${authReq.clientId ?? "?"}`);
  if (!matched) {
    return consentPage(search, "Incorrect key.");
  }

  try {
    const { redirectTo } = await api.completeAuthorization({
      request: authReq,
      userId: "owner",
      metadata: {},
      scope: authReq.scope?.length ? authReq.scope : SCOPES,
      props: { userId: "owner" },
    });
    console.log(`[oauth] completeAuthorization -> redirect ok`);
    return new Response(null, { status: 302, headers: { Location: redirectTo } });
  } catch (err) {
    console.error(`[oauth] completeAuthorization failed:`, err instanceof Error ? err.stack : String(err));
    return consentPage(search, "Authorization failed on the server — check the worker logs.");
  }
}

/** Wrap the base Worker handler (Astro SSR + Hono API + email) with OAuth. */
/** One year in seconds — the grant lifetime for this single-owner MCP server. */
const ONE_YEAR_S = 60 * 60 * 24 * 365;

export function buildOAuthHandler(base: ExportedHandler<Env>): OAuthProvider<Env> {
  const defaultHandler = {
    // Params typed loosely to bridge lib.dom (Request) vs @cloudflare/workers-types.
    async fetch(request: any, env: Env, ctx: any): Promise<any> {
      if (new URL(request.url).pathname === "/authorize") {
        return handleAuthorize(request as Request, env);
      }
      return base.fetch!(request, env, ctx);
    },
  } as unknown as ExportedHandler<Env>;

  oauthOptions = {
    // PREFIX MATCH, not exact: every path starting with "/mcp" is routed into the
    // MCP handler. A page at /mcp-setup was therefore unreachable — it answered
    // "MCP endpoint — POST JSON-RPC" to a browser. The setup page now lives at
    // /connect, and nothing else may be added under /mcp that is not the protocol.
    apiRoute: "/mcp",
    apiHandler: { fetch: (request: Request, env: Env) => handleMcp(request, env) } as never,
    defaultHandler: defaultHandler as never,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: SCOPES,
    // Access-token lifetime: 1 year (default is 1 hour). Single-owner MCP server,
    // so a long-lived token avoids re-authorizing the Claude.ai connector daily.
    accessTokenTTL: ONE_YEAR_S,
    // A 1-year access token is capped by whichever of these expires FIRST, and both
    // default short: refresh tokens 30 days, and a DCR-registered client 90 days.
    // Claude registers through DCR, so leaving clientRegistrationTTL at its default
    // silently kills the connector at 90 days with a working access-token config.
    refreshTokenTTL: ONE_YEAR_S,
    clientRegistrationTTL: ONE_YEAR_S,
    // RFC 9728: the protected-resource `resource` MUST equal the MCP server URL
    // Claude connects to (`…/mcp`) — not the origin, or Claude rejects the
    // resource match. Pinned to the deployed host.
    resourceMetadata: {
      resource: "https://core-ai-tools.hacolby.workers.dev/mcp",
      scopes_supported: SCOPES,
    },
    resolveExternalToken: async (input: { token: string; env: Env }) => {
      const expected = (await getWorkerApiKey(input.env))?.trim();
      if (expected && input.token.trim() === expected) {
        return { props: { userId: "worker-key" } };
      }
      return null;
    },
    // Log every OAuth-level error (token exchange, registration, etc.) so a
    // "returned an error when connecting" in Claude maps to a real cause here.
    onError: (error: { code?: string; description?: string; status?: number; internal?: unknown }) => {
      console.error(
        `[oauth] provider error status=${error.status} code=${error.code}: ${error.description}`,
        error.internal ? JSON.stringify(error.internal).slice(0, 500) : "",
      );
    },
  } as OAuthProviderOptions<Env>;
  return new OAuthProvider<Env>(oauthOptions);
}
