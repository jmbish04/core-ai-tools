/**
 * @fileoverview Session creation. A session and its synthetic root/seed revision
 * are written in ONE atomic `db.batch()` — D1 has no interactive transactions
 * over the binding, so `batch()` is the atomic unit. The seed node's id is
 * generated client-side up front, which lets us set `sessions.root_revision_id`
 * in the same insert (no read-back, no second write).
 *
 * The seed node is NOT an edit: it anchors the tree and renders as the original
 * image. See the seed spec in `revisions/seed.ts`.
 */

import { eq } from "drizzle-orm";

import { revisions, sessions } from "@/backend/db/schema";
import type { Session } from "@/backend/db/schema";
import type { CoreContext } from "../context";
import { EventType } from "../events";
import { seedRevisionValues } from "../revisions/seed";
import { requireImage } from "../library/images";

export type CreatedVia = "ui" | "api" | "mcp";
export type ApprovalPolicy = "auto" | "masked_only" | "always";

export interface CreateSessionInput {
  /** The library image this session edits. Must exist and be live. */
  originLibraryImageId: string;
  title?: string | null;
  approvalPolicy?: ApprovalPolicy;
  createdVia?: CreatedVia;
}

export interface CreateSessionResult {
  session: Session;
  /** The synthetic seed revision id (== session.root_revision_id). */
  seedRevisionId: string;
}

/**
 * Create a session from an existing library image, atomically seeding its tree.
 *
 * @throws NotFoundError if the origin image does not exist / is soft-deleted.
 */
export async function createSession(
  ctx: CoreContext,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  await requireImage(ctx, input.originLibraryImageId);

  const sessionUuid = crypto.randomUUID();
  const seedRevisionId = crypto.randomUUID();
  const createdVia = input.createdVia ?? "ui";

  const sessionRow = {
    sessionUuid,
    title: input.title ?? null,
    originLibraryImageId: input.originLibraryImageId,
    status: "active" as const,
    approvalPolicy: input.approvalPolicy ?? "masked_only",
    rootRevisionId: seedRevisionId,
    createdVia,
  };

  const seedRow = seedRevisionValues({
    id: seedRevisionId,
    sessionUuid,
    originImageId: input.originLibraryImageId,
    createdVia,
  });

  // Atomic: session first (so the seed's session_uuid FK is satisfied), then the
  // seed revision. Its output_image_id references the (already-existing) origin
  // image, so both FKs hold inside the batch.
  await ctx.db.batch([
    ctx.db.insert(sessions).values(sessionRow),
    ctx.db.insert(revisions).values(seedRow),
  ]);

  // Publish after the write commits — this is what surfaces the new session live
  // on any other connected surface.
  await ctx.events.appendEvent(sessionUuid, {
    type: EventType.SessionCreated,
    revisionId: seedRevisionId,
    payload: { sessionUuid, seedRevisionId, originLibraryImageId: input.originLibraryImageId },
  });

  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionUuid, sessionUuid))
    .limit(1);
  return { session, seedRevisionId };
}
