/**
 * @fileoverview Health check API routes. Mounted at BOTH `/api/health` and the
 * conventional root `/health` (see `api/index.ts` + `_worker.ts#isApiPath`).
 *
 *  - `GET  /api/health`        — LIVE probe. Runs cheap checks now, returns a
 *                                verdict, and answers **503 when unhealthy**.
 *  - `GET  /api/health/latest` — the last PERSISTED deep run (no checks run).
 *  - `POST /api/health/run`    — full diagnostic, persisted to D1.
 *
 * ## Why `GET /` runs checks instead of reading the last run
 *
 * It used to return `getLatestRun()` — the last persisted run, without running
 * anything. No run had ever been persisted, so the deployed Worker answered
 * `{"run":null,"results":[]}` with a **200** forever. Any uptime monitor read
 * that as healthy while zero checks had executed: an instrument structurally
 * incapable of reporting a problem, which is worse than having no endpoint
 * because it produces a record that looks like diligence.
 *
 * Three rules this endpoint now keeps, and a test plants a regression for each:
 *
 * 1. **It reads what it depends on.** A binding being present and a table being
 *    readable are different facts, so the D1 check SELECTs from a real
 *    application table rather than `SELECT 1`.
 * 2. **Expectations are DECLARED, so missing is an error and never an
 *    inference.** `REQUIRED_BINDINGS` lists what must exist; an absent binding
 *    fails the verdict instead of being silently skipped.
 * 3. **A failure changes the verdict AND the status code.** `unhealthy` → 503.
 *    A checker that only reads the status line still sees red.
 *
 * It deliberately does NOT run the deep diagnostic or write to D1: this route is
 * public and unauthenticated, so persisting a row per request would hand anyone
 * an unauthenticated write amplifier. The deep path stays `POST /api/health/run`,
 * and its last result rides along here as `lastDeepRun` context — never as the
 * answer.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { desc, eq } from "drizzle-orm";

import { healthRuns, healthResults, modelCatalog } from "@db/schemas";
import { getDb } from "@/db";

// ---------------------------------------------------------------------------
// HealthCoordinator
// ---------------------------------------------------------------------------

type DOBindingDescriptor = {
  /** Hono binding key on `Env`. */
  binding: keyof Env;
  /** Friendly check name persisted to `health_results.name`. */
  name: string;
};

/**
 * Canonical list of Durable Object agent bindings the coordinator pings.
 *
 * Each entry is opened via `env[binding].idFromName("health-probe")`, a stub
 * is fetched, and a no-op HTTP request to `/__ping` is sent. Failures and
 * timeouts are caught and recorded — they do not abort the run.
 */
const AGENT_BINDINGS: DOBindingDescriptor[] = [
  { binding: "CHAT_BROKER" as keyof Env, name: "chat_broker_ping" },
  { binding: "NOTIFICATIONS_AGENT" as keyof Env, name: "notifications_agent_ping" },
];

const PING_TIMEOUT_MS = 2000;

/**
 * Bindings this Worker cannot serve a request without.
 *
 * Declared rather than discovered on purpose: with a list, an absent binding is
 * an ERROR. Without one, it is an inference — the check silently has nothing to
 * say, and "not present" reads identically to "not needed". That exact shape is
 * what let a required DSN go missing while `/health` still answered `ok`.
 *
 * Keep it to bindings whose absence breaks a live request path. Optional or
 * surface-specific bindings belong in the deep run, where `skipped` is honest.
 */
const REQUIRED_BINDINGS = ["DB", "SESSION_DO", "FOLDER_DO", "OAUTH_KV"] as const;

type CheckResult = {
  category: "database" | "ai" | "agents" | "binding";
  name: string;
  status: "ok" | "warn" | "fail" | "skipped" | "timeout";
  message?: string;
  details?: Record<string, unknown>;
  durationMs: number;
};

class HealthCoordinator {
  constructor(private readonly env: Env) {}

  // -----------------------------------------------------------------------
  // GET helpers
  // -----------------------------------------------------------------------

  async getLatestRun() {
    const db = getDb(this.env);
    const [latest] = await db
      .select()
      .from(healthRuns)
      .orderBy(desc(healthRuns.createdAt))
      .limit(1);

    if (!latest) return { run: null, results: [] as Array<typeof healthResults.$inferSelect> };

    const results = await db
      .select()
      .from(healthResults)
      .where(eq(healthResults.runId, latest.id));

    return { run: latest, results };
  }

  // -----------------------------------------------------------------------
  // Live probe (GET /) — runs now, persists nothing
  // -----------------------------------------------------------------------

  /**
   * Cheap checks executed per request: every REQUIRED_BINDINGS entry is present,
   * and a real application table is readable. No D1 writes, no DO pings (a
   * 2s-timeout fan-out does not belong on a public endpoint).
   */
  async liveProbe(): Promise<{
    status: "healthy" | "degraded" | "unhealthy" | "unknown";
    checks: CheckResult[];
    durationMs: number;
  }> {
    const start = Date.now();
    const checks = [...this.checkRequiredBindings(), await this.checkD1TableRead()];
    return { status: aggregateStatus(checks), checks, durationMs: Date.now() - start };
  }

  /** One result per declared binding. Absent → `fail`, never `skipped`. */
  private checkRequiredBindings(): CheckResult[] {
    const env = this.env as unknown as Record<string, unknown>;
    return REQUIRED_BINDINGS.map((name) => {
      const start = Date.now();
      const present = env[name] !== undefined && env[name] !== null;
      return {
        category: "binding" as const,
        name: `binding_${name.toLowerCase()}`,
        status: present ? ("ok" as const) : ("fail" as const),
        message: present
          ? `env.${name} is bound`
          : `env.${name} is REQUIRED and missing — declared in REQUIRED_BINDINGS`,
        durationMs: Date.now() - start,
      };
    });
  }

  /**
   * Reads a real table, not `SELECT 1`.
   *
   * `SELECT 1` proves the binding answers; it does not prove a table is
   * readable. Those came apart in production once already — a service had no
   * permission to read a table it needed and every binding-level check stayed
   * green while the endpoint 500'd on every request.
   */
  private async checkD1TableRead(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const db = getDb(this.env);
      const rows = await db.select({ modelId: modelCatalog.modelId }).from(modelCatalog).limit(1);
      const durationMs = Date.now() - start;
      // Readable but empty is a real signal: model resolution has no config to
      // resolve against, so the Worker cannot serve an edit. Degraded, not ok.
      return rows.length > 0
        ? {
            category: "database",
            name: "d1_table_read",
            status: "ok",
            message: "model_catalog is readable",
            durationMs,
          }
        : {
            category: "database",
            name: "d1_table_read",
            status: "warn",
            message: "model_catalog is readable but EMPTY — run POST /api/models/sync",
            durationMs,
          };
    } catch (error) {
      return {
        category: "database",
        name: "d1_table_read",
        status: "fail",
        message: error instanceof Error ? error.message : "Unknown D1 table-read failure",
        durationMs: Date.now() - start,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Run all checks
  // -----------------------------------------------------------------------

  async runAllChecks(trigger: "manual" | "scheduled" | "agent") {
    const start = Date.now();

    const checks = await Promise.all([
      this.checkD1(),
      this.checkWorkersAI(),
      ...AGENT_BINDINGS.map((descriptor) => this.pingAgent(descriptor)),
    ]);

    const durationMs = Date.now() - start;
    const status = aggregateStatus(checks);

    const runId = crypto.randomUUID();
    const db = getDb(this.env);

    await db.insert(healthRuns).values({
      id: runId,
      status,
      trigger,
      durationMs,
      metadata: { checkCount: checks.length },
    });

    if (checks.length > 0) {
      await db.insert(healthResults).values(
        checks.map((c) => ({
          id: crypto.randomUUID(),
          runId,
          category: c.category,
          name: c.name,
          status: c.status,
          message: c.message,
          details: c.details,
          durationMs: c.durationMs,
        })),
      );
    }

    return this.getRunById(runId);
  }

  // -----------------------------------------------------------------------
  // Individual checks
  // -----------------------------------------------------------------------

  private async checkD1(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const result = await this.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      return {
        category: "database",
        name: "d1_roundtrip",
        status: result?.ok === 1 ? "ok" : "warn",
        message: result?.ok === 1 ? "D1 responded with SELECT 1" : "Unexpected D1 response",
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        category: "database",
        name: "d1_roundtrip",
        status: "fail",
        message: error instanceof Error ? error.message : "Unknown D1 failure",
        durationMs: Date.now() - start,
      };
    }
  }

  private async checkWorkersAI(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const binding = (this.env as unknown as { AI?: unknown }).AI;
      if (!binding) {
        return {
          category: "ai",
          name: "workers_ai_binding",
          status: "skipped",
          message: "env.AI binding not present",
          durationMs: Date.now() - start,
        };
      }
      return {
        category: "ai",
        name: "workers_ai_binding",
        status: "ok",
        message: "env.AI binding available",
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        category: "ai",
        name: "workers_ai_binding",
        status: "fail",
        message: error instanceof Error ? error.message : "Unknown AI binding failure",
        durationMs: Date.now() - start,
      };
    }
  }

  private async pingAgent(descriptor: DOBindingDescriptor): Promise<CheckResult> {
    const start = Date.now();
    const ns = (this.env as unknown as Record<string, unknown>)[descriptor.binding as string] as
      | DurableObjectNamespace
      | undefined;

    if (!ns || typeof ns.idFromName !== "function") {
      return {
        category: "binding",
        name: descriptor.name,
        status: "skipped",
        message: `Binding ${String(descriptor.binding)} is not present on env`,
        durationMs: Date.now() - start,
      };
    }

    try {
      const id = ns.idFromName("health-probe");
      const stub = ns.get(id);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      const response = await stub.fetch("https://do.local/__ping", {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      const durationMs = Date.now() - start;
      // 404 is fine — it confirms the DO is reachable even if no /__ping route exists.
      const reachable = response.status < 500;
      return {
        category: "agents",
        name: descriptor.name,
        status: reachable ? "ok" : "fail",
        message: `${descriptor.binding as string} responded ${response.status}`,
        details: { status: response.status },
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        category: "agents",
        name: descriptor.name,
        status: aborted ? "timeout" : "fail",
        message: error instanceof Error ? error.message : "Unknown DO failure",
        durationMs,
      };
    }
  }

  private async getRunById(runId: string) {
    const db = getDb(this.env);
    const [run] = await db.select().from(healthRuns).where(eq(healthRuns.id, runId)).limit(1);
    const results = await db
      .select()
      .from(healthResults)
      .where(eq(healthResults.runId, runId));
    return { run, results };
  }
}

function aggregateStatus(checks: CheckResult[]): "healthy" | "degraded" | "unhealthy" | "unknown" {
  if (checks.length === 0) return "unknown";
  const fails = checks.filter((c) => c.status === "fail" || c.status === "timeout").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails > 0) return "unhealthy";
  if (warns > 0) return "degraded";
  return "healthy";
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const checkStatusEnum = z.enum(["ok", "warn", "fail", "skipped", "timeout"]);
const healthStatusEnum = z.enum(["healthy", "degraded", "unhealthy", "unknown"]);
const triggerEnum = z.enum(["manual", "scheduled", "agent"]);
const categoryEnum = z.enum([
  "database",
  "ai",
  "providers",
  "agents",
  "google",
  "binding",
  "auth",
  "api",
  "custom",
]);

const healthResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  category: categoryEnum,
  name: z.string(),
  status: checkStatusEnum,
  message: z.string().nullish(),
  details: z.record(z.string(), z.unknown()).nullish(),
  durationMs: z.number(),
  aiSuggestion: z.string().nullish(),
  timestamp: z.union([z.string(), z.date()]),
});

const healthRunSchema = z.object({
  id: z.string(),
  status: healthStatusEnum,
  trigger: triggerEnum,
  durationMs: z.number(),
  createdAt: z.union([z.string(), z.date()]),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

const healthResponseSchema = z.object({
  run: healthRunSchema,
  results: z.array(healthResultSchema),
});

const latestResponseSchema = z.object({
  run: healthRunSchema.nullable(),
  results: z.array(healthResultSchema),
});

/** A live check — same shape as a persisted result, minus the run/row ids. */
const liveCheckSchema = z.object({
  category: categoryEnum,
  name: z.string(),
  status: checkStatusEnum,
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number(),
});

/**
 * The live probe's answer. `status` is the verdict and it drives the HTTP code
 * (`unhealthy` → 503), so a monitor reading only the status line still sees red.
 * `lastDeepRun` is CONTEXT from `POST /api/health/run`, never the verdict.
 */
const liveResponseSchema = z.object({
  status: healthStatusEnum,
  checkedAt: z.string(),
  durationMs: z.number(),
  checks: z.array(liveCheckSchema),
  lastDeepRun: healthRunSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const healthRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * GET /api/health (and GET /health) — LIVE probe with a verdict.
 *
 * Runs the cheap checks now and answers 503 when the verdict is `unhealthy`.
 * BOTH status codes are declared on the route: zod-openapi enforces the
 * response union, so returning an undeclared status is a type error rather than
 * a surprise at runtime.
 */
healthRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "healthCheck",
    responses: {
      200: {
        description: "Live probe — healthy or degraded",
        content: { "application/json": { schema: liveResponseSchema } },
      },
      503: {
        description: "Live probe — unhealthy (a required binding or D1 read failed)",
        content: { "application/json": { schema: liveResponseSchema } },
      },
    },
  }),
  async (c) => {
    const coordinator = new HealthCoordinator(c.env);
    const probe = await coordinator.liveProbe();

    // Context only. A failure to read history must not mask the live verdict,
    // so this is best-effort: the probe above already decided the answer.
    let lastDeepRun: Awaited<ReturnType<HealthCoordinator["getLatestRun"]>>["run"] = null;
    try {
      lastDeepRun = (await coordinator.getLatestRun()).run;
    } catch {
      lastDeepRun = null;
    }

    const body = {
      status: probe.status,
      checkedAt: new Date().toISOString(),
      durationMs: probe.durationMs,
      checks: probe.checks,
      lastDeepRun,
    };
    return c.json(body, probe.status === "unhealthy" ? 503 : 200);
  },
);

/**
 * GET /api/health/latest — Same as GET / (explicit alias).
 */
healthRouter.openapi(
  createRoute({
    method: "get",
    path: "/latest",
    operationId: "getLatestHealthCheck",
    responses: {
      200: {
        description: "Most recent health run from D1",
        content: { "application/json": { schema: latestResponseSchema } },
      },
    },
  }),
  async (c) => {
    const coordinator = new HealthCoordinator(c.env);
    const latest = await coordinator.getLatestRun();
    return c.json({ run: latest?.run ?? null, results: latest?.results ?? [] }, 200);
  },
);

/**
 * POST /api/health/run — Explicit manual screening trigger.
 *
 * Runs all health checks (D1 roundtrip, Workers AI binding presence, every
 * registered agent DO ping) in parallel, persists run + results to D1, and
 * returns the full payload.
 */
healthRouter.openapi(
  createRoute({
    method: "post",
    path: "/run",
    operationId: "runHealthCheck",
    responses: {
      200: {
        description: "On-demand health diagnostic results",
        content: { "application/json": { schema: healthResponseSchema } },
      },
    },
  }),
  async (c) => {
    const coordinator = new HealthCoordinator(c.env);
    const { run, results } = await coordinator.runAllChecks("manual");
    return c.json({ run, results }, 200);
  },
);
