/**
 * @fileoverview The §4.2 MCP return-payload contract. Image-producing MCP tools
 * return a COMPACT JSON payload — never inlined image bytes by default (that
 * floods the client's context across a session with dozens of revisions). An
 * opt-in `include_image` attaches a small preview as a real MCP image block.
 *
 * `image_url` is the direct Cloudflare Images delivery URL (pasteable,
 * hotlinkable). `app_url` deep-links to the exact revision in the frontend;
 * `compare_url` opens it with the diff view on. `approval_url` is present only
 * when awaiting approval; `mask_preview_url` when a mask is used.
 */

import { eq } from "drizzle-orm";

import { masks } from "@/backend/db/schema";
import type { Revision } from "@/backend/db/schema";
import type { CoreContext } from "@/backend/core";
import { listSessionReferences } from "@/backend/core";
import { resolveImageUrls } from "./serialize";

export interface McpEditPayload {
  revision_id: string;
  session_uuid: string;
  status: Revision["status"];
  image_url: string | null;
  thumb_url: string | null;
  app_url: string;
  compare_url: string;
  parent_revision_id: string | null;
  served_model: string | null;
  mask_id: string | null;
  attempt_number: number;
  approval_url?: string;
  mask_preview_url?: string;
  /** Additional reference images fed to this edit (ordered base → object → style). */
  references?: Array<{
    image_id: string;
    role: "base" | "object" | "style" | null;
    image_url: string | null;
    thumb_url: string | null;
  }>;
}

/**
 * Build the compact MCP payload for a revision. `host` is the public host (from
 * the request) used to construct deep links.
 */
export async function buildMcpEditPayload(
  ctx: CoreContext,
  revision: Revision,
  host: string,
): Promise<McpEditPayload> {
  const base = `https://${host}`;
  const appUrl = `${base}/sessions/${revision.sessionUuid}?revision=${revision.id}`;

  const urls = revision.outputImageId
    ? (await resolveImageUrls(ctx, [revision.outputImageId], base)).get(revision.outputImageId)
    : undefined;
  const imageUrl = urls?.imageUrl ?? null;
  const thumbUrl = urls?.thumbUrl ?? null;

  const payload: McpEditPayload = {
    revision_id: revision.id,
    session_uuid: revision.sessionUuid,
    status: revision.status,
    image_url: imageUrl,
    thumb_url: thumbUrl,
    app_url: appUrl,
    compare_url: `${appUrl}&compare=1`,
    parent_revision_id: revision.parentRevisionId,
    served_model: revision.servedModel,
    mask_id: revision.maskId,
    attempt_number: revision.attemptNumber,
  };

  // Reference images used by this edit (ids recorded on the revision; roles from
  // the session pool). Surfaced so the caller can confirm what was fed in.
  const p = revision.editPayload as { reference_image_ids?: unknown } | null;
  const refIds = Array.isArray(p?.reference_image_ids)
    ? (p!.reference_image_ids.filter((x) => typeof x === "string") as string[])
    : [];
  if (refIds.length > 0) {
    const refUrls = await resolveImageUrls(ctx, refIds, base);
    const roleMap = new Map(
      (await listSessionReferences(ctx, revision.sessionUuid)).map((r) => [r.image.id, r.role]),
    );
    payload.references = refIds.map((id) => ({
      image_id: id,
      role: roleMap.get(id) ?? null,
      image_url: refUrls.get(id)?.imageUrl ?? null,
      thumb_url: refUrls.get(id)?.thumbUrl ?? null,
    }));
  }

  if (revision.status === "awaiting_approval") {
    payload.approval_url = `${appUrl}&approve=1`;
  }
  if (revision.maskId) {
    const [mask] = await ctx.db.select().from(masks).where(eq(masks.id, revision.maskId)).limit(1);
    // Composited mask preview is Phase-5 work (Images transform); until then we
    // deep-link the approval card which renders the mask over the source.
    if (mask) payload.mask_preview_url = `${appUrl}&mask=${mask.id}`;
  }

  return payload;
}
