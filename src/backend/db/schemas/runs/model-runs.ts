/**
 * @fileoverview `model_runs` + `model_run_results` — the multi-model run engine
 * (W2.5). ONE user intent, fanned out to N models, for side-by-side comparison.
 *
 * Shape: a `model_runs` row is the INTENT (prompt, optional input image, optional
 * mask, the requested model ids, the destination folder). A `model_run_results`
 * row per model carries that model's outcome — crucially including
 * `prompt_sent`, the EXACT text that model received after per-provider rewriting
 * (`core/runs/prompt.ts#buildPromptFor`). Two models in the same run are sent
 * different words; without this column a comparison is unreadable.
 *
 * Partial failure is first-class: a failed result row sits next to succeeded
 * ones. The run itself has no status column — it is derived from its results
 * (`core/runs/query.ts#runStatus`), so there is no second copy to drift.
 *
 * Replay integrity (repo rule): FKs into the soft-delete-only tables
 * (`library_images`, `masks`) are `ON DELETE RESTRICT`, so an input or output a
 * run references can never be hard-deleted out from under it. A run owns its
 * results, so that FK cascades.
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

import { libraryFolders } from "../library/folders";
import { libraryImages } from "../library/images";
import { masks } from "../sessions/masks";

// ---------------------------------------------------------------------------
// Documentation (consumed by /api/docs/schema)
// ---------------------------------------------------------------------------

export const MODEL_RUNS_TABLE_DESCRIPTION =
  "One user intent fanned out to several models for side-by-side comparison. Holds the intent only; per-model outcomes live in model_run_results.";

export const MODEL_RUNS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  prompt: "The user's intent, verbatim and un-rewritten. Each model's rewritten text is on its result row.",
  input_image_id: "FK into library_images.id — the image being edited, or null for prompt-only generation. ON DELETE RESTRICT.",
  mask_id: "FK into masks.id — the region to confine the edit to, or null. ON DELETE RESTRICT.",
  requested_models: "JSON array of the model ids this intent was fanned out to, in request order.",
  folder_id: "FK into library_folders.id — where every output image is registered, or null for the library root.",
  context_text: "Optional standing context handed to models whose capability flags say they use a narrative register.",
  created_via: "ui | api | mcp.",
  created_at: "Unix timestamp (seconds).",
};

export const MODEL_RUN_RESULTS_TABLE_DESCRIPTION =
  "One model's outcome within a run: the exact prompt it was sent, its output image, timing, cost, tokens, and any error. A failure here never fails the run.";

export const MODEL_RUN_RESULTS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "UUID primary key.",
  run_id: "FK into model_runs.id. ON DELETE CASCADE — a run owns its results.",
  requested_model: "The model id asked for. Unique per run.",
  served_model: "The model id that actually served the call (dispatch reports it), or null until it has.",
  status: "queued | running | succeeded | failed.",
  prompt_sent: "The EXACT prompt this model received, after per-provider rewriting. The whole point of the comparison.",
  mask_sent: "Whether the mask was sent in-band (native mask channel) rather than described in words.",
  output_image_id: "FK into library_images.id — the registered output. ON DELETE RESTRICT.",
  latency_ms: "Wall-clock milliseconds for this model's dispatch + upload.",
  cost_usd: "Cost in USD when known, else null (guardian auto-prices from the usage record).",
  tokens_in: "Prompt tokens reported by the provider.",
  tokens_out: "Output tokens reported by the provider.",
  tokens_thinking: "Thinking tokens — billed separately, never folded into tokens_out.",
  error_code: "Typed error code when status='failed'.",
  error_message: "Human-readable failure text when status='failed'.",
  created_at: "Unix timestamp (seconds).",
  completed_at: "Unix timestamp (seconds) when the result reached a terminal status.",
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const modelRuns = sqliteTable(
  "model_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    prompt: text("prompt").notNull(),
    /** RESTRICT: a run must always be able to name what it started from. */
    inputImageId: text("input_image_id").references(() => libraryImages.id, { onDelete: "restrict" }),
    maskId: text("mask_id").references(() => masks.id, { onDelete: "restrict" }),
    requestedModels: text("requested_models", { mode: "json" }).$type<string[]>().notNull(),
    folderId: text("folder_id").references(() => libraryFolders.id, { onDelete: "set null" }),
    contextText: text("context_text"),
    createdVia: text("created_via", { enum: ["ui", "api", "mcp"] })
      .notNull()
      .default("api"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("idx_model_runs_folder").on(t.folderId),
    index("idx_model_runs_created").on(t.createdAt),
  ],
);

export const modelRunResults = sqliteTable(
  "model_run_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text("run_id")
      .notNull()
      .references(() => modelRuns.id, { onDelete: "cascade" }),
    requestedModel: text("requested_model").notNull(),
    servedModel: text("served_model"),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
      .notNull()
      .default("queued"),
    promptSent: text("prompt_sent").notNull(),
    maskSent: integer("mask_sent", { mode: "boolean" }).notNull().default(false),
    /** RESTRICT: the output is the artifact being compared — never orphan it. */
    outputImageId: text("output_image_id").references(() => libraryImages.id, { onDelete: "restrict" }),
    latencyMs: integer("latency_ms"),
    costUsd: real("cost_usd"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    tokensThinking: integer("tokens_thinking"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [
    // One row per model per run — makes a double fan-out a loud constraint error
    // rather than two silently divergent result rows.
    uniqueIndex("uniq_model_run_results_model").on(t.runId, t.requestedModel),
  ],
);

export const insertModelRunSchema = createInsertSchema(modelRuns);
export const selectModelRunSchema = createSelectSchema(modelRuns);
export const insertModelRunResultSchema = createInsertSchema(modelRunResults);
export const selectModelRunResultSchema = createSelectSchema(modelRunResults);

export type ModelRun = typeof modelRuns.$inferSelect;
export type NewModelRun = typeof modelRuns.$inferInsert;
export type ModelRunResult = typeof modelRunResults.$inferSelect;
export type NewModelRunResult = typeof modelRunResults.$inferInsert;
