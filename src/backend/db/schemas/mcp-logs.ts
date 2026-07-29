import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// ---------------------------------------------------------------------------
// Table & column documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

export const MCP_LOGS_TABLE_DESCRIPTION =
  "Durable request/response log for every MCP tool invocation. The request row is written BEFORE the handler runs, so the prompt/payload survives even if the handler crashes or times out mid-edit; it is then updated with the result. Linked to the revision tree by session_uuid/revision_id so models can review what was tried and reason about why edits failed.";

export const MCP_LOGS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "Unique log entry identifier (UUID v4).",
  server_name: "Surface identifier (e.g. core-ai-tools-mcp).",
  tool_name: "Name of the invoked tool / method.",
  request: "Full JSON arguments sent to the tool (the prompt/payload — never dropped).",
  response: "Full JSON result returned by the tool. Null until the handler completes.",
  success: "1 if the call resolved without error, 0 if it failed/timed out, null while pending.",
  error_message: "Captured error string when success = 0.",
  latency_ms: "End-to-end wall-clock latency in milliseconds.",
  session_uuid: "Session the call belongs to, when derivable from the args or result (nullable).",
  revision_id: "Revision the call produced or acted on, when known (nullable).",
  created_at: "Unix timestamp (seconds) when the request row was written.",
};

// ---------------------------------------------------------------------------
// Table definition
// ---------------------------------------------------------------------------

export const mcpLogs = sqliteTable(
  "mcp_logs",
  {
    id: text("id").primaryKey(),
    serverName: text("server_name").notNull(),
    toolName: text("tool_name").notNull(),
    request: text("request", { mode: "json" }).$type<unknown>(),
    response: text("response", { mode: "json" }).$type<unknown>(),
    // Nullable tri-state: null = pending (request logged, handler still running),
    // true = ok, false = failed. Not defaulted so a pending row is distinguishable.
    success: integer("success", { mode: "boolean" }),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms").notNull().default(0),
    sessionUuid: text("session_uuid"),
    revisionId: text("revision_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    bySession: index("mcp_logs_session_created_idx").on(t.sessionUuid, t.createdAt),
    byCreated: index("mcp_logs_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Zod schemas & types
// ---------------------------------------------------------------------------

export const insertMcpLogSchema = createInsertSchema(mcpLogs);
export const selectMcpLogSchema = createSelectSchema(mcpLogs);
export type McpLogRow = typeof mcpLogs.$inferSelect;
export type NewMcpLogRow = typeof mcpLogs.$inferInsert;
