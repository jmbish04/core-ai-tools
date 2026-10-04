/**
 * @fileoverview AI SDK model factory — ROUTED THROUGH CORE-GUARDIAN.
 *
 * `AIChatAgent`'s loop (`streamText`/`generateText` from the `ai` package) needs
 * a real AI SDK `LanguageModel`. This returns one pointed at guardian's
 * OpenAI-compatible `/v1/chat/completions`, over the `GUARDIAN_HTTP` service
 * binding — the same wiring `ai/agent/folder-agent.ts` uses.
 *
 * ## Why this no longer touches `env.AI`
 *
 * It used to be `createWorkersAI({ binding: env.AI })`. There is no `ai` binding
 * any more, and there must not be one: `env.AI.run` is account-implicit, always
 * lands on the paid account, and cannot be metered per-account — which is
 * exactly the hole an unattended job bills the card through. Guardian is the
 * only door, so budget checks and the breaker cannot be bypassed.
 *
 * ## It THROWS rather than falling back
 *
 * With no gateway token this raises instead of calling a provider directly. A
 * fallback would work, cost money, and escape metering — the failure mode worth
 * preventing is the silent one, not the loud one.
 *
 * ## Model ids are guardian ROUTING ALIASES, not pinned model ids
 *
 * Guardian picks the model. Callers ask for an intent (`auto`, `best`,
 * `budget`, `cheapest`); they do not name `@cf/...` ids, which only meant
 * anything to the Workers AI binding that is gone.
 *
 * @see https://developers.cloudflare.com/agents/api-reference/chat-agents/
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import { asChatModelId, DEFAULT_CHAT_MODEL_ID } from "@/backend/ai/models/chat-models";
import { getAiGatewayToken } from "@/backend/utils/secrets";

/** Guardian's OpenAI-compatible base. Resolved over the service binding, never DNS. */
const GUARDIAN_BASE_URL = "https://core-guardian/v1";

/**
 * Resolve the AI SDK `LanguageModel` the chat agents stream through.
 *
 * Resolution order (first match wins):
 *   1. An explicit `modelId`, but only if it is a known guardian alias
 *      (validated by `asChatModelId`). Untrusted values — a per-thread
 *      `chat_threads.model`, say — are filtered, so a bad value never reaches
 *      guardian.
 *   2. The `MODEL_CHAT` Worker var.
 *   3. The built-in default alias.
 *
 * Async because the gateway token comes from the Secrets Store, which is
 * deliberately uncached so a rotation takes effect without a redeploy.
 *
 * @param env - Worker bindings; needs `GUARDIAN_HTTP` and the gateway token.
 * @param modelId - Optional alias from the model picker.
 * @returns An AI SDK `LanguageModel` for `streamText`/`generateText`.
 * @throws Error when the gateway token is unresolvable — never falls back to a
 *   direct provider call, which would bypass budget and breaker checks.
 *
 * @example
 * const result = streamText({ model: await getChatModel(this.env), messages });
 */
export async function getChatModel(env: Env, modelId?: string | null): Promise<LanguageModel> {
  const token = await getAiGatewayToken(env);
  if (!token) {
    throw new Error(
      "getChatModel: AI_GATEWAY_TOKEN unresolved, so the call cannot be routed through " +
        "core-guardian. Refusing to fall back to a direct provider call, which would bypass " +
        "budget and breaker checks.",
    );
  }

  const guardian = createOpenAICompatible({
    name: "core-guardian",
    apiKey: token,
    baseURL: GUARDIAN_BASE_URL,
    // Internal hop: the service binding, never the public hostname. A Worker
    // fetching its own account's public host is error 1042.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      env.GUARDIAN_HTTP.fetch(new Request(String(input), init as RequestInit))) as typeof fetch,
  });

  const resolved = asChatModelId(modelId) ?? env.MODEL_CHAT ?? DEFAULT_CHAT_MODEL_ID;
  return guardian.chatModel(resolved);
}
