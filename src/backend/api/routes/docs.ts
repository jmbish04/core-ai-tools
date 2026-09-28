/**
 * @fileoverview API routes that serve structured metadata to the `/docs`
 * frontend pages (schema + agents).
 *
 * Table and column descriptions are imported from the Drizzle schema modules
 * so that documentation stays co-located with the source of truth. Agent
 * metadata is sourced from each Durable Object's static `docsMetadata()` where
 * available, falling back to inline descriptors for the showcase agents.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { ChatBroker } from "../../ai/agents/ChatBroker";
import {
  BEST_PRACTICES_TABLE_DESCRIPTION,
  BEST_PRACTICES_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/best-practices";
import {
  DASHBOARD_METRICS_TABLE_DESCRIPTION,
  DASHBOARD_METRICS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/dashboard-metrics";
import {
  GLOBAL_CONFIG_TABLE_DESCRIPTION,
  GLOBAL_CONFIG_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/global-config";
import {
  HEALTH_CHECKS_TABLE_DESCRIPTION,
  HEALTH_CHECKS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/health-checks";
import {
  HITL_PROPOSALS_TABLE_DESCRIPTION,
  HITL_PROPOSALS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/hitl-proposals";
import {
  JOB_FAILURES_TABLE_DESCRIPTION,
  JOB_FAILURES_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/job-failures";
import {
  MCP_LOGS_TABLE_DESCRIPTION,
  MCP_LOGS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/mcp-logs";
// Domain schemas
import {
  PROJECTS_TABLE_DESCRIPTION,
  PROJECTS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/projects/projects";
import {
  TASKS_TABLE_DESCRIPTION,
  TASKS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/tasks/tasks";
import {
  TEAM_NOTES_TABLE_DESCRIPTION,
  TEAM_NOTES_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/tasks/team-notes";
import {
  ACTIVITY_LOG_TABLE_DESCRIPTION,
  ACTIVITY_LOG_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/stats/activity-log";
import {
  METRICS_DAILY_TABLE_DESCRIPTION,
  METRICS_DAILY_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/stats/metrics-daily";
import {
  PREFERENCES_TABLE_DESCRIPTION,
  PREFERENCES_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/settings/preferences";
import {
  WEBHOOKS_TABLE_DESCRIPTION,
  WEBHOOKS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/settings/webhooks";
import {
  NOTIFICATION_PREFS_TABLE_DESCRIPTION,
  NOTIFICATION_PREFS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/settings/notification-prefs";
import {
  NOTIFICATIONS_TABLE_DESCRIPTION,
  NOTIFICATIONS_COLUMN_DESCRIPTIONS,
} from "../../db/schemas/notifications/notifications";

// ---------------------------------------------------------------------------
// Registry — maps D1 table name → descriptions from schema modules
// ---------------------------------------------------------------------------

type TableDocEntry = {
  tableDescription: string;
  columnDescriptions: Record<string, string>;
};

/**
 * Central registry mapping each D1 table name to its documentation constants.
 * When adding a new table schema file, add its descriptions here as well.
 */
const TABLE_DOCS: Record<string, TableDocEntry> = {
  // Infrastructure
  global_config: {
    tableDescription: GLOBAL_CONFIG_TABLE_DESCRIPTION,
    columnDescriptions: GLOBAL_CONFIG_COLUMN_DESCRIPTIONS,
  },
  dashboard_metrics: {
    tableDescription: DASHBOARD_METRICS_TABLE_DESCRIPTION,
    columnDescriptions: DASHBOARD_METRICS_COLUMN_DESCRIPTIONS,
  },
  health_checks: {
    tableDescription: HEALTH_CHECKS_TABLE_DESCRIPTION,
    columnDescriptions: HEALTH_CHECKS_COLUMN_DESCRIPTIONS,
  },
  hitl_proposals: {
    tableDescription: HITL_PROPOSALS_TABLE_DESCRIPTION,
    columnDescriptions: HITL_PROPOSALS_COLUMN_DESCRIPTIONS,
  },
  mcp_logs: {
    tableDescription: MCP_LOGS_TABLE_DESCRIPTION,
    columnDescriptions: MCP_LOGS_COLUMN_DESCRIPTIONS,
  },
  job_failures: {
    tableDescription: JOB_FAILURES_TABLE_DESCRIPTION,
    columnDescriptions: JOB_FAILURES_COLUMN_DESCRIPTIONS,
  },
  best_practices: {
    tableDescription: BEST_PRACTICES_TABLE_DESCRIPTION,
    columnDescriptions: BEST_PRACTICES_COLUMN_DESCRIPTIONS,
  },
  // Domain — projects & tasks
  projects: {
    tableDescription: PROJECTS_TABLE_DESCRIPTION,
    columnDescriptions: PROJECTS_COLUMN_DESCRIPTIONS,
  },
  tasks: {
    tableDescription: TASKS_TABLE_DESCRIPTION,
    columnDescriptions: TASKS_COLUMN_DESCRIPTIONS,
  },
  team_notes: {
    tableDescription: TEAM_NOTES_TABLE_DESCRIPTION,
    columnDescriptions: TEAM_NOTES_COLUMN_DESCRIPTIONS,
  },
  // Domain — stats
  activity_log: {
    tableDescription: ACTIVITY_LOG_TABLE_DESCRIPTION,
    columnDescriptions: ACTIVITY_LOG_COLUMN_DESCRIPTIONS,
  },
  metrics_daily: {
    tableDescription: METRICS_DAILY_TABLE_DESCRIPTION,
    columnDescriptions: METRICS_DAILY_COLUMN_DESCRIPTIONS,
  },
  // Domain — settings
  preferences: {
    tableDescription: PREFERENCES_TABLE_DESCRIPTION,
    columnDescriptions: PREFERENCES_COLUMN_DESCRIPTIONS,
  },
  webhooks: {
    tableDescription: WEBHOOKS_TABLE_DESCRIPTION,
    columnDescriptions: WEBHOOKS_COLUMN_DESCRIPTIONS,
  },
  notification_prefs: {
    tableDescription: NOTIFICATION_PREFS_TABLE_DESCRIPTION,
    columnDescriptions: NOTIFICATION_PREFS_COLUMN_DESCRIPTIONS,
  },
  // Domain — notifications
  notifications: {
    tableDescription: NOTIFICATIONS_TABLE_DESCRIPTION,
    columnDescriptions: NOTIFICATIONS_COLUMN_DESCRIPTIONS,
  },
};

const TABLE_NAMES = Object.keys(TABLE_DOCS);

// ---------------------------------------------------------------------------
// Agent metadata — the Agents SDK showcase agents
// ---------------------------------------------------------------------------

/**
 * The Durable Objects this Worker actually runs, for the ones that do not expose
 * a static `docsMetadata()`.
 *
 * This list used to name `CodeModeAgent`, `BrowserHitlAgent`, `WorkflowsAgent`
 * and `ArtifactAgent` — four of the ten template showcase agents deleted in the
 * v2 DO migration. `/docs` therefore advertised a catalog of agents that no
 * longer exist and could not be reached. Anything added here MUST be a class in
 * `_worker.ts`'s exports and a binding in `wrangler.jsonc`, or this page is
 * lying again.
 */
const LIVE_AGENTS = [
  {
    name: "NotificationsAgent",
    className: "NotificationsAgent",
    description:
      "Holds notification state for the whole workspace and syncs it to every open tab over a WebSocket. Bound as NOTIFICATIONS_AGENT, one instance named \"global\".",
    docsPath: "/docs",
    methods: [] as Array<{ name: string; description: string }>,
    tools: [] as string[],
  },
  {
    name: "SessionDO",
    className: "SessionDO",
    description:
      "One instance per editing session. Sole allocator of the monotonic event `seq`, which is what makes the realtime replay buffer gap-free, and the socket /ws/session/:uuid connects to.",
    docsPath: "/docs",
    methods: [],
    tools: [],
  },
  {
    name: "FolderDO",
    className: "FolderDO",
    description:
      "One instance per folder. Broadcasts tree and metadata changes over /ws/folder/:id, so an agent editing a folder is visible in an open tab without a refresh.",
    docsPath: "/docs",
    methods: [],
    tools: [],
  },
];

// ---------------------------------------------------------------------------
// Zod schemas for responses
// ---------------------------------------------------------------------------

const columnSchema = z.object({
  cid: z.number(),
  name: z.string(),
  type: z.string(),
  notnull: z.number(),
  dflt_value: z.unknown().nullable(),
  pk: z.number(),
  description: z.string(),
});

const foreignKeySchema = z.object({
  id: z.number(),
  seq: z.number(),
  table: z.string(),
  from: z.string(),
  to: z.string(),
  on_update: z.string(),
  on_delete: z.string(),
});

const tableInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  columns: z.array(columnSchema),
  foreignKeys: z.array(foreignKeySchema),
});

const schemaResponseSchema = z.object({
  tables: z.array(tableInfoSchema),
});

const agentMetadataSchema = z.object({
  name: z.string(),
  className: z.string(),
  description: z.string(),
  docsPath: z.string(),
  methods: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      params: z.string().optional(),
      returns: z.string().optional(),
    }),
  ),
  tools: z.array(z.string()),
});

const agentsResponseSchema = z.object({
  agents: z.array(agentMetadataSchema),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const docsRouter = new OpenAPIHono<{ Bindings: Env }>();

// GET /api/docs/schema
docsRouter.openapi(
  createRoute({
    method: "get",
    path: "/schema",
    operationId: "docsSchema",
    responses: {
      200: {
        description:
          "Live D1 table schema via PRAGMA queries, enriched with descriptions from schema modules",
        content: { "application/json": { schema: schemaResponseSchema } },
      },
    },
  }),
  (async (c: any) => {
    const d1 = c.env.DB;
    const tables = [];

    for (const tableName of TABLE_NAMES) {
      const docs = TABLE_DOCS[tableName]!;

      const [columnsResult, fkResult] = await Promise.all([
        d1.prepare(`PRAGMA table_info("${tableName}")`).all(),
        d1.prepare(`PRAGMA foreign_key_list("${tableName}")`).all(),
      ]);

      // Enrich each PRAGMA column with its human-readable description
      const columns = (
        columnsResult.results as unknown as {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: unknown;
          pk: number;
        }[]
      ).map((col) => ({
        ...col,
        description: docs.columnDescriptions[col.name] ?? "",
      }));

      tables.push({
        name: tableName,
        description: docs.tableDescription,
        columns,
        foreignKeys: fkResult.results as unknown as z.infer<typeof foreignKeySchema>[],
      });
    }

    return c.json({ tables });
  }) as any,
);

// GET /api/docs/agents
docsRouter.openapi(
  createRoute({
    method: "get",
    path: "/agents",
    operationId: "docsAgents",
    responses: {
      200: {
        description: "Agent metadata for documentation",
        content: { "application/json": { schema: agentsResponseSchema } },
      },
    },
  }),
  (async (c: any) => {
    const agents = [
      { ...ChatBroker.docsMetadata(), tools: [] as string[] },
      ...LIVE_AGENTS,
    ];

    return c.json({ agents });
  }) as any,
);
