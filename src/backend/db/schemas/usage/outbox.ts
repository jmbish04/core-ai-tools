/**
 * @fileoverview `usage_outbox` — durable buffer for core-guardian usage records.
 *
 * Guardian emission must be non-blocking AND never dropped: a generation never
 * waits on or fails because of a guardian outage. The dispatch wrapper fires the
 * POST via `waitUntil`; if it fails, the record lands here and a cron drains it
 * with backoff. Usage data that silently disappears during an outage is worse
 * than none, so this table is the safety net.
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const USAGE_OUTBOX_TABLE_DESCRIPTION =
  "Durable buffer of core-guardian usage records that failed to POST. A cron drains it with backoff so no usage record is lost during a guardian outage.";

export const USAGE_OUTBOX_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  payload: "JSON body to POST to /api/guardian/usage/register.",
  attempts: "Delivery attempts so far.",
  last_error: "Last delivery error message (never a secret).",
  next_retry_at: "Unix timestamp (seconds) the cron should next attempt.",
  created_at: "Unix timestamp (seconds) when buffered.",
};

export const usageOutbox = sqliteTable("usage_outbox", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertUsageOutboxSchema = createInsertSchema(usageOutbox);
export const selectUsageOutboxSchema = createSelectSchema(usageOutbox);
export type UsageOutboxRow = typeof usageOutbox.$inferSelect;
export type NewUsageOutboxRow = typeof usageOutbox.$inferInsert;
