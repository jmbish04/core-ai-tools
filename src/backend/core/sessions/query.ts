/**
 * @fileoverview Session reads: get, resume (full state + tree), list, and the
 * FK-payoff `list_sessions_for_image` — every session descended from one library
 * image, backed by `idx_sessions_origin_image`.
 */

import { desc, eq, inArray } from "drizzle-orm";

import { libraryImages, sessions } from "@/backend/db/schema";
import type { Session } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { NotFoundError } from "../errors";
import { listSessionRevisions } from "../revisions/query";
import { getSessionTree } from "../revisions/tree";
import type { SessionTree } from "../revisions/tree";

/** Fetch a session or throw NotFound. */
export async function requireSession(ctx: CoreContext, sessionUuid: string): Promise<Session> {
  const [row] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUuid, sessionUuid))
    .limit(1);
  if (!row) throw new NotFoundError(`Session ${sessionUuid} not found.`);
  return row;
}

/** Alias read that returns null instead of throwing, for optional lookups. */
export async function getSession(ctx: CoreContext, sessionUuid: string): Promise<Session | null> {
  const [row] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUuid, sessionUuid))
    .limit(1);
  return row ?? null;
}

export interface ListSessionsInput {
  status?: Session["status"];
  limit?: number;
  offset?: number;
}

/** List sessions, newest activity first. Optional status filter + paging. */
export async function listSessions(
  ctx: CoreContext,
  input?: ListSessionsInput,
): Promise<Session[]> {
  const base = ctx.db.select().from(sessions).$dynamic();
  const q = input?.status ? base.where(eq(sessions.status, input.status)) : base;
  return q
    .orderBy(desc(sessions.lastActivityAt))
    .limit(input?.limit ?? 100)
    .offset(input?.offset ?? 0);
}

/**
 * Every session ever spawned from one library image — the defining FK payoff.
 * Newest first.
 */
export async function listSessionsForImage(
  ctx: CoreContext,
  originLibraryImageId: string,
): Promise<Session[]> {
  return ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.originLibraryImageId, originLibraryImageId))
    .orderBy(desc(sessions.createdAt));
}

export interface ResumedSession {
  session: Session;
  tree: SessionTree;
}

/** Resume a session by uuid: full state + the revision tree. */
export async function resumeSession(ctx: CoreContext, sessionUuid: string): Promise<ResumedSession> {
  const session = await requireSession(ctx, sessionUuid);
  const tree = await getSessionTree(ctx, sessionUuid);
  return { session, tree };
}

/** One revision, flattened for the session-detail frontend (with its output URL). */
export interface SessionViewRevision {
  id: string;
  /** Display name (rev1, rev2.1, "Original"); the uuid `id` stays the real key. */
  revLabel: string | null;
  parentRevisionId: string | null;
  attemptNumber: number;
  editFingerprint: string;
  status: string;
  promptText: string;
  editPayload: unknown;
  requestedModel: string | null;
  servedModel: string | null;
  provider: string | null;
  fallbackReason: string | null;
  inputImageId: string | null;
  outputImageId: string | null;
  outputDeliveryUrl: string | null;
  isPinned: boolean;
  approvalRequired: boolean;
  createdVia: string;
  createdAt: string;
}

export interface SessionView {
  session: {
    sessionUuid: string;
    title: string | null;
    status: string;
    originLibraryImageId: string;
    approvalPolicy: string;
    createdVia: string;
    rootRevisionId: string | null;
  };
  revisions: SessionViewRevision[];
  originImage?: { id: string; deliveryUrl: string; originalFilename: string | null };
}

/**
 * Session detail as a FLAT revision list + resolved image URLs — the shape the
 * session-detail UI (`SessionDetail`/`RevisionTreeCanvas`) consumes. Distinct
 * from `resumeSession` (grouped tree) which MCP `resume_session`/`get_session_tree`
 * still use unchanged.
 */
export async function getSessionView(ctx: CoreContext, sessionUuid: string): Promise<SessionView> {
  const session = await requireSession(ctx, sessionUuid);
  const revs = await listSessionRevisions(ctx, sessionUuid);

  // One lookup for every referenced image (revision outputs + the origin).
  const imgIds = new Set<string>();
  for (const r of revs) if (r.outputImageId) imgIds.add(r.outputImageId);
  if (session.originLibraryImageId) imgIds.add(session.originLibraryImageId);
  const imgs = imgIds.size
    ? await ctx.db.select().from(libraryImages).where(inArray(libraryImages.id, [...imgIds]))
    : [];
  const byId = new Map(imgs.map((i) => [i.id, i]));

  const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(v as number).toISOString());

  const revisions: SessionViewRevision[] = revs.map((r) => ({
    id: r.id,
    revLabel: r.revLabel,
    parentRevisionId: r.parentRevisionId,
    attemptNumber: r.attemptNumber,
    editFingerprint: r.editFingerprint,
    status: r.status,
    promptText: r.promptText,
    editPayload: r.editPayload,
    requestedModel: r.requestedModel,
    servedModel: r.servedModel,
    provider: r.provider,
    fallbackReason: r.fallbackReason,
    inputImageId: r.inputImageId,
    outputImageId: r.outputImageId,
    outputDeliveryUrl: r.outputImageId ? byId.get(r.outputImageId)?.deliveryUrl ?? null : null,
    isPinned: r.isPinned,
    approvalRequired: r.status === "awaiting_approval",
    createdVia: r.createdVia,
    createdAt: toIso(r.createdAt),
  }));

  const origin = session.originLibraryImageId ? byId.get(session.originLibraryImageId) : undefined;

  return {
    session: {
      sessionUuid: session.sessionUuid,
      title: session.title,
      status: session.status,
      originLibraryImageId: session.originLibraryImageId,
      approvalPolicy: session.approvalPolicy,
      createdVia: session.createdVia,
      rootRevisionId: session.rootRevisionId,
    },
    revisions,
    originImage: origin
      ? { id: origin.id, deliveryUrl: origin.deliveryUrl, originalFilename: origin.originalFilename }
      : undefined,
  };
}
