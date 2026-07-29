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
