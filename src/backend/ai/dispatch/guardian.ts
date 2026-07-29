/**
 * @fileoverview core-guardian usage client. Verified contract:
 * `POST http://core-guardian.hacolby.workers.dev/api/guardian/usage/register`,
 * bearer `WORKER_API_KEY`, required `worker`/`provider`/`model`, optional
 * `tokensIn`/`tokensOut`/`tokensThinking`/`requests`/`costUsd`/`gateway`/`at`/…
 * Response `{ ..., priced: "explicit" | "scraped" | "unmatched" }`.
 *
 * Properties (all non-negotiable):
 *  - NON-BLOCKING: fire via `waitUntil`; a guardian outage never fails/delays a
 *    generation.
 *  - BUFFERED, not dropped: on failure the record lands in `usage_outbox`; a cron
 *    drains it with backoff.
 *  - `tokensThinking` is sent SEPARATELY (Gemini image models bill thinking tokens
 *    whether or not you read them; folding them into tokensOut understates cost).
 *  - `costUsd` omitted → guardian auto-prices from its scraped catalog. `priced:
 *    "unmatched"` means our model id drifted from guardian's catalog — log it.
 *  - Emitted only from the shared dispatch wrapper, so no provider path bypasses it.
 */

import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { usageOutbox } from "@/backend/db/schema";
import { getWorkerApiKey } from "@/backend/utils/secrets";

const GUARDIAN_URL = "https://core-guardian.hacolby.workers.dev/api/guardian/usage/register";
export const GUARDIAN_WORKER_NAME = "core-ai-tools";

/** Usage payload. `worker`/`provider`/`model` required; the rest optional. */
export interface GuardianUsage {
  worker: string;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Thinking/reasoning tokens — SEPARATE from tokensOut. */
  tokensThinking?: number;
  requests?: number;
  /** Omit to let guardian auto-price from its scraped catalog. */
  costUsd?: number;
  gateway?: string;
  at?: number;
  operationId?: string;
  taskDescription?: string;
}

async function postUsage(env: Env, usage: GuardianUsage): Promise<void> {
  const token = await getWorkerApiKey(env);
  if (!token) throw new Error("WORKER_API_KEY unresolved for guardian usage.");
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(usage),
  };
  // Prefer the service binding (internal routing, no error 1042). Fall back to a
  // public fetch only if the binding is absent (e.g. a stripped-down env).
  const res = env.GUARDIAN
    ? await env.GUARDIAN.fetch(GUARDIAN_URL, init)
    : await fetch(GUARDIAN_URL, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`guardian usage register failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { priced?: string };
  if (json.priced === "unmatched") {
    console.warn(
      `[guardian] model '${usage.model}' unmatched in guardian's pricing catalog — model id may have drifted`,
    );
  }
}

/**
 * Emit a usage record. Non-blocking when `waitUntil` is supplied; on any failure
 * the record is buffered to `usage_outbox` for the cron to retry.
 */
export async function emitUsage(
  env: Env,
  db: DrizzleD1Database,
  usage: GuardianUsage,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  const run = async () => {
    try {
      await postUsage(env, usage);
    } catch (err) {
      // Buffer, never drop.
      await db
        .insert(usageOutbox)
        .values({
          payload: usage as unknown as Record<string, unknown>,
          lastError: err instanceof Error ? err.message : String(err),
          nextRetryAt: new Date(Date.now() + 60_000),
        })
        .catch(() => undefined);
    }
  };
  if (waitUntil) waitUntil(run());
  else await run();
}

/** Retry backoff schedule (seconds) by attempt count. */
const BACKOFF_S = [60, 300, 1800, 7200, 43200];

/**
 * Drain due `usage_outbox` records (cron). Deletes on success, bumps attempts +
 * schedules the next retry on failure. Returns the count delivered.
 */
export async function drainUsageOutbox(
  env: Env,
  db: DrizzleD1Database,
  now: Date = new Date(),
): Promise<number> {
  const due = await db
    .select()
    .from(usageOutbox)
    .where(and(isNotNull(usageOutbox.nextRetryAt), lte(usageOutbox.nextRetryAt, now)))
    .limit(100);

  let delivered = 0;
  for (const row of due) {
    try {
      await postUsage(env, row.payload as unknown as GuardianUsage);
      await db.delete(usageOutbox).where(eqId(row.id));
      delivered++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const backoff = BACKOFF_S[Math.min(attempts, BACKOFF_S.length - 1)] * 1000;
      await db
        .update(usageOutbox)
        .set({
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
          nextRetryAt: new Date(now.getTime() + backoff),
        })
        .where(eqId(row.id));
    }
  }
  return delivered;
}

function eqId(id: string) {
  return eq(usageOutbox.id, id);
}
