/**
 * @fileoverview OpenAI image adapter — DISABLED.
 *
 * core-guardian is the ONLY AI source for core-ai-tools (Justin, 2026-10-14,
 * `docs/decisions/2026-10-14-guardian-breaker-blocks-cocreate.md`). This adapter
 * used to call OpenAI's Images API through Cloudflare AI Gateway, which bypasses
 * guardian, and guardian has no surface for `images.edit` (multipart) — its router
 * JSON-encodes every body and hardcodes the provider path.
 *
 * So every call fails with a clear, non-retryable error rather than going around
 * guardian. The catalog entries stay (history, revision provenance); a model
 * resolved to OpenAI simply cannot run until guardian routes OpenAI images.
 * Re-enable by routing through `env.GUARDIAN.run(...)`, never by restoring the
 * direct client.
 */

import { ProviderError } from "@/backend/core/errors";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../dispatch/types";

export const OPENAI_DISABLED_MESSAGE =
  "OpenAI image models are disabled: core-ai-tools uses core-guardian as its only AI source, and guardian cannot route OpenAI image calls yet. Pick a Gemini image model (e.g. set the task default to gemini-3.1-flash-image).";

export const openaiImageAdapter: ProviderAdapter = {
  provider: "openai",

  async generate(_env: Env, req: ProviderRequest): Promise<ProviderResult> {
    // retryable=true on purpose: `executeRevision` then falls back to the first
    // catalog model that satisfies the same requirement (a Gemini image model,
    // routed through guardian), and the revision records requested vs served
    // model. An edit whose default is still OpenAI keeps working that way.
    throw new ProviderError(`${OPENAI_DISABLED_MESSAGE} (requested: ${req.model.id})`, undefined, true);
  },
};
