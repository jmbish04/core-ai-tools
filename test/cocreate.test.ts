/**
 * Co-creator: the clause diff, the instruction builders, and the D1 service
 * layer (version log, questionnaire, cross-session import, consultant filter)
 * against the real migrated schema. Model calls are not exercised here — the
 * provider is not reachable from the test pool.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  addPromptVersion,
  answerQuestions,
  cleanRefinedPrompt,
  clarificationInstruction,
  createCocreateSession,
  getCocreateSession,
  importAnswers,
  keepKnownMatches,
  listCocreateSessions,
  refineInstruction,
  updateCocreateSession,
  ValidationError,
} from "@/backend/core";
import { cocreateAnswers, cocreateGenerations } from "@/backend/db/schema";
import { diffPrompts, splitClauses, toLineDiff } from "../src/shared/prompt-diff";
import { ctx, seedImage } from "./helpers";

describe("prompt diff", () => {
  it("splits at clause punctuation and keeps it", () => {
    expect(splitClauses("A cat,  asleep. Warm light!")).toEqual(["A cat,", "asleep.", "Warm light!"]);
  });

  it("marks kept, removed and added clauses in order", () => {
    const ops = diffPrompts("A cat on a sofa, cold light.", "A cat on a sofa, warm golden light, a rug.");
    expect(ops).toEqual([
      { type: "same", text: "A cat on a sofa," },
      { type: "del", text: "cold light." },
      { type: "add", text: "warm golden light," },
      { type: "add", text: "a rug." },
    ]);
    expect(toLineDiff(ops)).toEqual({
      code: "A cat on a sofa,\ncold light.\nwarm golden light,\na rug.",
      added: [3, 4],
      removed: [2],
    });
  });

  it("reports no change for identical prompts (case-insensitive)", () => {
    expect(diffPrompts("A Cat.", "a cat.").every((o) => o.type === "same")).toBe(true);
  });

  it("does not count a clause whose only change is trailing punctuation", () => {
    const ops = diffPrompts("A cat, warm lights.", "A cat, warm lights, no text.");
    expect(ops).toEqual([
      { type: "same", text: "A cat," },
      { type: "same", text: "warm lights," },
      { type: "add", text: "no text." },
    ]);
  });

  it("handles an empty side", () => {
    expect(diffPrompts("", "New.")).toEqual([{ type: "add", text: "New." }]);
    expect(diffPrompts("Old.", "")).toEqual([{ type: "del", text: "Old." }]);
  });
});

describe("instruction builders", () => {
  it("never re-asks a question already asked", () => {
    const text = clarificationInstruction("a cat", ["What breed is the cat?"], "medium", false);
    expect(text).toContain('Do NOT ask any of these again:\n- "What breed is the cat?"');
  });

  it("puts every answer and graph edit into the refine instruction", () => {
    const text = refineInstruction(
      "a cat",
      [{ question: "Breed?", answer: "Tabby" }],
      [{ type: "attribute", entity: "Sofa", attribute: "existence", value: "false" }],
      "low",
    );
    expect(text).toContain('Answer to "Breed?": "Tabby"');
    expect(text).toContain('REMOVE "Sofa"');
    expect(text).toContain("STRICT MODE");
  });

  it("strips the labels models add to a refined prompt", () => {
    expect(cleanRefinedPrompt('**Refined Prompt:** "A tabby cat."')).toBe("A tabby cat.");
    expect(cleanRefinedPrompt("Updated prompt: A cat")).toBe("A cat");
    expect(cleanRefinedPrompt("A prompt about prompts.")).toBe("A prompt about prompts.");
  });
});

describe("consultant citation filter", () => {
  it("drops invented ids and duplicates", () => {
    const kept = keepKnownMatches(
      [{ answerId: "a" }, { answerId: "ghost" }, { answerId: "a" }, { answerId: "b" }],
      ["a", "b", "c"],
    );
    expect(kept.map((m) => m.answerId)).toEqual(["a", "b"]);
  });
});

/** Insert pending questions the way analyze does, without a model. */
async function ask(c: ReturnType<typeof ctx>, sessionId: string, questions: string[]) {
  const s = await getCocreateSession(c, sessionId);
  const rows = questions.map((q) => ({
    id: crypto.randomUUID(),
    sessionId,
    askedInVersionId: s.session.currentVersionId,
    question: q,
    options: ["x", "y"],
  }));
  await c.db.insert(cocreateAnswers).values(rows);
  return rows.map((r) => r.id);
}

describe("co-creator sessions", () => {
  it("creates the session and its version 1 together", async () => {
    const c = ctx();
    const s = await createCocreateSession(c, { prompt: "  a cat hosting a party  " });
    const full = await getCocreateSession(c, s.id);
    expect(full.session.currentPrompt).toBe("a cat hosting a party");
    expect(full.versions).toHaveLength(1);
    expect(full.versions[0]).toMatchObject({ version: 1, source: "initial", promptText: "a cat hosting a party" });
    expect(full.session.currentVersionId).toBe(full.versions[0].id);
  });

  it("rejects an empty prompt and a missing reference image", async () => {
    const c = ctx();
    await expect(createCocreateSession(c, { prompt: "   " })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCocreateSession(c, { prompt: "x", referenceImageId: "nope" })).rejects.toThrow();
  });

  it("appends versions monotonically and stamps exactly the applied answers", async () => {
    const c = ctx();
    const s = await createCocreateSession(c, { prompt: "a cat" });
    const [q1, q2] = await ask(c, s.id, ["Breed?", "Mood?"]);
    await answerQuestions(c, s.id, [
      { id: q1, answer: "Tabby" },
      { id: q2, answer: null },
    ]);
    const v2 = await addPromptVersion(c, s.id, { promptText: "a tabby cat", source: "refine", answerIds: [q1] });
    expect(v2.version).toBe(2);
    const v1Id = (await getCocreateSession(c, s.id)).versions[0].id;
    expect(v2.parentVersionId).toBe(v1Id);

    const full = await getCocreateSession(c, s.id);
    const byId = new Map(full.answers.map((a) => [a.id, a]));
    expect(byId.get(q1)).toMatchObject({ status: "answered", answer: "Tabby", appliedInVersionId: v2.id });
    // The skipped one is recorded as skipped and NOT stamped onto the version.
    expect(byId.get(q2)).toMatchObject({ status: "skipped", answer: null, appliedInVersionId: null });
    expect(full.session).toMatchObject({ currentPrompt: "a tabby cat", currentVersionId: v2.id });

    // A skipped answer cannot be applied.
    await expect(addPromptVersion(c, s.id, { promptText: "y", source: "refine", answerIds: [q2] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("allocates distinct version numbers under concurrency", async () => {
    const c = ctx();
    const s = await createCocreateSession(c, { prompt: "a cat" });
    const vs = await Promise.all(
      ["b", "c", "d", "e"].map((t) => addPromptVersion(c, s.id, { promptText: t, source: "manual" })),
    );
    expect(vs.map((v) => v.version).sort()).toEqual([2, 3, 4, 5]);
  });

  it("refuses an answer id from another session", async () => {
    const c = ctx();
    const a = await createCocreateSession(c, { prompt: "a" });
    const b = await createCocreateSession(c, { prompt: "b" });
    const [qa] = await ask(c, a.id, ["Q?"]);
    await expect(answerQuestions(c, b.id, [{ id: qa, answer: "x" }])).rejects.toBeInstanceOf(ValidationError);
  });

  it("imports answers across sessions with lineage, once, without touching the source", async () => {
    const c = ctx();
    const a = await createCocreateSession(c, { prompt: "a kitchen" });
    const b = await createCocreateSession(c, { prompt: "a bathroom" });
    const [qa, qPending] = await ask(c, a.id, ["Cabinet finish?", "Unanswered?"]);
    await answerQuestions(c, a.id, [{ id: qa, answer: "Matte oak" }]);

    const imported = await importAnswers(c, b.id, [qa]);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ sessionId: b.id, sourceAnswerId: qa, answer: "Matte oak", status: "answered" });
    expect(await importAnswers(c, b.id, [qa])).toHaveLength(0);

    const source = (await getCocreateSession(c, a.id)).answers.find((x) => x.id === qa);
    expect(source).toMatchObject({ sessionId: a.id, appliedInVersionId: null });
    // Pending answers and same-session answers are not importable.
    await expect(importAnswers(c, b.id, [qPending])).rejects.toBeInstanceOf(ValidationError);
    await expect(importAnswers(c, a.id, [qa])).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists live sessions with counts and the latest image; archive hides them", async () => {
    const c = ctx();
    const s = await createCocreateSession(c, { prompt: "a fox" });
    const img = await seedImage(c, "generated");
    const full = await getCocreateSession(c, s.id);
    await c.db.insert(cocreateGenerations).values([
      { sessionId: s.id, promptVersionId: full.versions[0].id, libraryImageId: img.id, batchId: "b1", model: "m" },
      { sessionId: s.id, promptVersionId: full.versions[0].id, libraryImageId: null, batchId: "b1", model: "m", error: "refused" },
    ]);
    const [row] = await listCocreateSessions(c);
    expect(row).toMatchObject({ id: s.id, versionCount: 1, imageCount: 1, latestImageUrl: img.deliveryUrl });

    const detail = await getCocreateSession(c, s.id);
    expect(detail.generations.map((g) => g.deliveryUrl ?? g.error).sort()).toEqual([img.deliveryUrl, "refused"].sort());

    await updateCocreateSession(c, s.id, { archived: true });
    expect(await listCocreateSessions(c)).toHaveLength(0);
    expect(await listCocreateSessions(c, { includeArchived: true })).toHaveLength(1);
  });

  it("keeps the D1 binding the suite expects", () => {
    expect(env.DB).toBeDefined();
  });
});
