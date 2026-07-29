/**
 * @fileoverview Prompt library + grading core. CRUD over `prompt_templates`,
 * promotion from a successful revision, grading over `prompt_grades`, and the
 * avg_grade rollup so a promoted template that stops performing becomes visible.
 * Surfaces (a /prompts page, MCP tools) call these; the retrieve-before-composing
 * MCP tool is the highest-value entry point.
 */

import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";

import { promptGrades, promptTemplates, revisions } from "@/backend/db/schema";
import type { PromptGrade, PromptTemplate } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError, ValidationError } from "../errors";
import { requireRevision } from "../revisions/query";

type Surface = "ui" | "api" | "mcp";

export interface CreateTemplateInput {
  title: string;
  category: string;
  templateBody: string;
  examplePrompt?: string | null;
  recommendedModel?: string | null;
  recommendedSettings?: Record<string, unknown> | null;
  techniqueTags?: string[] | null;
  source?: "seeded" | "promoted" | "manual";
  createdVia?: Surface;
}

export async function createTemplate(
  ctx: CoreContext,
  input: CreateTemplateInput,
): Promise<PromptTemplate> {
  if (!input.title.trim()) throw new ValidationError("Template title cannot be empty.");
  if (!input.templateBody.trim()) throw new ValidationError("Template body cannot be empty.");
  const [row] = await ctx.db
    .insert(promptTemplates)
    .values({
      title: input.title,
      category: input.category,
      templateBody: input.templateBody,
      examplePrompt: input.examplePrompt ?? null,
      recommendedModel: input.recommendedModel ?? null,
      recommendedSettings: input.recommendedSettings ?? null,
      techniqueTags: input.techniqueTags ?? null,
      source: input.source ?? "manual",
      createdVia: input.createdVia ?? "ui",
    })
    .returning();
  return row;
}

/** List live templates, optional category filter + free-text search. */
export async function listTemplates(
  ctx: CoreContext,
  input?: { category?: string; q?: string },
): Promise<PromptTemplate[]> {
  const live = isNull(promptTemplates.deletedAt);
  const conds = [live];
  if (input?.category) conds.push(eq(promptTemplates.category, input.category));
  if (input?.q) {
    const pat = `%${input.q}%`;
    conds.push(or(like(promptTemplates.title, pat), like(promptTemplates.templateBody, pat))!);
  }
  return ctx.db
    .select()
    .from(promptTemplates)
    .where(and(...conds))
    .orderBy(desc(promptTemplates.avgGrade), desc(promptTemplates.useCount));
}

export async function requireTemplate(ctx: CoreContext, id: string): Promise<PromptTemplate> {
  const [row] = await ctx.db
    .select()
    .from(promptTemplates)
    .where(and(eq(promptTemplates.id, id), isNull(promptTemplates.deletedAt)))
    .limit(1);
  if (!row) throw new NotFoundError(`Prompt template ${id} not found.`);
  return row;
}

/** Increment use_count when a template is applied (the "use this template" action). */
export async function useTemplate(ctx: CoreContext, id: string): Promise<PromptTemplate> {
  await requireTemplate(ctx, id);
  const [row] = await ctx.db
    .update(promptTemplates)
    .set({ useCount: sql`${promptTemplates.useCount} + 1`, updatedAt: new Date() })
    .where(eq(promptTemplates.id, id))
    .returning();
  return row;
}

export async function softDeleteTemplate(ctx: CoreContext, id: string): Promise<PromptTemplate> {
  await requireTemplate(ctx, id);
  const [row] = await ctx.db
    .update(promptTemplates)
    .set({ deletedAt: new Date() })
    .where(eq(promptTemplates.id, id))
    .returning();
  return row;
}

/** Promote a successful revision's prompt into a template, prefilled + linked. */
export async function promoteFromRevision(
  ctx: CoreContext,
  input: { revisionId: string; title: string; category: string; createdVia?: Surface },
): Promise<PromptTemplate> {
  const rev = await requireRevision(ctx, input.revisionId);
  const settings = (rev.editPayload ?? {}) as Record<string, unknown>;
  const [row] = await ctx.db
    .insert(promptTemplates)
    .values({
      title: input.title,
      category: input.category,
      templateBody: rev.promptText,
      examplePrompt: rev.promptText,
      recommendedModel: rev.servedModel ?? rev.requestedModel ?? null,
      recommendedSettings: settings,
      source: "promoted",
      promotedFromRevisionId: rev.id,
      createdVia: input.createdVia ?? "ui",
    })
    .returning();
  return row;
}

export type FailureMode =
  | "perspective_drift"
  | "dimension_change"
  | "colour_shift"
  | "ignored_instruction"
  | "unwanted_addition"
  | "text_garbled"
  | "style_mismatch"
  | "quality"
  | "other";

export interface GradeInput {
  revisionId: string;
  grade: number; // 1–5
  templateId?: string | null;
  failureMode?: FailureMode | null;
  notes?: string | null;
  suggestedRevision?: string | null;
  gradedBySurface?: Surface;
}

/** Grade a revision's output; roll the average up to the template if one is set. */
export async function gradeRevision(ctx: CoreContext, input: GradeInput): Promise<PromptGrade> {
  if (input.grade < 1 || input.grade > 5) {
    throw new ValidationError("grade must be between 1 and 5.");
  }
  await requireRevision(ctx, input.revisionId);
  const [row] = await ctx.db
    .insert(promptGrades)
    .values({
      revisionId: input.revisionId,
      templateId: input.templateId ?? null,
      grade: input.grade,
      failureMode: input.failureMode ?? null,
      notes: input.notes ?? null,
      suggestedRevision: input.suggestedRevision ?? null,
      gradedBySurface: input.gradedBySurface ?? null,
    })
    .returning();

  if (input.templateId) await rollupTemplateGrade(ctx, input.templateId);
  return row;
}

/** Recompute a template's avg_grade from its grades. */
async function rollupTemplateGrade(ctx: CoreContext, templateId: string): Promise<void> {
  const [agg] = await ctx.db
    .select({ avg: sql<number>`avg(${promptGrades.grade})` })
    .from(promptGrades)
    .where(eq(promptGrades.templateId, templateId));
  await ctx.db
    .update(promptTemplates)
    .set({ avgGrade: agg?.avg ?? null, updatedAt: new Date() })
    .where(eq(promptTemplates.id, templateId));
}

/**
 * Seed the best-practice TECHNIQUE entries named inline in the spec. The full
 * category template set comes from the attached prompting guide (not yet in
 * hand) — seed those when it arrives.
 */
export async function seedPromptTechniques(ctx: CoreContext): Promise<number> {
  const techniques: CreateTemplateInput[] = [
    { title: "Hyper-specificity", category: "technique", templateBody: "Describe [subject] with concrete, unambiguous detail: exact colours, materials, counts, and spatial relationships — never vague adjectives.", techniqueTags: ["hyper-specificity"], source: "seeded" },
    { title: "Context and intent", category: "technique", templateBody: "State the purpose of the image and the scene it lives in so the model resolves ambiguity toward [intent].", techniqueTags: ["context-and-intent"], source: "seeded" },
    { title: "Iterative refinement", category: "technique", templateBody: "Start broad, then in follow-up turns change ONE thing at a time: [change]. Keep everything else fixed.", techniqueTags: ["iterative-refinement"], source: "seeded" },
    { title: "Step-by-step instructions", category: "technique", templateBody: "1) [step one]. 2) [step two]. 3) [step three]. Execute in order; do not merge steps.", techniqueTags: ["step-by-step"], source: "seeded" },
    { title: "Semantic negative prompts", category: "technique", templateBody: "Describe what SHOULD be present instead of what shouldn't: replace 'no [X]' with '[positive alternative]'.", techniqueTags: ["semantic-negative-prompts"], source: "seeded" },
    { title: "Camera control", category: "technique", templateBody: "Specify lens, angle, and distance: [focal length], [eye-level/low/high angle], [close-up/wide]. Preserve these across edits to avoid perspective drift.", techniqueTags: ["camera-control", "perspective"], source: "seeded" },
  ];
  let n = 0;
  for (const t of techniques) {
    const [existing] = await ctx.db
      .select({ id: promptTemplates.id })
      .from(promptTemplates)
      .where(and(eq(promptTemplates.title, t.title), eq(promptTemplates.source, "seeded")))
      .limit(1);
    if (!existing) {
      await createTemplate(ctx, t);
      n++;
    }
  }
  return n;
}
