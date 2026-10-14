/**
 * @fileoverview Co-creator service layer — the one place its business logic
 * lives. REST (and any later MCP tool) only parses, calls this, and serializes.
 *
 * Flow per session (mirrors the demo, persisted):
 *   1. create — the initial prompt is version 1 of the revision log.
 *   2. analyze — belief graph + 3 clarifying questions (stored as `pending` answers).
 *   3. answer / skip — and optionally import answers from other sessions.
 *   4. propose refinement — the model rewrites the prompt; NOT saved yet.
 *   5. accept → a new prompt version; the answers it absorbed are stamped
 *      `applied_in_version_id`, so the log says which decisions made each version.
 *   6. generate — images from a version, stored in Cloudflare Images via the library.
 *   Consultant — reads answered questions across sessions and advises.
 */

import { and, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";

import {
  cocreateAnswers,
  cocreateConsultationMatches,
  cocreateConsultations,
  cocreateGenerations,
  cocreatePromptVersions,
  cocreateSessions,
  libraryImages,
} from "@/backend/db/schema";
import type {
  BeliefGraph,
  CocreateAnswer,
  CocreatePromptVersion,
  CocreateSession,
  GraphUpdate,
  PromptVersionSource,
} from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError, ValidationError, isUniqueViolation } from "../errors";
import { generateImages } from "../generate";
import { fetchImageBase64 } from "../images";
import { requireImage } from "../library/images";
import {
  beliefGraphSchema,
  callModel,
  clarificationsSchema,
  consultSchema,
  parseOrThrow,
} from "./ai";
import {
  beliefGraphInstruction,
  clarificationInstruction,
  cleanRefinedPrompt,
  consultInstruction,
  refineInstruction,
  type Proactiveness,
} from "./prompts";

type WaitUntil = (p: Promise<unknown>) => void;

/** ponytail: the consultant reads the newest N answers, not a semantic index.
 *  Fine for a single user's history; move to Vectorize retrieval when the
 *  answered pool outgrows one prompt (~a few hundred rows). */
export const CONSULT_CANDIDATE_LIMIT = 150;

// --- reads -------------------------------------------------------------------

/**
 * Load a live session or throw.
 *
 * @throws NotFoundError when absent or archived.
 */
export async function requireCocreateSession(ctx: CoreContext, id: string): Promise<CocreateSession> {
  const [row] = await ctx.db.select().from(cocreateSessions).where(eq(cocreateSessions.id, id)).limit(1);
  if (!row) throw new NotFoundError(`Co-creator session ${id} not found.`);
  return row;
}

/**
 * List sessions, newest activity first, each with its version count and
 * latest generated image (thumbnail source).
 */
export async function listCocreateSessions(ctx: CoreContext, opts: { includeArchived?: boolean } = {}) {
  const rows = await ctx.db
    .select()
    .from(cocreateSessions)
    .where(opts.includeArchived ? undefined : isNull(cocreateSessions.archivedAt))
    .orderBy(desc(cocreateSessions.updatedAt))
    .limit(200);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const [versionCounts, answerCounts, latest] = await Promise.all([
    ctx.db
      .select({ sessionId: cocreatePromptVersions.sessionId, n: max(cocreatePromptVersions.version) })
      .from(cocreatePromptVersions)
      .where(inArray(cocreatePromptVersions.sessionId, ids))
      .groupBy(cocreatePromptVersions.sessionId),
    ctx.db
      .select({ sessionId: cocreateAnswers.sessionId, n: sql<number>`count(*)` })
      .from(cocreateAnswers)
      .where(and(inArray(cocreateAnswers.sessionId, ids), eq(cocreateAnswers.status, "answered")))
      .groupBy(cocreateAnswers.sessionId),
    ctx.db
      .select({ sessionId: cocreateGenerations.sessionId, deliveryUrl: libraryImages.deliveryUrl, createdAt: cocreateGenerations.createdAt })
      .from(cocreateGenerations)
      .innerJoin(libraryImages, eq(libraryImages.id, cocreateGenerations.libraryImageId))
      .where(inArray(cocreateGenerations.sessionId, ids))
      .orderBy(desc(cocreateGenerations.createdAt)),
  ]);

  const vMap = new Map(versionCounts.map((v) => [v.sessionId, v.n ?? 0]));
  const aMap = new Map(answerCounts.map((a) => [a.sessionId, Number(a.n)]));
  const tMap = new Map<string, string>();
  const gMap = new Map<string, number>();
  for (const g of latest) {
    if (!tMap.has(g.sessionId)) tMap.set(g.sessionId, g.deliveryUrl);
    gMap.set(g.sessionId, (gMap.get(g.sessionId) ?? 0) + 1);
  }
  return rows.map((r) => ({
    ...r,
    versionCount: vMap.get(r.id) ?? 0,
    answeredCount: aMap.get(r.id) ?? 0,
    imageCount: gMap.get(r.id) ?? 0,
    latestImageUrl: tMap.get(r.id) ?? null,
  }));
}

/** Everything the workspace renders, in one read. */
export async function getCocreateSession(ctx: CoreContext, id: string) {
  const session = await requireCocreateSession(ctx, id);
  const [versions, answers, generations, consultations, reference] = await Promise.all([
    ctx.db
      .select()
      .from(cocreatePromptVersions)
      .where(eq(cocreatePromptVersions.sessionId, id))
      .orderBy(cocreatePromptVersions.version),
    ctx.db.select().from(cocreateAnswers).where(eq(cocreateAnswers.sessionId, id)).orderBy(cocreateAnswers.createdAt),
    ctx.db
      .select({
        id: cocreateGenerations.id,
        promptVersionId: cocreateGenerations.promptVersionId,
        batchId: cocreateGenerations.batchId,
        model: cocreateGenerations.model,
        aspectRatio: cocreateGenerations.aspectRatio,
        error: cocreateGenerations.error,
        createdAt: cocreateGenerations.createdAt,
        libraryImageId: cocreateGenerations.libraryImageId,
        deliveryUrl: libraryImages.deliveryUrl,
      })
      .from(cocreateGenerations)
      .leftJoin(libraryImages, eq(libraryImages.id, cocreateGenerations.libraryImageId))
      .where(eq(cocreateGenerations.sessionId, id))
      .orderBy(desc(cocreateGenerations.createdAt)),
    listConsultations(ctx, id),
    session.referenceImageId
      ? ctx.db
          .select({ id: libraryImages.id, deliveryUrl: libraryImages.deliveryUrl })
          .from(libraryImages)
          .where(eq(libraryImages.id, session.referenceImageId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { session, versions, answers, generations, consultations, referenceImage: reference[0] ?? null };
}

// --- writes ------------------------------------------------------------------

export interface CreateCocreateInput {
  prompt: string;
  title?: string | null;
  goal?: string | null;
  proactiveness?: Proactiveness;
  aspectRatio?: string;
  imageModel?: string | null;
  referenceImageId?: string | null;
  folderId?: string | null;
  /** Answers from other sessions to bring in as already-answered questions. */
  importAnswerIds?: string[];
  /** The consultation that suggested this session, if any — re-pointed at it. */
  consultationId?: string | null;
}

/**
 * Create a session and its version 1 atomically.
 *
 * @throws ValidationError for an empty prompt; NotFoundError for a bad reference image.
 */
export async function createCocreateSession(ctx: CoreContext, input: CreateCocreateInput) {
  const prompt = input.prompt?.trim();
  if (!prompt) throw new ValidationError("A prompt is required to start a co-creator session.");
  if (input.referenceImageId) await requireImage(ctx, input.referenceImageId);

  const sessionId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date();
  await ctx.db.batch([
    ctx.db.insert(cocreateSessions).values({
      id: sessionId,
      title: input.title?.trim() || prompt.slice(0, 60),
      goal: input.goal?.trim() || null,
      currentPrompt: prompt,
      currentVersionId: versionId,
      proactiveness: input.proactiveness ?? "medium",
      aspectRatio: input.aspectRatio ?? "16:9",
      imageModel: input.imageModel ?? null,
      referenceImageId: input.referenceImageId ?? null,
      folderId: input.folderId ?? null,
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert(cocreatePromptVersions).values({
      id: versionId,
      sessionId,
      version: 1,
      promptText: prompt,
      source: "initial",
      createdAt: now,
    }),
  ]);
  if (input.consultationId) {
    await ctx.db
      .update(cocreateConsultations)
      .set({ sessionId })
      .where(and(eq(cocreateConsultations.id, input.consultationId), isNull(cocreateConsultations.sessionId)));
  }
  if (input.importAnswerIds?.length) await importAnswers(ctx, sessionId, input.importAnswerIds);
  return requireCocreateSession(ctx, sessionId);
}

export interface UpdateCocreateInput {
  title?: string;
  goal?: string | null;
  proactiveness?: Proactiveness;
  aspectRatio?: string;
  imageModel?: string | null;
  referenceImageId?: string | null;
  folderId?: string | null;
  archived?: boolean;
}

/** Patch settings. Only keys present in `input` change. */
export async function updateCocreateSession(ctx: CoreContext, id: string, input: UpdateCocreateInput) {
  await requireCocreateSession(ctx, id);
  if (input.referenceImageId) await requireImage(ctx, input.referenceImageId);
  const { archived, ...rest } = input;
  const patch: Partial<CocreateSession> = { ...rest, updatedAt: new Date() };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  await ctx.db.update(cocreateSessions).set(patch).where(eq(cocreateSessions.id, id));
  return requireCocreateSession(ctx, id);
}

export interface AddVersionInput {
  promptText: string;
  source: Exclude<PromptVersionSource, "initial">;
  parentVersionId?: string | null;
  /** Answers this version absorbed (must be answered rows of this session). */
  answerIds?: string[];
  graphUpdates?: GraphUpdate[];
  note?: string | null;
}

/**
 * Append a prompt version and make it current. `version` is allocated by
 * optimistic retry on the unique (session, version) index — a collision is
 * retried, never swallowed, so the log has no gaps or duplicates.
 *
 * @throws ValidationError for empty text or an answer that is not this session's.
 */
export async function addPromptVersion(ctx: CoreContext, sessionId: string, input: AddVersionInput): Promise<CocreatePromptVersion> {
  const session = await requireCocreateSession(ctx, sessionId);
  const promptText = input.promptText?.trim();
  if (!promptText) throw new ValidationError("A prompt version cannot be empty.");
  const answerIds = [...new Set(input.answerIds ?? [])];
  if (answerIds.length) {
    const owned = await ctx.db
      .select({ id: cocreateAnswers.id })
      .from(cocreateAnswers)
      .where(and(inArray(cocreateAnswers.id, answerIds), eq(cocreateAnswers.sessionId, sessionId), eq(cocreateAnswers.status, "answered")));
    if (owned.length !== answerIds.length) throw new ValidationError("Every applied answer must be an answered question of this session.");
  }
  if (input.parentVersionId) {
    const [p] = await ctx.db
      .select({ id: cocreatePromptVersions.id })
      .from(cocreatePromptVersions)
      .where(and(eq(cocreatePromptVersions.id, input.parentVersionId), eq(cocreatePromptVersions.sessionId, sessionId)));
    if (!p) throw new ValidationError("parentVersionId must be a version of this session.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const [{ n }] = await ctx.db
      .select({ n: max(cocreatePromptVersions.version) })
      .from(cocreatePromptVersions)
      .where(eq(cocreatePromptVersions.sessionId, sessionId));
    const id = crypto.randomUUID();
    const now = new Date();
    try {
      await ctx.db.batch([
        ctx.db.insert(cocreatePromptVersions).values({
          id,
          sessionId,
          version: (n ?? 0) + 1,
          parentVersionId: input.parentVersionId ?? session.currentVersionId,
          promptText,
          source: input.source,
          graphUpdates: input.graphUpdates?.length ? input.graphUpdates : null,
          note: input.note ?? null,
          createdAt: now,
        }),
        ctx.db
          .update(cocreateSessions)
          .set({ currentPrompt: promptText, currentVersionId: id, updatedAt: now })
          .where(eq(cocreateSessions.id, sessionId)),
        ...(answerIds.length
          ? [ctx.db.update(cocreateAnswers).set({ appliedInVersionId: id }).where(inArray(cocreateAnswers.id, answerIds))]
          : []),
      ]);
      const [row] = await ctx.db.select().from(cocreatePromptVersions).where(eq(cocreatePromptVersions.id, id));
      return row;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new ValidationError("Could not allocate a version number after 5 attempts; retry.");
}

async function referenceBase64(ctx: CoreContext, session: CocreateSession): Promise<string | undefined> {
  if (!session.referenceImageId) return undefined;
  const img = await requireImage(ctx, session.referenceImageId);
  return fetchImageBase64(ctx.env, img.cfImageId);
}

/**
 * Map the current prompt to a belief graph and ask 3 clarifying questions.
 * Questions still pending from a previous round are marked skipped (superseded),
 * and never re-asked.
 *
 * @param opts.graph false to only ask new questions ("more questions").
 */
export async function analyzeCocreateSession(
  ctx: CoreContext,
  sessionId: string,
  opts: { graph?: boolean; waitUntil?: WaitUntil } = {},
) {
  const session = await requireCocreateSession(ctx, sessionId);
  const prompt = session.currentPrompt;
  const proactiveness = session.proactiveness as Proactiveness;
  const imageBase64 = await referenceBase64(ctx, session);
  const asked = await ctx.db
    .select({ question: cocreateAnswers.question })
    .from(cocreateAnswers)
    .where(eq(cocreateAnswers.sessionId, sessionId));

  const base = { sessionId, imageBase64, waitUntil: opts.waitUntil };
  const [graphOut, qOut] = await Promise.all([
    opts.graph === false
      ? Promise.resolve(null)
      : callModel(ctx, { ...base, op: "graph", instruction: beliefGraphInstruction(prompt, proactiveness, Boolean(imageBase64)) }),
    callModel(ctx, {
      ...base,
      op: "questions",
      instruction: clarificationInstruction(prompt, asked.map((a) => a.question), proactiveness, Boolean(imageBase64)),
    }),
  ]);
  const graph = graphOut ? (parseOrThrow(beliefGraphSchema, graphOut.structured, "belief graph") as BeliefGraph) : null;
  const questions = parseOrThrow(clarificationsSchema, qOut.structured, "clarifying questions").slice(0, 3);

  const now = new Date();
  const newRows = questions.map((q) => ({
    id: crypto.randomUUID(),
    sessionId,
    askedInVersionId: session.currentVersionId,
    question: q.question,
    options: q.options,
    status: "pending" as const,
    createdAt: now,
  }));
  await ctx.db.batch([
    ctx.db
      .update(cocreateAnswers)
      .set({ status: "skipped" })
      .where(and(eq(cocreateAnswers.sessionId, sessionId), eq(cocreateAnswers.status, "pending"))),
    ctx.db.insert(cocreateAnswers).values(newRows),
    ctx.db
      .update(cocreateSessions)
      .set(graph ? { beliefGraph: graph, updatedAt: now } : { updatedAt: now })
      .where(eq(cocreateSessions.id, sessionId)),
  ]);
  return { graph: graph ?? session.beliefGraph, questions: newRows };
}

/**
 * Record answers. `answer: null` (or blank) marks the question skipped.
 *
 * @throws ValidationError when an id is not a question of this session.
 */
export async function answerQuestions(
  ctx: CoreContext,
  sessionId: string,
  answers: Array<{ id: string; answer: string | null }>,
): Promise<CocreateAnswer[]> {
  await requireCocreateSession(ctx, sessionId);
  const ids = answers.map((a) => a.id);
  if (!ids.length) return [];
  const owned = await ctx.db
    .select({ id: cocreateAnswers.id })
    .from(cocreateAnswers)
    .where(and(inArray(cocreateAnswers.id, ids), eq(cocreateAnswers.sessionId, sessionId)));
  if (owned.length !== new Set(ids).size) throw new ValidationError("Every answer must belong to this session.");
  const now = new Date();
  await ctx.db.batch(
    answers.map((a) => {
      const text = a.answer?.trim();
      return ctx.db
        .update(cocreateAnswers)
        .set(text ? { answer: text, status: "answered", answeredAt: now } : { answer: null, status: "skipped", answeredAt: now })
        .where(eq(cocreateAnswers.id, a.id));
    }) as never,
  );
  await ctx.db.update(cocreateSessions).set({ updatedAt: now }).where(eq(cocreateSessions.id, sessionId));
  return ctx.db.select().from(cocreateAnswers).where(inArray(cocreateAnswers.id, ids));
}

/**
 * Ask the model to fold answers + graph edits into the current prompt. Returns
 * the proposal only; nothing is written until the user accepts it (as a version).
 *
 * @throws ValidationError when there is nothing to apply or an answer is not usable.
 */
export async function proposeRefinement(
  ctx: CoreContext,
  sessionId: string,
  input: { answerIds?: string[]; graphUpdates?: GraphUpdate[]; waitUntil?: WaitUntil },
) {
  const session = await requireCocreateSession(ctx, sessionId);
  const answerIds = input.answerIds ?? [];
  const updates = input.graphUpdates ?? [];
  if (!answerIds.length && !updates.length) throw new ValidationError("Answer a question or edit the graph before refining.");
  const rows = answerIds.length
    ? await ctx.db
        .select()
        .from(cocreateAnswers)
        .where(and(inArray(cocreateAnswers.id, answerIds), eq(cocreateAnswers.sessionId, sessionId), eq(cocreateAnswers.status, "answered")))
    : [];
  if (rows.length !== new Set(answerIds).size) throw new ValidationError("Only answered questions of this session can be applied.");

  const out = await callModel(ctx, {
    sessionId,
    op: "refine",
    instruction: refineInstruction(
      session.currentPrompt,
      rows.map((r) => ({ question: r.question, answer: r.answer ?? "" })),
      updates,
      session.proactiveness as Proactiveness,
    ),
    waitUntil: input.waitUntil,
  });
  const promptText = cleanRefinedPrompt(out.text || session.currentPrompt);
  return { promptText, basePrompt: session.currentPrompt, baseVersionId: session.currentVersionId, answerIds, graphUpdates: updates };
}

/**
 * Generate images from a prompt version (default: current) and log each slot.
 * Images land in the library (Cloudflare Images) and in the session's folder.
 */
export async function generateForCocreateSession(
  ctx: CoreContext,
  sessionId: string,
  input: { versionId?: string; count?: number; waitUntil?: WaitUntil } = {},
) {
  const session = await requireCocreateSession(ctx, sessionId);
  const versionId = input.versionId ?? session.currentVersionId;
  const [version] = versionId
    ? await ctx.db
        .select()
        .from(cocreatePromptVersions)
        .where(and(eq(cocreatePromptVersions.id, versionId), eq(cocreatePromptVersions.sessionId, sessionId)))
    : [];
  if (!version) throw new ValidationError("Pick a prompt version of this session to generate from.");

  const batchId = crypto.randomUUID();
  const result = await generateImages(ctx, {
    prompt: version.promptText,
    count: input.count ?? 4,
    requestedModel: session.imageModel ?? undefined,
    aspectRatio: session.aspectRatio,
    referenceImageId: session.referenceImageId,
    folderId: session.folderId,
    surface: "ui",
    waitUntil: input.waitUntil,
  });
  const now = new Date();
  const rows = [
    ...result.images.map((i) => ({ libraryImageId: i.image.id, error: null as string | null })),
    ...result.failures.map((f) => ({ libraryImageId: null, error: f.error })),
  ].map((r) => ({
    id: crypto.randomUUID(),
    sessionId,
    promptVersionId: version.id,
    batchId,
    model: result.model,
    aspectRatio: session.aspectRatio,
    createdAt: now,
    ...r,
  }));
  await ctx.db.batch([
    ctx.db.insert(cocreateGenerations).values(rows),
    ctx.db.update(cocreateSessions).set({ updatedAt: now }).where(eq(cocreateSessions.id, sessionId)),
  ]);
  return { batchId, model: result.model, generated: result.images.length, failed: result.failures.length };
}

/**
 * Copy answers from other sessions into this one as answered, not-yet-applied
 * questions. The originals are untouched; lineage is `source_answer_id`. An
 * answer already imported into this session is not imported twice.
 */
export async function importAnswers(ctx: CoreContext, sessionId: string, answerIds: string[]): Promise<CocreateAnswer[]> {
  await requireCocreateSession(ctx, sessionId);
  const ids = [...new Set(answerIds)];
  if (!ids.length) return [];
  const sources = await ctx.db
    .select()
    .from(cocreateAnswers)
    .where(and(inArray(cocreateAnswers.id, ids), eq(cocreateAnswers.status, "answered"), ne(cocreateAnswers.sessionId, sessionId)));
  if (sources.length !== ids.length) throw new ValidationError("Only answered questions from other sessions can be imported.");
  const already = await ctx.db
    .select({ src: cocreateAnswers.sourceAnswerId })
    .from(cocreateAnswers)
    .where(and(eq(cocreateAnswers.sessionId, sessionId), inArray(cocreateAnswers.sourceAnswerId, ids)));
  const skip = new Set(already.map((a) => a.src));
  const now = new Date();
  const fresh = sources
    .filter((s) => !skip.has(s.id))
    .map((s) => ({
      id: crypto.randomUUID(),
      sessionId,
      question: s.question,
      options: s.options,
      answer: s.answer,
      status: "answered" as const,
      sourceAnswerId: s.id,
      createdAt: now,
      answeredAt: now,
    }));
  if (fresh.length) await ctx.db.insert(cocreateAnswers).values(fresh);
  return fresh as CocreateAnswer[];
}

/**
 * Drop consultant citations that are not in the candidate set (a model can
 * invent ids) and duplicates, so every stored match is a resolvable FK.
 */
export function keepKnownMatches<M extends { answerId: string }>(matches: M[], candidateIds: string[]): M[] {
  const known = new Set(candidateIds);
  const seen = new Set<string>();
  return matches.filter((m) => {
    if (!known.has(m.answerId) || seen.has(m.answerId)) return false;
    seen.add(m.answerId);
    return true;
  });
}

/** Consultations for a session (or all unattached ones when sessionId is null), with cited answers. */
export async function listConsultations(ctx: CoreContext, sessionId: string | null) {
  const cons = await ctx.db
    .select()
    .from(cocreateConsultations)
    .where(sessionId ? eq(cocreateConsultations.sessionId, sessionId) : isNull(cocreateConsultations.sessionId))
    .orderBy(desc(cocreateConsultations.createdAt))
    .limit(20);
  if (!cons.length) return [];
  const matches = await ctx.db
    .select({
      consultationId: cocreateConsultationMatches.consultationId,
      answerId: cocreateConsultationMatches.answerId,
      reason: cocreateConsultationMatches.reason,
      howToUse: cocreateConsultationMatches.howToUse,
      question: cocreateAnswers.question,
      answer: cocreateAnswers.answer,
      fromSessionId: cocreateAnswers.sessionId,
      fromSessionTitle: cocreateSessions.title,
    })
    .from(cocreateConsultationMatches)
    .innerJoin(cocreateAnswers, eq(cocreateAnswers.id, cocreateConsultationMatches.answerId))
    .innerJoin(cocreateSessions, eq(cocreateSessions.id, cocreateAnswers.sessionId))
    .where(inArray(cocreateConsultationMatches.consultationId, cons.map((c) => c.id)));
  return cons.map((c) => ({ ...c, matches: matches.filter((m) => m.consultationId === c.id) }));
}

/**
 * The consultant: read answered questions from other sessions, cite the ones
 * relevant to `goal`, and advise. Cited ids are filtered to the candidate set
 * before writing, so a hallucinated id can never become a dangling match.
 *
 * @throws ValidationError for an empty goal.
 */
export async function consult(ctx: CoreContext, input: { goal: string; sessionId?: string | null; waitUntil?: WaitUntil }) {
  const goal = input.goal?.trim();
  if (!goal) throw new ValidationError("Describe what you are trying to make.");
  const session = input.sessionId ? await requireCocreateSession(ctx, input.sessionId) : null;

  const candidates = await ctx.db
    .select({
      id: cocreateAnswers.id,
      question: cocreateAnswers.question,
      answer: cocreateAnswers.answer,
      sessionTitle: cocreateSessions.title,
    })
    .from(cocreateAnswers)
    .innerJoin(cocreateSessions, eq(cocreateSessions.id, cocreateAnswers.sessionId))
    .where(
      and(
        eq(cocreateAnswers.status, "answered"),
        isNull(cocreateSessions.archivedAt),
        // Imported copies repeat their source; cite the original only.
        isNull(cocreateAnswers.sourceAnswerId),
        session ? ne(cocreateAnswers.sessionId, session.id) : undefined,
      ),
    )
    .orderBy(desc(cocreateAnswers.answeredAt))
    .limit(CONSULT_CANDIDATE_LIMIT);

  const out = await callModel(ctx, {
    sessionId: session?.id ?? "consultant",
    op: "consult",
    instruction: consultInstruction(
      goal,
      session?.currentPrompt ?? null,
      candidates.map((c) => ({ ...c, answer: c.answer ?? "" })),
    ),
    waitUntil: input.waitUntil,
  });
  const parsed = parseOrThrow(consultSchema, out.structured, "consultant");
  const matches = keepKnownMatches(parsed.matches, candidates.map((c) => c.id));

  const consultationId = crypto.randomUUID();
  await ctx.db.batch([
    ctx.db.insert(cocreateConsultations).values({
      id: consultationId,
      sessionId: session?.id ?? null,
      goal,
      advice: parsed.advice,
      model: out.model,
      candidateCount: candidates.length,
    }),
    ...(matches.length
      ? [ctx.db.insert(cocreateConsultationMatches).values(matches.map((m) => ({ consultationId, ...m })))]
      : []),
  ]);
  if (session && !session.goal) {
    await ctx.db.update(cocreateSessions).set({ goal }).where(eq(cocreateSessions.id, session.id));
  }
  const [row] = (await listConsultations(ctx, session?.id ?? null)).filter((c) => c.id === consultationId);
  return row;
}
