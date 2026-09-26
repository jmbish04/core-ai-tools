/**
 * Wave 1 schema behaviour: deep folder nesting, the cycle refusal, settings
 * inheritance WITH provenance, the short copyable image id, and asset lineage
 * surviving the two ways the revision tree branches (fork and retry).
 *
 * These assert behaviour, not fixtures: every inheritance case sets a value at one
 * depth and asserts it resolves from a DIFFERENT depth, and the lineage tests run
 * the real `markSucceeded` path rather than inserting lineage rows by hand.
 */

import { describe, expect, it } from "vitest";

import {
  archiveAsset,
  assetIdsForImage,
  createAsset,
  createFolder,
  createSession,
  findAssetForImage,
  findImageByPublicId,
  forkRevision,
  listAssetIterations,
  listAssets,
  markSucceeded,
  moveFolder,
  promoteImageToAsset,
  registerImage,
  resolveSettings,
  retryRevision,
  submitEdit,
  updateFolderSettings,
  updateImageMetadata,
} from "@/backend/core";
import type { CoreContext } from "@/backend/core";
import { ctx, seedImage } from "./helpers";

/** Build a folder chain `depth` levels deep; returns ids root-first. */
async function chain(c: CoreContext, depth: number): Promise<string[]> {
  const ids: string[] = [];
  let parent: string | null = null;
  for (let i = 0; i < depth; i++) {
    const f = await createFolder(c, { name: `level-${i}`, parentFolderId: parent });
    ids.push(f.id);
    parent = f.id;
  }
  return ids;
}

/** A succeeded edit off `parentRevisionId`, producing a fresh output image. */
async function succeededEdit(
  c: CoreContext,
  input: { sessionUuid: string; parentRevisionId: string; promptText: string },
) {
  const rev = await submitEdit(c, {
    sessionUuid: input.sessionUuid,
    parentRevisionId: input.parentRevisionId,
    promptText: input.promptText,
    editPayload: { instruction: input.promptText },
    requestedModel: "gemini-3-pro-image",
  });
  const out = await seedImage(c, "generated");
  await markSucceeded(c, {
    revisionId: rev.id,
    outputImageId: out.id,
    servedModel: "gemini-3-pro-image",
    provider: "google",
  });
  return { revisionId: rev.id, outputImageId: out.id };
}

describe("nested folders", () => {
  it("nests to arbitrary depth and reports the full ancestor path", async () => {
    const c = ctx();
    const ids = await chain(c, 8);
    const resolved = await resolveSettings(c, ids[7]);
    // Leaf first, root last — 8 levels, no per-level query.
    expect(resolved.ancestorPath).toEqual([...ids].reverse());
  });

  it("refuses a move that would put a folder inside its own subtree", async () => {
    const c = ctx();
    const ids = await chain(c, 5);
    await expect(moveFolder(c, { folderId: ids[0], newParentId: ids[4] })).rejects.toThrow(/cycle/i);
    // ...and the tree is unchanged, so resolution still terminates.
    const resolved = await resolveSettings(c, ids[4]);
    expect(resolved.ancestorPath).toHaveLength(5);
  });

  it("refuses moving a folder into itself", async () => {
    const c = ctx();
    const [only] = await chain(c, 1);
    await expect(moveFolder(c, { folderId: only, newParentId: only })).rejects.toThrow(/itself/i);
  });
});

describe("inheritable folder settings", () => {
  it("resolves to the NEAREST ancestor that sets a value, with provenance", async () => {
    const c = ctx();
    const [l0, l1, l2, l3] = await chain(c, 4);
    await updateFolderSettings(c, l0, { defaultPrompt: "root prompt", useCase: "root use case" });
    await updateFolderSettings(c, l2, { defaultPrompt: "mid prompt" });

    const leaf = await resolveSettings(c, l3);
    // Nearest wins, and the nearest here is l2 — not l0, not the leaf.
    expect(leaf.defaultPrompt).toEqual({ value: "mid prompt", fromFolderId: l2, inherited: true });
    // A setting only the root defines still resolves, from the root.
    expect(leaf.useCase).toEqual({ value: "root use case", fromFolderId: l0, inherited: true });
    // Unused level in between must not appear as a source.
    expect(leaf.defaultPrompt.fromFolderId).not.toBe(l1);
  });

  it("reports a locally-set value as NOT inherited", async () => {
    const c = ctx();
    const [l0, l1] = await chain(c, 2);
    await updateFolderSettings(c, l0, { contextText: "root context" });
    await updateFolderSettings(c, l1, { contextText: "local context" });
    const resolved = await resolveSettings(c, l1);
    expect(resolved.contextText).toEqual({
      value: "local context",
      fromFolderId: l1,
      inherited: false,
    });
  });

  it("returns null with no provenance when nothing in the chain sets a value", async () => {
    const c = ctx();
    const ids = await chain(c, 3);
    const resolved = await resolveSettings(c, ids[2]);
    expect(resolved.approvalPolicy).toEqual({ value: null, fromFolderId: null, inherited: false });
    expect(resolved.preferredModels.value).toBeNull();
  });

  it("clearing a local value re-enables inheritance", async () => {
    const c = ctx();
    const [l0, l1] = await chain(c, 2);
    await updateFolderSettings(c, l0, { approvalPolicy: "always" });
    await updateFolderSettings(c, l1, { approvalPolicy: "auto" });
    expect((await resolveSettings(c, l1)).approvalPolicy.value).toBe("auto");

    await updateFolderSettings(c, l1, { approvalPolicy: null });
    const after = await resolveSettings(c, l1);
    expect(after.approvalPolicy).toEqual({ value: "always", fromFolderId: l0, inherited: true });
  });

  it("round-trips the preferred-model list through the recursive read", async () => {
    const c = ctx();
    const [l0, , l2] = await chain(c, 3);
    await updateFolderSettings(c, l0, { preferredModels: ["gemini-3-pro-image", "gpt-image-1"] });
    const resolved = await resolveSettings(c, l2);
    expect(resolved.preferredModels.value).toEqual(["gemini-3-pro-image", "gpt-image-1"]);
    expect(resolved.preferredModels.fromFolderId).toBe(l0);
  });

  it("rejects an unknown folder and an empty patch", async () => {
    const c = ctx();
    const [only] = await chain(c, 1);
    await expect(resolveSettings(c, "nope")).rejects.toThrow(/not found/i);
    await expect(updateFolderSettings(c, only, {})).rejects.toThrow(/no folder settings/i);
  });
});

describe("image metadata + short public id", () => {
  it("mints a unique URL-safe public id for every registered image", async () => {
    const c = ctx();
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const img = await seedImage(c);
      expect(img.publicId).toMatch(/^img_[0-9a-hjkmnp-tv-z]{10}$/);
      ids.add(img.publicId!);
    }
    expect(ids.size).toBe(25);
  });

  it("resolves a pasted public id back to its image, tolerantly", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const found = await findImageByPublicId(c, `  ${img.publicId!.toUpperCase()} `);
    expect(found?.id).toBe(img.id);
    expect(await findImageByPublicId(c, "img_doesnotexist")).toBeNull();
  });

  it("stores title, usage instructions, context and role", async () => {
    const c = ctx();
    const img = await registerImage(c, {
      cfImageId: "cf-meta",
      deliveryUrl: "https://images.example/deliver",
      title: "Walnut slab",
      usageInstructions: "Use the grain only; ignore the lighting.",
      contextText: "Shot in the Oakland warehouse.",
      role: "reference",
    });
    expect(img.title).toBe("Walnut slab");
    expect(img.role).toBe("reference");

    const updated = await updateImageMetadata(c, {
      imageId: img.id,
      role: "inject",
      usageInstructions: "  ",
    });
    expect(updated.role).toBe("inject");
    // Whitespace-only clears rather than storing a blank.
    expect(updated.usageInstructions).toBeNull();
    // Untouched keys survive.
    expect(updated.contextText).toBe("Shot in the Oakland warehouse.");
  });
});

describe("asset library", () => {
  it("wraps a directly-uploaded image and starts its own timeline", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await createAsset(c, { libraryImageId: img.id, name: "Kitchen base" });
    expect(asset.promotedFromImageId).toBeNull();
    expect(asset.libraryImageId).toBe(img.id);

    const timeline = await listAssetIterations(c, asset.id);
    expect(timeline.map((t) => t.libraryImageId)).toEqual([img.id]);
    expect(await findAssetForImage(c, img.id)).not.toBeNull();
  });

  it("refuses a second asset over the same backing image", async () => {
    const c = ctx();
    const img = await seedImage(c);
    await createAsset(c, { libraryImageId: img.id, name: "First" });
    await expect(createAsset(c, { libraryImageId: img.id, name: "Second" })).rejects.toThrow(
      /already asset/i,
    );
  });

  it("promotes an existing image by COPYING the row and keeping the trace back", async () => {
    const c = ctx();
    const folder = await createFolder(c, { name: "Materials" });
    const source = await registerImage(c, {
      cfImageId: "cf-source",
      deliveryUrl: "https://images.example/deliver",
      folderId: folder.id,
      title: "Marble",
    });

    const { asset, libraryImage: copy } = await promoteImageToAsset(c, { imageId: source.id });

    expect(asset.name).toBe("Marble");
    expect(asset.promotedFromImageId).toBe(source.id);
    // Copy, not a pointer: new row identity, new public id, same bytes identity.
    expect(copy.id).not.toBe(source.id);
    expect(copy.publicId).not.toBe(source.publicId);
    expect(copy.cfImageId).toBe(source.cfImageId);
    expect(copy.folderId).toBe(folder.id);
    // The original is NOT the asset's backing image, so it keeps its own identity.
    expect(await findAssetForImage(c, source.id)).toBeNull();
    expect(asset.libraryImageId).toBe(copy.id);
  });

  it("archives rather than deletes, and hides archived assets from the list", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await createAsset(c, { libraryImageId: img.id, name: "Retired" });
    await archiveAsset(c, asset.id);

    expect((await listAssets(c)).map((a) => a.id)).not.toContain(asset.id);
    expect((await listAssets(c, { includeArchived: true })).map((a) => a.id)).toContain(asset.id);
    // Lineage survives the archive — the iterations are still history.
    expect(await listAssetIterations(c, asset.id)).toHaveLength(1);
  });
});

describe("asset lineage", () => {
  it("records each successful edit as an iteration of its ancestor asset", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await createAsset(c, { libraryImageId: img.id, name: "Room" });
    const { session, seedRevisionId } = await createSession(c, {
      title: "Restyle",
      originLibraryImageId: img.id,
    });

    const first = await succeededEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      promptText: "warmer light",
    });

    const timeline = await listAssetIterations(c, asset.id);
    expect(timeline.map((t) => t.libraryImageId)).toEqual([img.id, first.outputImageId]);
    const produced = timeline.find((t) => t.libraryImageId === first.outputImageId)!;
    expect(produced.sessionUuid).toBe(session.sessionUuid);
    expect(produced.revisionId).toBe(first.revisionId);
  });

  it("survives a FORK — a branch off an edited node still belongs to the asset", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await createAsset(c, { libraryImageId: img.id, name: "Room" });
    const { session, seedRevisionId } = await createSession(c, {
      title: "Restyle",
      originLibraryImageId: img.id,
    });

    const first = await succeededEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      promptText: "warmer light",
    });

    // Fork two levels deep off the edited node — the fork's INPUT is `first`'s
    // output, which is where the inherited lineage has to come from.
    const forked = await forkRevision(c, {
      fromRevisionId: first.revisionId,
      promptText: "swap the rug",
      editPayload: { instruction: "swap the rug" },
      requestedModel: "gemini-3-pro-image",
    });
    const forkOut = await seedImage(c, "generated");
    await markSucceeded(c, {
      revisionId: forked.id,
      outputImageId: forkOut.id,
      servedModel: "gemini-3-pro-image",
      provider: "google",
    });
    const deeper = await succeededEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: forked.id,
      promptText: "darker floor",
    });

    const ids = (await listAssetIterations(c, asset.id)).map((t) => t.libraryImageId);
    expect(ids).toContain(forkOut.id);
    expect(ids).toContain(deeper.outputImageId);
    // And the transitive closure means the grandchild resolves to the asset directly.
    expect(await assetIdsForImage(c, deeper.outputImageId)).toEqual([asset.id]);
  });

  it("survives a RETRY — the new attempt's output is its own iteration", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const asset = await createAsset(c, { libraryImageId: img.id, name: "Room" });
    const { session, seedRevisionId } = await createSession(c, {
      title: "Restyle",
      originLibraryImageId: img.id,
    });

    const first = await succeededEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      promptText: "warmer light",
    });
    const retried = await retryRevision(c, { revisionId: first.revisionId });
    const retryOut = await seedImage(c, "generated");
    await markSucceeded(c, {
      revisionId: retried.id,
      outputImageId: retryOut.id,
      servedModel: "gemini-3-pro-image",
      provider: "google",
    });

    expect(retried.attemptNumber).toBeGreaterThan(1);
    const timeline = await listAssetIterations(c, asset.id);
    expect(timeline.map((t) => t.libraryImageId)).toContain(retryOut.id);
    expect(timeline.find((t) => t.libraryImageId === retryOut.id)!.revisionId).toBe(retried.id);
  });

  it("does not invent lineage for an image with no asset ancestry", async () => {
    const c = ctx();
    const img = await seedImage(c);
    const { session, seedRevisionId } = await createSession(c, {
      title: "No asset",
      originLibraryImageId: img.id,
    });
    const edit = await succeededEdit(c, {
      sessionUuid: session.sessionUuid,
      parentRevisionId: seedRevisionId,
      promptText: "warmer light",
    });
    expect(await assetIdsForImage(c, edit.outputImageId)).toEqual([]);
  });
});
