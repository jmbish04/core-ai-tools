/**
 * Wave 2 surfaces: the folder/settings/metadata/asset core landed in Wave 1 with
 * no way to reach it. These tests drive it through the REAL surfaces — the Hono
 * routers (mounted behind the real `errorHandler`, so a CoreError maps to its
 * status) and the MCP dispatcher — rather than calling core again.
 *
 * The load-bearing assertion is the settings one: `null` must reach core as a
 * present-and-null key (clear it → inherit again) while an absent key must not be
 * touched. A `.partial()` schema, or a validator that materialises absent keys as
 * `undefined`, silently breaks BOTH halves of that, and the failure looks like
 * "un-setting doesn't work" / "saving one field wiped the others".
 *
 * `tools/list` is asserted to advertise exactly 3 tools (the code-mode trio): the
 * named tools added here must stay dispatchable WITHOUT growing the advertised
 * surface, which is the whole point of code mode.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { assetsRouter } from "@/backend/api/routes/assets";
import { libraryRouter } from "@/backend/api/routes/library";
import { errorHandler } from "@/backend/api/middleware/error";
import { callToolByName, handleMcp } from "@/backend/mcp/server";
import { backfillPublicIds, createFolder, requireImage, resolveSettings } from "@/backend/core";
import { libraryImages } from "@/backend/db/schema";
import { ctx, seedImage } from "./helpers";

/** The two routers behind the real error handler — no auth middleware attached. */
function api() {
  const app = new OpenAPIHono<{ Bindings: Env }>();
  app.onError(errorHandler as never);
  app.route("/", libraryRouter);
  app.route("/", assetsRouter);
  return app;
}

/** `app.request` with the test env, parsed. Fails loudly on an unexpected status. */
async function call(
  path: string,
  init: RequestInit = {},
  expectStatus = 200,
): Promise<any> {
  const res = await api().request(path, init, env);
  const body = await res.json().catch(() => null);
  expect({ path, status: res.status, body }).toMatchObject({ status: expectStatus });
  return body;
}

/** JSON request init. */
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Call an MCP tool by name and parse its single text block. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const out = await callToolByName(ctx(), name, args, "app.example");
  const text = (out.content[0] as { text?: string }).text ?? "";
  if (out.isError) throw new Error(text);
  return JSON.parse(text);
}

describe("W2.2 — folders over REST", () => {
  it("lists all folders, roots only, and one folder's children", async () => {
    const c = ctx();
    const root = await createFolder(c, { name: "root" });
    const child = await createFolder(c, { name: "child", parentFolderId: root.id });

    const all = await call("/api/library/folders");
    expect(all.folders.length).toBeGreaterThanOrEqual(2);

    const roots = await call("/api/library/folders?parentFolderId=null");
    expect(roots.folders.map((f: any) => f.id)).toContain(root.id);
    expect(roots.folders.map((f: any) => f.id)).not.toContain(child.id);

    const kids = await call(`/api/library/folders?parentFolderId=${root.id}`);
    expect(kids.folders.map((f: any) => f.id)).toEqual([child.id]);
  });

  it("creates nested, renames, and moves a folder to root", async () => {
    const parent = await call("/api/library/folders", json("POST", { name: "parent" }));
    const kid = await call(
      "/api/library/folders",
      json("POST", { name: "kid", parentFolderId: parent.id }),
    );
    expect(kid.parentFolderId).toBe(parent.id);

    const renamed = await call(`/api/library/folders/${kid.id}`, json("PATCH", { name: "kid v2" }));
    expect(renamed.name).toBe("kid v2");

    const moved = await call(
      `/api/library/folders/${kid.id}/move`,
      json("POST", { parentFolderId: null }),
    );
    expect(moved.parentFolderId).toBeNull();
  });

  it("refuses a move that would create a cycle (422, not a corrupted tree)", async () => {
    const a = await call("/api/library/folders", json("POST", { name: "a" }));
    const b = await call("/api/library/folders", json("POST", { name: "b", parentFolderId: a.id }));
    // ValidationError → 422, carrying the core message (not a generic 500).
    const refused = await call(`/api/library/folders/${a.id}/move`, json("POST", { parentFolderId: b.id }), 422);
    expect(refused.code).toBe("validation");
    // The tree is unchanged: a is still a root.
    const still = await call(`/api/library/folders?parentFolderId=null`);
    expect(still.folders.map((f: any) => f.id)).toContain(a.id);
  });
});

describe("W2.2 — folder settings: null clears, absent leaves alone", () => {
  it("resolves with provenance and reports the ancestor path", async () => {
    const c = ctx();
    const root = await createFolder(c, { name: "root" });
    const leaf = await createFolder(c, { name: "leaf", parentFolderId: root.id });

    await call(
      `/api/library/folders/${root.id}/settings`,
      json("PUT", { contextText: "same kitchen", approvalPolicy: "always" }),
    );
    const resolved = await call(`/api/library/folders/${leaf.id}/settings`);
    expect(resolved.contextText).toMatchObject({
      value: "same kitchen",
      fromFolderId: root.id,
      inherited: true,
    });
    expect(resolved.ancestorPath).toEqual([leaf.id, root.id]);
  });

  it("PUT null CLEARS a setting so the folder inherits from its ancestor again", async () => {
    const c = ctx();
    const root = await createFolder(c, { name: "root" });
    const leaf = await createFolder(c, { name: "leaf", parentFolderId: root.id });

    await call(`/api/library/folders/${root.id}/settings`, json("PUT", { useCase: "listing photos" }));
    // Leaf overrides it locally…
    const overridden = await call(
      `/api/library/folders/${leaf.id}/settings`,
      json("PUT", { useCase: "swatches" }),
    );
    expect(overridden.useCase).toMatchObject({ value: "swatches", fromFolderId: leaf.id, inherited: false });

    // …and null takes the override away rather than writing an empty string.
    const cleared = await call(`/api/library/folders/${leaf.id}/settings`, json("PUT", { useCase: null }));
    expect(cleared.useCase).toMatchObject({
      value: "listing photos",
      fromFolderId: root.id,
      inherited: true,
    });
  });

  it("PUT of one setting does not clear the settings it omits", async () => {
    const c = ctx();
    const f = await createFolder(c, { name: "f" });
    await call(
      `/api/library/folders/${f.id}/settings`,
      json("PUT", {
        defaultPrompt: "keep the lighting",
        contextText: "ctx",
        useCase: "uc",
        preferredModels: ["gemini-3-pro-image"],
        approvalPolicy: "masked_only",
      }),
    );
    await call(`/api/library/folders/${f.id}/settings`, json("PUT", { useCase: "uc2" }));

    const after = await resolveSettings(c, f.id);
    expect(after.useCase.value).toBe("uc2");
    expect(after.defaultPrompt.value).toBe("keep the lighting");
    expect(after.contextText.value).toBe("ctx");
    expect(after.preferredModels.value).toEqual(["gemini-3-pro-image"]);
    expect(after.approvalPolicy.value).toBe("masked_only");
  });

  it("clears a list setting and an enum setting too (null, not [] or '')", async () => {
    const c = ctx();
    const f = await createFolder(c, { name: "f" });
    await call(
      `/api/library/folders/${f.id}/settings`,
      json("PUT", { preferredModels: ["a", "b"], approvalPolicy: "always" }),
    );
    const cleared = await call(
      `/api/library/folders/${f.id}/settings`,
      json("PUT", { preferredModels: null, approvalPolicy: null }),
    );
    expect(cleared.preferredModels.value).toBeNull();
    expect(cleared.approvalPolicy.value).toBeNull();
  });
});

describe("W2.2 — image metadata + public id over REST", () => {
  it("PATCHes metadata, clears one field with null, and keeps the rest", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const first = await call(
      `/api/library/images/${img.id}`,
      json("PATCH", { title: "Walnut slab", usageInstructions: "use as the counter", role: "reference" }),
    );
    expect(first).toMatchObject({ title: "Walnut slab", role: "reference" });

    const second = await call(`/api/library/images/${img.id}`, json("PATCH", { usageInstructions: null }));
    expect(second.usageInstructions).toBeNull();
    expect(second.title).toBe("Walnut slab");
    expect(second.role).toBe("reference");
  });

  it("resolves a pasted public id, and 404s (never empty) on a typo", async () => {
    const c = ctx();
    const img = await seedImage(c);
    expect(img.publicId).toBeTruthy();
    const found = await call(`/api/library/images/by-public-id/${img.publicId}`);
    expect(found.id).toBe(img.id);
    await call("/api/library/images/by-public-id/img_nope", {}, 404);
  });

  it("gates the backfill behind auth, and fills only the NULL rows", async () => {
    const c = ctx();
    const img = await seedImage(c);
    // Simulate a legacy row: the column default only fires on INSERT, so a row
    // written before the column existed has NULL and no amount of re-saving fixes it.
    await c.db.update(libraryImages).set({ publicId: null }).where(eq(libraryImages.id, img.id));

    // Admin-gated like POST /api/models/sync: no credential in the test env, so
    // the route must refuse rather than run a whole-table write.
    await call("/api/library/backfill-public-ids", json("POST"), 401);

    // The work itself, and its idempotency (re-running finds nothing to do).
    expect(await backfillPublicIds(c)).toBe(1);
    expect(await backfillPublicIds(c)).toBe(0);
    const filled = await requireImage(c, img.id);
    expect(filled.publicId).toMatch(/^img_/);
  });
});

describe("W2.3 — assets over REST", () => {
  it("creates, reads, renames, archives, restores", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await call("/api/assets", json("POST", { libraryImageId: img.id, name: "Walnut" }));
    expect(asset.libraryImageId).toBe(img.id);

    // Same image twice is a conflict, not a second asset.
    await call("/api/assets", json("POST", { libraryImageId: img.id }), 409);

    expect((await call(`/api/assets/${asset.id}`)).name).toBe("Walnut");
    expect((await call(`/api/assets/${asset.id}`, json("PATCH", { name: "Walnut v2" }))).name).toBe(
      "Walnut v2",
    );

    await call(`/api/assets/${asset.id}/archive`, json("POST"));
    const listed = await call("/api/assets");
    expect(listed.assets.map((a: any) => a.id)).not.toContain(asset.id);
    expect((await call("/api/assets?includeArchived=true")).assets.map((a: any) => a.id)).toContain(
      asset.id,
    );

    await call(`/api/assets/${asset.id}/restore`, json("POST"));
    expect((await call("/api/assets")).assets.map((a: any) => a.id)).toContain(asset.id);
  });

  it("promotes an image (row copied, fresh public id, origin recorded) and lists iterations", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const out = await call(`/api/library/images/${img.id}/promote`, json("POST", { name: "Fixture" }));
    expect(out.asset.promotedFromImageId).toBe(img.id);
    expect(out.libraryImage.id).not.toBe(img.id);
    expect(out.libraryImage.cfImageId).toBe(img.cfImageId);
    expect(out.libraryImage.publicId).not.toBe(img.publicId);

    // The asset's own image is iteration zero of its timeline.
    const iter = await call(`/api/assets/${out.asset.id}/iterations`);
    expect(iter.iterations).toHaveLength(1);
    expect(iter.iterations[0].libraryImageId).toBe(out.libraryImage.id);

    // An unknown asset must 404, never return an empty timeline.
    await call("/api/assets/nope/iterations", {}, 404);
  });
});

describe("W2 — every new route is in the OpenAPI document", () => {
  it("registers the folder/settings/image/asset paths (not just the router)", async () => {
    // A plain `.get()`/`.post()` handler works at runtime but never reaches
    // /openapi.json, which is how this surface silently went undocumented before.
    const doc = api().getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } });
    const paths = doc.paths ?? {};
    const expected: Array<[string, string]> = [
      ["/api/library/folders", "get"],
      ["/api/library/folders", "post"],
      ["/api/library/folders/{id}", "patch"],
      ["/api/library/folders/{id}/move", "post"],
      ["/api/library/folders/{id}/settings", "get"],
      ["/api/library/folders/{id}/settings", "put"],
      ["/api/library/images/{id}", "patch"],
      ["/api/library/images/by-public-id/{publicId}", "get"],
      ["/api/library/backfill-public-ids", "post"],
      ["/api/library/images/{id}/promote", "post"],
      ["/api/assets", "get"],
      ["/api/assets", "post"],
      ["/api/assets/{id}", "get"],
      ["/api/assets/{id}", "patch"],
      ["/api/assets/{id}/archive", "post"],
      ["/api/assets/{id}/restore", "post"],
      ["/api/assets/{id}/iterations", "get"],
    ];
    for (const [path, method] of expected) {
      expect((paths as Record<string, Record<string, unknown>>)[path]?.[method], `${method} ${path}`).toBeTruthy();
    }
  });
});

describe("MCP — new named tools stay callable and unadvertised", () => {
  it("tools/list advertises exactly the 3 code-mode tools", async () => {
    const res = await handleMcp(
      new Request("https://app.example/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["execute", "get_schema", "search"]);
    expect(body.result.tools).toHaveLength(3);
  });

  it("every W2 tool is dispatchable by name and findable via search", async () => {
    const added = [
      "list_folders",
      "create_folder",
      "move_folder",
      "get_folder_settings",
      "set_folder_settings",
      "update_image_metadata",
      "get_image_by_public_id",
      "create_asset",
      "promote_image_to_asset",
      "list_assets",
      "list_asset_iterations",
      "update_asset",
      "archive_asset",
    ];
    const found = (await tool("search")).tools.map((t: any) => t.name);
    for (const name of added) expect(found).toContain(name);
  });

  it("drives the folder + settings + asset flow through MCP", async () => {
    const c = ctx();
    const root = await tool("create_folder", { name: "mcp root" });
    const leaf = await tool("create_folder", { name: "mcp leaf", parentFolderId: root.id });
    expect((await tool("list_folders", { parentFolderId: root.id })).map((f: any) => f.id)).toEqual([
      leaf.id,
    ]);

    await tool("set_folder_settings", { folderId: root.id, contextText: "one kitchen" });
    const inherited = await tool("get_folder_settings", { folderId: leaf.id });
    expect(inherited.contextText).toMatchObject({ value: "one kitchen", inherited: true });

    // null clears a local override through MCP too.
    await tool("set_folder_settings", { folderId: leaf.id, contextText: "local" });
    const cleared = await tool("set_folder_settings", { folderId: leaf.id, contextText: null });
    expect(cleared.contextText).toMatchObject({ value: "one kitchen", fromFolderId: root.id });

    await tool("move_folder", { folderId: leaf.id, parentFolderId: null });
    expect((await tool("get_folder_settings", { folderId: leaf.id })).contextText.value).toBeNull();

    const img = await seedImage(c);
    const meta = await tool("update_image_metadata", { libraryImageId: img.id, title: "Slab" });
    expect(meta).toMatchObject({ title: "Slab", public_id: img.publicId });
    expect(await tool("get_image_by_public_id", { publicId: img.publicId! })).toMatchObject({
      id: img.id,
      public_id: img.publicId,
    });

    const asset = await tool("create_asset", { libraryImageId: img.id, name: "Slab" });
    expect((await tool("list_assets")).assets.map((a: any) => a.id)).toContain(asset.id);
    expect((await tool("update_asset", { assetId: asset.id, name: "Slab v2" })).name).toBe("Slab v2");
    expect((await tool("list_asset_iterations", { assetId: asset.id })).iterations).toHaveLength(1);
    expect((await tool("archive_asset", { assetId: asset.id })).archivedAt).toBeTruthy();
    expect((await tool("list_assets")).assets.map((a: any) => a.id)).not.toContain(asset.id);

    const promoted = await tool("promote_image_to_asset", { imageId: img.id, name: "Slab copy" });
    expect(promoted.asset.promotedFromImageId).toBe(img.id);
  });
});
