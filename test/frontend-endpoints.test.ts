/**
 * The paths the frontend asks for must be paths the Worker answers.
 *
 * This exists because of a bug that shipped: `FolderOrganiser` fetched
 * `/api/library` while the route is `/api/library/images`, and the read sat in a
 * `Promise.allSettled` whose rejection branch set `[]`. So every folder in the
 * workspace displayed "0 images" — no error, no empty-state distinction, and a
 * test that hit `/api/library/images` directly would have passed, because the
 * client was never asked what path it used.
 *
 * The assertions therefore go through the SAME constants the islands import
 * (`@/lib/endpoints`). A path that drifts on either side fails here.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { agentRouter } from "@/backend/api/routes/agent";
import { assetsRouter } from "@/backend/api/routes/assets";
import { libraryRouter } from "@/backend/api/routes/library";
import { errorHandler } from "@/backend/api/middleware/error";
import { createFolder, moveImage } from "@/backend/core";
import {
  AGENT_TURN_PATH,
  ASSETS_PATH,
  LIBRARY_FOLDERS_PATH,
  LIBRARY_IMAGES_PATH,
  assetPlacePath,
  folderSettingsPath,
} from "@/lib/endpoints";
import { ctx, seedImage } from "./helpers";

/** The routers the organiser and wizard talk to, behind the real error handler. */
function api() {
  const app = new OpenAPIHono<{ Bindings: Env }>();
  app.onError(errorHandler as never);
  app.route("/", libraryRouter);
  app.route("/", assetsRouter);
  app.route("/", agentRouter);
  return app;
}

/** Hit `/api/<path>` exactly as `apiGet`/`apiSend` build it. */
async function get(path: string, query = ""): Promise<Response> {
  return api().request(`/api/${path}${query}`, {}, env);
}

describe("frontend endpoint contract", () => {
  it("answers the folder tree at the path the organiser asks for", async () => {
    const res = await get(LIBRARY_FOLDERS_PATH);
    expect({ path: LIBRARY_FOLDERS_PATH, status: res.status }).toEqual({
      path: LIBRARY_FOLDERS_PATH,
      status: 200,
    });
    expect(await res.json()).toHaveProperty("folders");
  });

  it("answers a folder's images at the path the organiser asks for", async () => {
    const c = ctx();
    const folder = await createFolder(c, { name: "kitchen" });
    const image = await seedImage(c);
    await moveImage(c, { imageId: image.id, folderId: folder.id });

    const res = await get(LIBRARY_IMAGES_PATH, `?folderId=${folder.id}`);
    expect({ path: LIBRARY_IMAGES_PATH, status: res.status }).toEqual({
      path: LIBRARY_IMAGES_PATH,
      status: 200,
    });
    // The bug's signature was an empty list where there was in fact an image, so
    // the count is the assertion, not just the status.
    const body = (await res.json()) as { images: unknown[] };
    expect(body.images).toHaveLength(1);
  });

  it("answers resolved folder settings at the path the organiser asks for", async () => {
    const folder = await createFolder(ctx(), { name: "with settings" });
    const path = folderSettingsPath(folder.id);
    const res = await get(path);
    expect({ path, status: res.status }).toEqual({ path, status: 200 });
    expect(await res.json()).toHaveProperty("defaultPrompt");
  });

  it("answers the asset list at the path the picker asks for", async () => {
    const res = await get(ASSETS_PATH, "?limit=200");
    expect({ path: ASSETS_PATH, status: res.status }).toEqual({ path: ASSETS_PATH, status: 200 });
    expect(await res.json()).toHaveProperty("assets");
  });

  it("routes asset placement and the agent turn to real handlers, not 404s", async () => {
    // Both are POSTs with side effects, so the assertion is only that the route
    // EXISTS: a 404 means the path is wrong, anything else means it was matched
    // and the handler (or its validator) took over.
    for (const path of [assetPlacePath("asset_missing"), AGENT_TURN_PATH]) {
      const res = await api().request(
        `/api/${path}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        env,
      );
      expect({ path, status: res.status }).not.toEqual({ path, status: 404 });
    }
  });
});
