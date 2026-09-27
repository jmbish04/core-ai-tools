/**
 * @fileoverview Model registry API — the single source of truth for model
 * selection. Drives the UI picker, `list_available_models`, and `/api/models`.
 *
 * TWO layers:
 *  - The declarative `MODEL_CATALOG` (code) — capabilities, pins.
 *  - `task_model_defaults` (D1) — the AUTHORITATIVE task->model mapping dispatch
 *    reads. Resolution order: explicit → session.model_overrides → default → ERROR.
 *
 * Capability flags are enforced BEFORE dispatch. A request the chosen model can't
 * satisfy is rejected with a `CapabilityError` naming the models that can — never
 * silently downgraded.
 */

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { modelCatalog, taskModelDefaults } from "@/backend/db/schema";
import { CapabilityError, ConfigError, NotFoundError, ValidationError } from "@/backend/core/errors";
import { MODEL_CATALOG } from "./catalog";
import type { ModelCapabilities, ModelEntry, TaskKey } from "./types";

export * from "./types";
export { MODEL_CATALOG } from "./catalog";

// --- Pure registry queries ---------------------------------------------------

export function listModels(): ModelEntry[] {
  return MODEL_CATALOG;
}

export function getModel(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function requireModel(id: string): ModelEntry {
  const m = getModel(id);
  if (!m) throw new NotFoundError(`Model ${id} is not in the registry.`);
  return m;
}

/** Models that have a boolean capability flag set. */
export function modelsWithCapability(cap: keyof ModelCapabilities): ModelEntry[] {
  return MODEL_CATALOG.filter((m) => m.capabilities[cap] === true);
}

/** A capability requirement derived from an edit/generation request. */
export interface CapabilityRequirement {
  /** Prompt-only generation (no input image). */
  text_to_image?: boolean;
  /** Editing an input image — keeps fallback off understanding-only models. */
  image_to_image?: boolean;
  mask_inpainting?: boolean;
  multi_reference_count?: number;
  /** Reference images tagged role='object' — capped by max_object_refs. */
  object_ref_count?: number;
  /** Reference images tagged role='style' — capped by max_style_refs. */
  style_ref_count?: number;
  grounding_web?: boolean;
  grounding_image_search?: boolean;
  video_generation?: boolean;
  segmentation?: boolean;
  resolution?: ModelCapabilities["max_resolution"];
  aspect_ratio?: string;
}

const RESOLUTION_RANK: Record<ModelCapabilities["max_resolution"], number> = {
  "512px": 0,
  "1K": 1,
  "2K": 2,
  "4K": 3,
};

/**
 * True if a model satisfies every requirement. Pure — used both for enforcement
 * and for fallback candidate selection.
 */
export function modelSatisfies(model: ModelEntry, req: CapabilityRequirement): boolean {
  const c = model.capabilities;
  if (req.text_to_image && !c.text_to_image) return false;
  if (req.image_to_image && !c.image_to_image) return false;
  // A masked edit is satisfied by a native mask channel OR emulation (semantic /
  // composite). Emulated service is flagged `mask_emulated` on the revision.
  if (req.mask_inpainting && !c.mask_inpainting && !c.mask_emulated_only) return false;
  if (req.grounding_web && !c.grounding_web) return false;
  if (req.grounding_image_search && !c.grounding_image_search) return false;
  if (req.video_generation && !c.video_generation) return false;
  if (req.segmentation && !c.segmentation) return false;
  if (req.multi_reference_count && req.multi_reference_count > c.max_reference_images) return false;
  if (req.object_ref_count && req.object_ref_count > c.max_object_refs) return false;
  if (req.style_ref_count && req.style_ref_count > c.max_style_refs) return false;
  if (req.resolution && RESOLUTION_RANK[req.resolution] > RESOLUTION_RANK[c.max_resolution]) return false;
  if (req.aspect_ratio && !c.supported_aspect_ratios.includes(req.aspect_ratio)) return false;
  return true;
}

/**
 * Enforce capabilities before dispatch. Throws a CapabilityError naming the
 * models that DO satisfy the requirement — never silently downgrades.
 */
export function assertCapability(modelId: string, req: CapabilityRequirement): ModelEntry {
  const model = requireModel(modelId);
  if (modelSatisfies(model, req)) return model;

  // Build a precise message + the list of capable models for the offending flag.
  const capable = MODEL_CATALOG.filter((m) => modelSatisfies(m, req)).map((m) => m.id);
  throw new CapabilityError(
    `Model ${modelId} cannot satisfy the requested capability. Models that can: ${capable.join(", ") || "(none registered)"}.`,
    { requested: req, capableModels: capable },
  );
}

// --- Authoritative resolution (reads task_model_defaults) --------------------

export interface ResolveInput {
  taskKey: TaskKey;
  /** An explicit model id from the request (highest precedence). */
  explicit?: string | null;
  /** Per-session overrides map (sessions.model_overrides). */
  sessionOverrides?: Record<string, string> | null;
}

/**
 * Resolve the model id for a task. Order: explicit → session override → enabled
 * task default → ERROR. Never falls back to a silent hardcoded default.
 */
export async function resolveModelId(
  db: DrizzleD1Database,
  input: ResolveInput,
): Promise<string> {
  if (input.explicit) {
    requireModel(input.explicit); // validate it's registered
    return input.explicit;
  }
  const override = input.sessionOverrides?.[input.taskKey];
  if (override) {
    requireModel(override);
    return override;
  }
  const [row] = await db
    .select()
    .from(taskModelDefaults)
    .where(eq(taskModelDefaults.taskKey, input.taskKey))
    .limit(1);
  if (!row || !row.enabled) {
    throw new ValidationError(
      `No model resolved for task '${input.taskKey}' (no explicit model, no session override, no enabled default). Set one via /api/models/tasks/${input.taskKey}.`,
    );
  }
  return row.modelId;
}

/**
 * Choose a fallback model for a transport failure — another model whose flags
 * still satisfy the ORIGINAL requirement, excluding the failed one. Returns null
 * when nothing else qualifies (caller surfaces the original error).
 */
export function pickFallbackModel(
  failedModelId: string,
  req: CapabilityRequirement,
): ModelEntry | null {
  return (
    MODEL_CATALOG.find(
      (m) => m.id !== failedModelId && !m.deprecated && modelSatisfies(m, req),
    ) ?? null
  );
}

// --- Seeding (model_catalog + task_model_defaults) ---------------------------

/**
 * Upsert the declarative catalog into `model_catalog`, and seed
 * `task_model_defaults` from each entry's `default_for` (only if a default for
 * that task doesn't already exist — never overwrites a human-set mapping).
 */
export async function seedRegistry(db: DrizzleD1Database): Promise<void> {
  const now = new Date();
  for (const m of MODEL_CATALOG) {
    await db
      .insert(modelCatalog)
      .values({
        modelId: m.id,
        provider: m.provider,
        displayName: m.display_name,
        capabilities: m.capabilities as unknown as Record<string, unknown>,
        maxResolution: m.capabilities.max_resolution,
        supportedAspectRatios: m.capabilities.supported_aspect_ratios,
        costPerImage: m.capabilities.cost_per_image,
        deprecatedAt: m.deprecated ? now : null,
      })
      .onConflictDoUpdate({
        target: modelCatalog.modelId,
        set: {
          displayName: m.display_name,
          capabilities: m.capabilities as unknown as Record<string, unknown>,
          maxResolution: m.capabilities.max_resolution,
          supportedAspectRatios: m.capabilities.supported_aspect_ratios,
          deprecatedAt: m.deprecated ? now : null,
          updatedAt: now,
        },
      });
  }
  for (const m of MODEL_CATALOG) {
    for (const task of m.default_for ?? []) {
      const [existing] = await db
        .select({ taskKey: taskModelDefaults.taskKey })
        .from(taskModelDefaults)
        .where(eq(taskModelDefaults.taskKey, task))
        .limit(1);
      if (!existing) {
        await db.insert(taskModelDefaults).values({ taskKey: task, modelId: m.id });
      }
    }
  }
}

/**
 * Validate every enabled task default resolves to a live, non-deprecated catalog
 * row. Returns the list of broken mappings (empty = healthy). The one case where
 * silence is unacceptable — surface loudly.
 */
export async function validateTaskDefaults(
  db: DrizzleD1Database,
): Promise<{ taskKey: string; modelId: string; reason: string }[]> {
  const defaults = await db.select().from(taskModelDefaults);
  const broken: { taskKey: string; modelId: string; reason: string }[] = [];
  for (const d of defaults) {
    if (!d.enabled) continue;
    const [cat] = await db
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.modelId, d.modelId))
      .limit(1);
    if (!cat) broken.push({ taskKey: d.taskKey, modelId: d.modelId, reason: "not in catalog" });
    else if (cat.deprecatedAt)
      broken.push({ taskKey: d.taskKey, modelId: d.modelId, reason: "deprecated" });
  }
  return broken;
}

// Re-export ConfigError so dispatch callers have one import site.
export { ConfigError };
