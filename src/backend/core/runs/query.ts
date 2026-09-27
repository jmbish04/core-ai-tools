/**
 * @fileoverview Reads over the multi-model run engine: one run with its results,
 * and a list of runs (optionally scoped to a folder).
 *
 * The run's status is DERIVED from its result rows rather than stored, so there
 * is no second copy to drift out of sync with the rows that actually failed.
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { libraryImages, modelRunResults, modelRuns } from "@/backend/db/schema";
import type { ModelRunResult } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError } from "../errors";
import type { ModelRunWithResults } from "./runs";

/**
 * Collapse result statuses into one run status.
 *
 * @param results - Every result row of a run.
 * @returns `succeeded` when all succeeded, `failed` when all failed, `partial`
 *   when a terminal run has both, else `running`/`queued`.
 */
export function deriveStatus(results: ModelRunResult[]): ModelRunWithResults["status"] {
  if (results.length === 0) return "queued";
  if (results.some((r) => r.status === "running")) return "running";
  if (results.some((r) => r.status === "queued")) return results.some((r) => r.status !== "queued") ? "running" : "queued";
  const ok = results.filter((r) => r.status === "succeeded").length;
  if (ok === results.length) return "succeeded";
  return ok === 0 ? "failed" : "partial";
}

/**
 * Fetch one run with its result rows, ordered as the models were requested.
 *
 * @param ctx - Core context.
 * @param runId - The run id.
 * @returns The run, its results, and the derived status.
 * @throws NotFoundError when the run does not exist.
 */

/**
 * Attach each result's output image URL.
 *
 * A comparison is a picture of N outputs side by side, so a result row carrying
 * only an image ID sends every surface off to resolve it — and they would each
 * resolve it differently. One join here, and REST, MCP and the UI all agree.
 *
 * @param rows Result rows, some of which may have no output (a failed model).
 * @returns The same rows, each with `deliveryUrl` where an output exists.
 */
async function withOutputUrls<T extends { outputImageId: string | null }>(
  ctx: CoreContext,
  rows: T[],
): Promise<(T & { deliveryUrl: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.outputImageId).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, deliveryUrl: null }));
  const images = await ctx.db
    .select({ id: libraryImages.id, deliveryUrl: libraryImages.deliveryUrl })
    .from(libraryImages)
    .where(inArray(libraryImages.id, ids));
  const byId = new Map(images.map((i) => [i.id, i.deliveryUrl]));
  return rows.map((r) => ({
    ...r,
    deliveryUrl: r.outputImageId ? (byId.get(r.outputImageId) ?? null) : null,
  }));
}

export async function getModelRun(ctx: CoreContext, runId: string): Promise<ModelRunWithResults> {
  const [run] = await ctx.db.select().from(modelRuns).where(eq(modelRuns.id, runId)).limit(1);
  if (!run) throw new NotFoundError(`Model run ${runId} not found.`);
  const rows = await withOutputUrls(
    ctx,
    await ctx.db.select().from(modelRunResults).where(eq(modelRunResults.runId, runId)),
  );
  const order = new Map((run.requestedModels ?? []).map((m, idx) => [m, idx]));
  const results = rows.sort(
    (a, b) => (order.get(a.requestedModel) ?? 99) - (order.get(b.requestedModel) ?? 99),
  );
  return { run, results, status: deriveStatus(results) };
}

export interface ListModelRunsInput {
  folderId?: string | null;
  limit?: number;
}

/**
 * List runs newest-first, with their results attached.
 *
 * @param ctx - Core context.
 * @param input - Optional folder scope and row limit (default 25).
 * @returns Runs newest-first, each with its results and derived status.
 */
export async function listModelRuns(
  ctx: CoreContext,
  input: ListModelRunsInput = {},
): Promise<ModelRunWithResults[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const where = input.folderId ? and(eq(modelRuns.folderId, input.folderId)) : undefined;
  const runs = await ctx.db
    .select()
    .from(modelRuns)
    .where(where)
    .orderBy(desc(modelRuns.createdAt))
    .limit(limit);
  if (runs.length === 0) return [];

  // One query for every run's results, not one per run — and one more for their
  // output URLs, so a list of runs renders thumbnails without N fetches.
  const rows = await withOutputUrls(
    ctx,
    await ctx.db
      .select()
      .from(modelRunResults)
      .where(inArray(modelRunResults.runId, runs.map((r) => r.id))),
  );
  const byRun = new Map<string, (ModelRunResult & { deliveryUrl: string | null })[]>();
  for (const row of rows) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row);
    byRun.set(row.runId, list);
  }
  return runs.map((run) => {
    const results = byRun.get(run.id) ?? [];
    return { run, results, status: deriveStatus(results) };
  });
}
