/**
 * core-guardian is the ONLY AI source for core-ai-tools (Justin, 2026-10-14).
 * These pin the image adapters to that rule: no direct-SDK fallback on a missing
 * binding, an unreachable guardian or a 422 "not priceable"; OpenAI refuses in a
 * way that hands the call to model fallback instead of going around guardian.
 */

import { describe, expect, it } from "vitest";

import { googleImageAdapter } from "@/backend/ai/providers/google-image";
import { openaiImageAdapter } from "@/backend/ai/providers/openai-image";
import { requireModel } from "@/backend/ai/registry";
import { ConfigError, ProviderError } from "@/backend/core";

const req = (id: string) => ({ model: requireModel(id), prompt: "a red apple", resolution: "512px" as const });
const envWith = (run?: (b: unknown) => Promise<unknown>) => ({ GUARDIAN: run ? { run } : undefined }) as unknown as Env;

describe("Gemini adapter: guardian only", () => {
  it("routes through guardian and returns the image", async () => {
    let sent: any;
    const env = envWith(async (b) => {
      sent = b;
      return { status: 200, body: { status: 200, tokens_in: 5, body: { id: "int-1", output_image: { data: btoa("png") } } } };
    });
    const out = await googleImageAdapter.generate(env, req("gemini-3.1-flash-image"));
    expect(new TextDecoder().decode(out.outputImageBytes!)).toBe("png");
    expect(out.servedVia).toBe("guardian");
    expect(sent).toMatchObject({ project: "core-ai-tools", provider: "google", model: "gemini-3.1-flash-image", mode: "gateway" });
  });

  it("throws without the GUARDIAN binding instead of calling Gemini directly", async () => {
    const err = await googleImageAdapter.generate(envWith(), req("gemini-3.1-flash-image")).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(String(err?.message)).toMatch(/GUARDIAN binding is not available/);
    // Not retryable: a model fallback cannot fix a missing binding.
    expect(err?.retryable).toBeFalsy();
  });

  it("surfaces a 422 'not priceable' instead of falling back", async () => {
    const env = envWith(async () => ({ status: 422, body: { error: 'Model "gemini-3.1-flash-image" is not priceable in the catalog' } }));
    await expect(googleImageAdapter.generate(env, req("gemini-3.1-flash-image"))).rejects.toThrow(/422/);
  });

  it("surfaces an unreachable guardian instead of falling back", async () => {
    const env = envWith(async () => {
      throw new Error("fetch failed");
    });
    await expect(googleImageAdapter.generate(env, req("gemini-3.1-flash-image"))).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("OpenAI adapter: disabled", () => {
  it("refuses every call and marks it retryable so model fallback takes over", async () => {
    const err = await openaiImageAdapter.generate({} as Env, req("gpt-image-2.5-flare")).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(true);
    expect(String(err.message)).toMatch(/core-guardian/);
  });
});
