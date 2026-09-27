/**
 * @fileoverview Folder-event notification for the core service layer.
 *
 * WHY THIS LIVES IN CORE, not in the route handlers: folders are mutated from
 * REST, from MCP tools, and (soon) from the agent. Emitting at each surface means
 * three places that drift, and the agent-driven path — the one whose whole point
 * is that the user watches it happen live — is the one most likely to be missed.
 * Core is where every caller already funnels, so emitting here makes the live
 * update structural rather than remembered. Same argument as the dispatch wrapper
 * being the only path to a provider.
 *
 * Emission NEVER fails a mutation. The D1 write is the truth and has already
 * committed by the time we notify; a fan-out failure costs a client a refresh,
 * while a throw here would undo a write the caller was told had succeeded.
 */

import { emitFolderEvent, emitFolderEventBoth } from "@/backend/realtime/folder-events";
import type { FolderEvent } from "@/backend/realtime/folder-events";
import type { CoreContext } from "../context";

/**
 * Publish one folder event, swallowing any failure.
 *
 * @param ctx   Core context (its `env` carries the FOLDER_DO binding; absent in tests).
 * @param event The event to publish. `folderId` is the channel.
 * @example await notifyFolder(ctx, { type: "folder_renamed", folderId, name });
 */
export async function notifyFolder(ctx: CoreContext, event: FolderEvent): Promise<void> {
  if (!ctx.env) return;
  try {
    await emitFolderEvent(ctx.env, event);
  } catch (err) {
    console.error(
      `[folder-events] ${event.type} for ${event.folderId} not delivered:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Publish the same event into two channels — the source and the destination of a
 * move — so both open views update. Nulls (the library root, which has no
 * channel) and duplicates are dropped by the underlying helper.
 *
 * @param make Builds the event for whichever channel it is being sent to.
 */
export async function notifyFolderBoth(
  ctx: CoreContext,
  from: string | null,
  to: string | null,
  make: (folderId: string) => FolderEvent,
): Promise<void> {
  if (!ctx.env) return;
  try {
    await emitFolderEventBoth(ctx.env, from, to, make);
  } catch (err) {
    console.error(
      "[folder-events] paired event not delivered:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
