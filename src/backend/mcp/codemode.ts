/**
 * @fileoverview Code mode for the `/mcp` server — the sandboxed `execute` half.
 *
 * WHY: every tool definition is re-sent on every request of every session, whether
 * or not it is ever called. Advertising all 30 named tools cost ~3,692 tokens per
 * session (measured 2026-09-26). Code mode advertises three tools instead and lets
 * the model fetch detail on demand, so the surface stops scaling with tool count.
 * See `~/AGENTS-mcp.md` ("Build new MCP servers in code mode").
 *
 * HOW the script reaches the tools: the snippet runs in a real V8 isolate via the
 * `WORKER_LOADERS` binding — it gets NO bindings of this Worker. Its only channel
 * is a `PARENT` service binding (this Worker, bound to itself as `SELF`) pointing
 * at `POST /internal/mcp-tool`, which dispatches one tool call. `globalOutbound` is
 * null, so the snippet cannot reach the public internet at all.
 *
 * AUTH for that channel: a single-use nonce, minted per execution into `OAUTH_KV`
 * with a short TTL and handed to the isolate in its env. The real `WORKER_API_KEY`
 * is NEVER passed into the sandbox. The nonce only authorises tool dispatch, and it
 * is already gated by the OAuth/bearer check on the `execute` call that minted it.
 */

import { stripTypeScript } from "@/backend/ai/agents/CodeModeAgent/sandbox";

/** KV key prefix for live sandbox nonces. */
const NONCE_PREFIX = "sandbox-nonce:";
/** Nonce lifetime. Long enough for a chain of image edits, short enough to be cheap. */
const NONCE_TTL_S = 600;
/** Isolate CPU ceiling (wall-clock provider waits are I/O, not CPU). */
const CPU_MS = 30_000;
/** Compatibility date for the sandbox isolate. */
const SANDBOX_COMPAT_DATE = "2026-05-25";

/** The calling convention, kept in one place (docs + `execute` description). */
export const EXECUTE_CONVENTION =
  'Write the BODY of an async function. `await call_tool(name, args)` runs any tool from ' +
  '`search` and returns its parsed JSON result (it throws on tool error). `return` a value ' +
  'and it comes back JSON-encoded. No other globals, no network access. Example: ' +
  '`const lib = await call_tool("list_library", { limit: 3 }); ' +
  'const s = await call_tool("create_session", { originLibraryImageId: lib.images[0].id, title: "demo" }); ' +
  'return s;`';

/** Mint a single-use nonce authorising `/internal/mcp-tool` for one execution. */
async function mintNonce(env: Env): Promise<string> {
  const nonce = crypto.randomUUID();
  await env.OAUTH_KV.put(`${NONCE_PREFIX}${nonce}`, "1", { expirationTtl: NONCE_TTL_S });
  return nonce;
}

/**
 * Validate a nonce presented by a sandboxed script.
 *
 * @returns true when the nonce is live. Kept valid for the whole execution (a
 *   script legitimately makes several tool calls); it expires by TTL.
 */
export async function isValidSandboxNonce(env: Env, nonce: string | null): Promise<boolean> {
  if (!nonce) return false;
  return (await env.OAUTH_KV.get(`${NONCE_PREFIX}${nonce}`)) !== null;
}

/** Revoke a nonce once its execution finished — no reuse after the call returns. */
async function revokeNonce(env: Env, nonce: string): Promise<void> {
  await env.OAUTH_KV.delete(`${NONCE_PREFIX}${nonce}`).catch(() => undefined);
}

/** Build the loadable module: the `call_tool` prelude wrapped around the snippet. */
function buildModule(snippet: string): string {
  return `export default {
  async fetch(request, env) {
    const call_tool = async (name, args = {}) => {
      const res = await env.PARENT.fetch("https://mcp-sandbox.internal/internal/mcp-tool", {
        method: "POST",
        headers: { "content-type": "application/json", "x-sandbox-nonce": env.NONCE },
        body: JSON.stringify({ name, args }),
      });
      const json = await res.json().catch(() => ({ error: "non-JSON response from tool dispatch" }));
      if (!res.ok || json.error) {
        throw new Error("call_tool(" + name + ") failed: " + (json.error ?? res.status));
      }
      return json.result;
    };
    try {
      const __run = async () => {
${stripTypeScript(snippet)
  .split("\n")
  .map((l) => (l.trim() ? `        ${l}` : l))
  .join("\n")}
      };
      const value = await __run();
      return Response.json({ ok: true, value: value ?? null });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};`;
}

export interface ScriptResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Run a model-authored snippet in an isolated dynamic Worker with `call_tool`
 * available.
 *
 * @param env  Worker env (needs `WORKER_LOADERS`, `SELF`, `OAUTH_KV`).
 * @param code The snippet — an async function body (see `EXECUTE_CONVENTION`).
 * @returns `{ ok: true, value }` on success, `{ ok: false, error }` when the
 *   snippet or one of its tool calls threw.
 * @throws Error when the sandbox itself is unavailable (missing binding).
 * @example await runScript(env, 'return await call_tool("list_available_models", {});')
 */
export async function runScript(env: Env, code: string): Promise<ScriptResult> {
  if (!env.WORKER_LOADERS) throw new Error("Code mode unavailable: WORKER_LOADERS is not bound.");
  if (!env.SELF) throw new Error("Code mode unavailable: SELF service binding is not bound.");

  const nonce = await mintNonce(env);
  try {
    const module = buildModule(code);
    // Isolate id includes the nonce so two concurrent executions never share an
    // isolate (and therefore never share a nonce).
    const stub = env.WORKER_LOADERS.get(`mcp-code-${nonce}`, async () => ({
      compatibilityDate: SANDBOX_COMPAT_DATE,
      compatibilityFlags: ["nodejs_compat"],
      mainModule: "main.js",
      modules: { "main.js": module },
      env: { PARENT: env.SELF, NONCE: nonce },
      // No ambient network: the PARENT binding is the only way out.
      globalOutbound: null,
      limits: { cpuMs: CPU_MS },
    }));
    const res = await stub.getEntrypoint().fetch("https://mcp-sandbox.internal/");
    const json = (await res.json().catch(() => null)) as ScriptResult | null;
    if (!json) return { ok: false, error: `Sandbox returned a non-JSON response (HTTP ${res.status}).` };
    return json;
  } finally {
    await revokeNonce(env, nonce);
  }
}
