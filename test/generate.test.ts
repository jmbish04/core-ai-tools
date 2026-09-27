/**
 * Prompt expansion (nanobanana-derived presets/variations), provider error
 * classification (drives model fallback), and the text/image-to-image
 * capability requirements.
 */

import { describe, expect, it } from "vitest";

import { classifyProviderError, expandPrompts, generateImages } from "@/backend/core";
import { pickFallbackModel, requireModel, modelSatisfies } from "@/backend/ai/registry";
import { CapabilityError, ValidationError } from "@/backend/core";
import { ctx } from "./helpers";

describe("expandPrompts", () => {
  it("returns the bare prompt by default", () => {
    expect(expandPrompts({ prompt: "fox" })).toEqual(["fox"]);
  });

  it("crosses styles with variations and clamps to count", () => {
    const all = expandPrompts({ prompt: "fox", styles: ["watercolor", "sketch"], variations: ["lighting"] });
    expect(all).toEqual([
      "fox, watercolor style, dramatic lighting",
      "fox, watercolor style, soft lighting",
      "fox, sketch style, dramatic lighting",
      "fox, sketch style, soft lighting",
    ]);
    expect(expandPrompts({ prompt: "fox", styles: ["watercolor", "sketch"], variations: ["lighting"], count: 3 })).toHaveLength(3);
  });

  it("always yields exactly count prompts, cycling a short expansion", () => {
    expect(expandPrompts({ prompt: "fox", count: 3 })).toEqual(["fox", "fox", "fox"]);
    expect(expandPrompts({ prompt: "fox", styles: ["a", "b"], count: 5 })).toHaveLength(5);
  });

  it("rejects out-of-range counts", () => {
    expect(() => expandPrompts({ prompt: "fox", count: 0 })).toThrow("count must be");
    expect(() => expandPrompts({ prompt: "fox", count: 9 })).toThrow("count must be");
  });

  it("applies icon / pattern / diagram presets", () => {
    const [icon] = expandPrompts({ prompt: "coffee cup", preset: "icon" });
    expect(icon).toContain("modern style app-icon, rounded corners");
    const [pattern] = expandPrompts({ prompt: "triangles", preset: "pattern", density: "dense" });
    expect(pattern).toContain("dense density");
    expect(pattern).toContain("tileable");
    const [diagram] = expandPrompts({ prompt: "auth flow", preset: "diagram", type: "sequence" });
    expect(diagram).toContain("sequence diagram");
  });

  it("story preset yields numbered frames (default 4) with continuity after frame 1", () => {
    const frames = expandPrompts({ prompt: "seed grows", preset: "story", type: "process" });
    expect(frames).toHaveLength(4);
    expect(frames[0]).toContain("step 1 of 4, procedural step");
    expect(frames[0]).not.toContain("previous frame");
    expect(frames[3]).toContain("previous frame");
  });
});

describe("classifyProviderError", () => {
  it("marks rate limits and 5xx retryable (enables model fallback)", () => {
    expect(classifyProviderError("X", Object.assign(new Error("slow down"), { status: 429 })).retryable).toBe(true);
    expect(classifyProviderError("X", Object.assign(new Error("boom"), { status: 503 })).retryable).toBe(true);
    expect(classifyProviderError("X", new Error("fetch failed")).retryable).toBe(true);
  });

  it("keeps auth, policy, and malformed requests non-retryable with actionable text", () => {
    const auth = classifyProviderError("X", Object.assign(new Error("nope"), { status: 403 }));
    expect(auth.retryable).toBe(false);
    expect(auth.message).toMatch(/authentication/);
    const policy = classifyProviderError("X", Object.assign(new Error("blocked by safety filters"), { status: 400 }));
    expect(policy.retryable).toBe(false);
    expect(policy.message).toMatch(/content policy/);
    expect(classifyProviderError("X", Object.assign(new Error("bad"), { status: 400 })).message).toMatch(/malformed/);
  });
});

describe("text/image-to-image requirements", () => {
  it("edit fallback never lands on an understanding-only model", () => {
    expect(modelSatisfies(requireModel("gemini-3.6-flash"), { image_to_image: true })).toBe(false);
    for (const m of ["gemini-3.1-flash-image", "gemini-3-pro-image"]) {
      const fb = pickFallbackModel(m, { image_to_image: true });
      expect(fb?.capabilities.image_to_image).toBe(true);
    }
  });

  it("generateImages validates before any provider call", async () => {
    const c = ctx();
    await expect(generateImages(c, { prompt: "  " })).rejects.toThrow(ValidationError);
    await expect(generateImages(c, { prompt: "fox", count: 20 })).rejects.toThrow(ValidationError);
    await expect(generateImages(c, { prompt: "fox", requestedModel: "gemini-3.6-flash" })).rejects.toThrow(CapabilityError);
  });
});
