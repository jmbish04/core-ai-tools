/**
 * @fileoverview Durable MCP interaction log. Every tool call writes its request
 * row BEFORE the handler runs (`startMcpLog`), so the prompt/payload is persisted
 * even if the handler crashes or times out mid-edit; `finishMcpLog` then records
 * the result. `listMcpLogs` reads the history back — for the `get_interaction_log`
 * tool, the `/api/logs` route, and failure forensics.
 *
 * ponytail: two writes per call (insert then update) buys crash-durability of the
 * prompt. If that ever costs too much, drop to a single write in a finally block —
 * you then lose only the isolate-hard-crash case.
 */

import { desc, eq } from "drizzle-orm";

import { mcpLogs } from "@/backend/db/schema";
import type { McpLogRow } from "@/backend/db/schema";
import type { CoreContext } from "../context";

const SERVER_NAME = "core-ai-tools-mcp";

/** Best-effort: pull a session uuid out of tool args (for linkage). */
function sniffSessionUuid(args: unknown): string | null {
  if (args && typeof args === "object") {
    const v = (args as Record<string, unknown>).sessionUuid;
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Best-effort: pull a revision id out of a tool result (for linkage). */
export function sniffRevisionId(out: unknown): string | null {
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    for (const k of ["revisionId", "revision_id", "id"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
  }
  return null;
}

export interface StartedLog {
  id: string;
  startedAt: number;
}

/** Persist the request row up front. Returns the handle used to finish it. */
export async function startMcpLog(
  ctx: CoreContext,
  input: { toolName: string; request: unknown; sessionUuid?: string | null },
): Promise<StartedLog> {
  const id = crypto.randomUUID();
  await ctx.db.insert(mcpLogs).values({
    id,
    serverName: SERVER_NAME,
    toolName: input.toolName,
    request: input.request ?? null,
    success: null,
    sessionUuid: input.sessionUuid ?? sniffSessionUuid(input.request),
  });
  return { id, startedAt: Date.now() };
}

/** Record the outcome on the row started by `startMcpLog`. */
export async function finishMcpLog(
  ctx: CoreContext,
  input: {
    log: StartedLog;
    success: boolean;
    response?: unknown;
    errorMessage?: string | null;
    revisionId?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    success: input.success,
    latencyMs: Math.max(0, Date.now() - input.log.startedAt),
  };
  if (input.response !== undefined) patch.response = input.response;
  if (input.errorMessage !== undefined) patch.errorMessage = input.errorMessage;
  if (input.revisionId) patch.revisionId = input.revisionId;
  await ctx.db.update(mcpLogs).set(patch).where(eq(mcpLogs.id, input.log.id));
}

/** Read recent interactions, newest first; scope to a session when given. */
export async function listMcpLogs(
  ctx: CoreContext,
  input?: { sessionUuid?: string; limit?: number },
): Promise<McpLogRow[]> {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  if (input?.sessionUuid) {
    return ctx.db
      .select()
      .from(mcpLogs)
      .where(eq(mcpLogs.sessionUuid, input.sessionUuid))
      .orderBy(desc(mcpLogs.createdAt))
      .limit(limit);
  }
  return ctx.db.select().from(mcpLogs).orderBy(desc(mcpLogs.createdAt)).limit(limit);
}
