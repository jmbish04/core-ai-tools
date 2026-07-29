/**
 * @fileoverview OpenAI image adapter (fallback provider). RAW HTTP is a
 * deferred-live seam: the current OpenAI image model id (`gpt-image-1` in the
 * registry) MUST be verified against live OpenAI docs before relying on it, and
 * the request/response shape confirmed. Key in `Authorization: Bearer` via
 * utils/secrets. Everything around the call is settled.
 */

import { getOpenAiApiKey } from "@/backend/utils/secrets";
import { NotImplementedError } from "@/backend/core/errors";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../dispatch/types";

export const openaiImageAdapter: ProviderAdapter = {
  provider: "openai",

  async generate(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    const apiKey = await getOpenAiApiKey(env);
    if (!apiKey) {
      throw new NotImplementedError("OpenAI generate: OPENAI_API_KEY unresolved.");
    }
    void req;
    throw new NotImplementedError(
      "OpenAI image request pending doc verification of the current model id + request shape (Authorization: Bearer).",
    );
  },
};
