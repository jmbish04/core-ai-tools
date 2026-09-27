/**
 * W2.7 — folder archive. Drives the REAL surfaces (the Hono router behind the
 * real `errorHandler`, and the MCP dispatcher) plus core directly where the
 * assertion is about persisted state.
 *
 * The load-bearing test is "archiving a parent takes its children with it". The
 * failure it guards against is not a crash: archive the parent, leave the child
 * live, and the child stops being reachable through the tree while still listing
 * as a folder — so it reappears at the ROOT looking like a brand-new top-level
 * folder. That reads as working software and silently moves the user's data, which
 * is why the regression is planted here rather than trusted to review.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { libraryFolders } from "@/backend/db/schema";

import { libraryRouter } from "@/backend/api/routes/library";
import { errorHandler } from "@/backend/api/middleware/error";
import { callToolByName, handleMcp } from "@/backend/mcp/server";
import {
  archiveFolder,
  createFolder,
  listFolders,
  listLibrary,
  moveImage,
  restoreFolder,
} from "@/backend/core";
import { ctx, seedImage } from "./helpers";

function api() {
  const app = new OpenAPIHono<{ Bindings: Env }>();
  app.onError(errorHandler as never);
  app.route("/", libraryRouter);
  return app;
}

async function call(path: string, init: RequestInit = {}, expectStatus = 200): Promise<any> {
  const res = await api().request(path, init, env);
  const body = await res.json().catch(() => null);
  expect({ path, status: res.status, body }).toMatchObject({ status: expectStatus });
  return body;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const out = await callToolByName(ctx(), name, args, "app.example");
  const text = (out.content[0] as { text?: string }).text ?? "";
  if (out.isError) throw new Error(text);
  return JSON.parse(text);
}

const ids = (folders: Array<{ id: string }>) => folders.map((f) => f.id);

describe("W2.7 — archiving a folder never orphans its children", () => {
  it("takes the WHOLE subtree down, so nothing resurfaces at the root", async () => {
    const c = ctx();
    const parent = await createFolder(c, { name: "project" });
    const child = await createFolder(c, { name: "kitchen", parentFolderId: parent.id });
    const grandchild = await createFolder(c, { name: "counters", parentFolderId: child.id });

    await archiveFolder(c, parent.id);

    // THE regression: a live descendant has no live parent to hang from, so a
    // roots-only listing (what the tree renders) shows it as a new top-level
    // folder. Assert on the roots view, not just on the rows, because that is
    // where the user would actually see the orphan.
    const roots = await listFolders(c, { parentFolderId: null });
    expect(ids(roots)).not.toContain(parent.id);
    const live = await listFolders(c);
    expect(ids(live)).not.toContain(child.id);
    expect(ids(live)).not.toContain(grandchild.id);

    // All three carry the SAME archived_at — that shared stamp is what makes
    // restore an exact undo.
    const archived = await listFolders(c, { archived: "only" });
    const stamps = new Set(
      archived
        .filter((f) => [parent.id, child.id, grandchild.id].includes(f.id))
        .map((f) => f.archivedAt?.getTime()),
    );
    expect(archived.length).toBe(3);
    expect(stamps.size).toBe(1);
  });

  it("leaves the images alone — an archive is about the tree, not the content", async () => {
    const c = ctx();
    const folder = await createFolder(c, { name: "swatches" });
    const image = await seedImage(c);
    await moveImage(c, { imageId: image.id, folderId: folder.id });

    await archiveFolder(c, folder.id);

    // Not soft-deleted, not re-parented: revision replay FKs into this row, and a
    // lossy archive would make restore unable to tell a user-deleted image from a
    // cascade-deleted one.
    const inFolder = await listLibrary(c, { folderId: folder.id });
    expect(ids(inFolder)).toEqual([image.id]);
    expect(inFolder[0].deletedAt).toBeNull();
    expect(inFolder[0].folderId).toBe(folder.id);
  });

  it("refuses to create or move a live folder into an archived one", async () => {
    const c = ctx();
    const archived = await createFolder(c, { name: "done" });
    await archiveFolder(c, archived.id);
    const loose = await createFolder(c, { name: "loose" });

    const create = await call("/api/library/folders", json("POST", { name: "x", parentFolderId: archived.id }), 422);
    const move = await call(
      `/api/library/folders/${loose.id}/move`,
      json("POST", { parentFolderId: archived.id }),
      422,
    );
    expect(create.code).toBe("validation");
    expect(move.code).toBe("validation");
  });
});

describe("W2.7 — restore is an exact undo", () => {
  it("brings back the subtree the same archive took down", async () => {
    const c = ctx();
    const parent = await createFolder(c, { name: "project" });
    const child = await createFolder(c, { name: "kitchen", parentFolderId: parent.id });

    await archiveFolder(c, parent.id);
    const restored = await restoreFolder(c, parent.id);

    expect(restored.archivedAt).toBeNull();
    expect(ids(await listFolders(c))).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(await listFolders(c, { archived: "only" })).toEqual([]);
  });

  it("leaves a separately-archived child archived", async () => {
    const c = ctx();
    const parent = await createFolder(c, { name: "project" });
    const child = await createFolder(c, { name: "old phase", parentFolderId: parent.id });

    await archiveFolder(c, child.id); // the user retired this one on purpose…
    // …a day earlier. archived_at has second resolution, so backdate rather than
    // sleep: what matters is that the two archives carry DIFFERENT stamps.
    await c.db
      .update(libraryFolders)
      .set({ archivedAt: new Date(Date.now() - 86_400_000) })
      .where(eq(libraryFolders.id, child.id));
    await archiveFolder(c, parent.id);
    await restoreFolder(c, parent.id);

    const live = ids(await listFolders(c));
    expect(live).toContain(parent.id);
    expect(live).not.toContain(child.id);
  });

  it("refuses to restore into an archived parent instead of re-homing at the root", async () => {
    const c = ctx();
    const parent = await createFolder(c, { name: "project" });
    const child = await createFolder(c, { name: "kitchen", parentFolderId: parent.id });
    await archiveFolder(c, parent.id);

    const refused = await call(`/api/library/folders/${child.id}/restore`, json("POST"), 422);
    expect(refused.code).toBe("validation");
    expect(ids(await listFolders(c))).not.toContain(child.id);
  });

  it("is idempotent on both sides", async () => {
    const c = ctx();
    const folder = await createFolder(c, { name: "f" });
    const first = await archiveFolder(c, folder.id);
    expect((await archiveFolder(c, folder.id)).archivedAt?.getTime()).toBe(first.archivedAt?.getTime());
    await restoreFolder(c, folder.id);
    expect((await restoreFolder(c, folder.id)).archivedAt).toBeNull();
  });
});

describe("W2.7 — surfaces", () => {
  it("hides archived folders by default and returns them when asked (REST)", async () => {
    const folder = await call("/api/library/folders", json("POST", { name: "retire me" }));
    await call(`/api/library/folders/${folder.id}/archive`, json("POST"));

    expect(ids((await call("/api/library/folders")).folders)).not.toContain(folder.id);
    expect(ids((await call("/api/library/folders?archived=only")).folders)).toContain(folder.id);
    expect(ids((await call("/api/library/folders?archived=include")).folders)).toContain(folder.id);

    await call(`/api/library/folders/${folder.id}/restore`, json("POST"));
    expect(ids((await call("/api/library/folders")).folders)).toContain(folder.id);
  });

  it("archive_folder / restore_folder are dispatchable MCP tools", async () => {
    const folder = await tool("create_folder", { name: "mcp retire" });
    const archived = await tool("archive_folder", { folderId: folder.id });
    expect(archived.archivedAt).toBeTruthy();

    expect(ids(await tool("list_folders"))).not.toContain(folder.id);
    expect(ids(await tool("list_folders", { archived: "only" }))).toContain(folder.id);

    expect((await tool("restore_folder", { folderId: folder.id })).archivedAt).toBeNull();
    expect(ids(await tool("list_folders"))).toContain(folder.id);
  });

  it("tools/list STILL advertises exactly the 3 code-mode tools", async () => {
    const res = await handleMcp(
      new Request("https://app.example/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      env,
    );
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["execute", "get_schema", "search"]);
  });
});
