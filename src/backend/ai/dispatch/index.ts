/**
 * @fileoverview The shared dispatch wrapper — the ONLY path from core to a
 * provider. Centralising it here makes guardian usage emission structurally
 * unbypassable and records `served_via` so gateway coverage is auditable.
 *
 * `DEFAULT_SERVED_VIA` is "direct" until the empirical AI Gateway Interactions
 * test confirms the gateway proxies Gemini's Interactions API. When it's routed
 * through the gateway, `cf-aig-metadata` is attached in the adapter (built from
 * `request.gateway.metadata`) and every direct call still emits guardian usage.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";

import { NotImplementedError } from "@/backend/core/errors";
import { googleImageAdapter } from "../providers/google-image";
import { openaiImageAdapter } from "../providers/openai-image";
import type { ModelEntry } from "../registry/types";
import { emitUsage, GUARDIAN_WORKER_NAME } from "./guardian";
import type { Capability, ProviderAdapter, ProviderRequest, ProviderResult } from "./types";

export * from "./types";
export * from "./guardian";

/** Until the Interactions proxy test passes, calls go direct (and emit usage). */
export const DEFAULT_SERVED_VIA: "gateway" | "direct" = "direct";
export const AI_GATEWAY_ID = "default-gateway";

const ADAPTERS: Record<ModelEntry["provider"], ProviderAdapter | undefined> = {
  google: googleImageAdapter,
  openai: openaiImageAdapter,
  "workers-ai": undefined,
};

export function getAdapter(provider: ModelEntry["provider"]): ProviderAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new NotImplementedError(`No provider adapter registered for '${provider}'.`);
  return a;
}

export interface DispatchInput {
  env: Env;
  db: DrizzleD1Database;
  capability: Capability;
  model: ModelEntry;
  request: ProviderRequest;
  meta: { sessionUuid: string; revisionId: string; surface: "ui" | "api" | "mcp" };
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface DispatchOutput extends ProviderResult {
  servedVia: "gateway" | "direct";
  servedModel: string;
}

/**
 * Run a provider call and emit guardian usage. The single choke point — no
 * provider path exists that skips usage emission.
 */
export async function dispatch(input: DispatchInput): Promise<DispatchOutput> {
  const adapter = getAdapter(input.model.provider);
  const isUnderstand = input.capability === "understand" || input.capability === "segment";
  const fn = isUnderstand ? adapter.understand : adapter.generate;
  if (!fn) {
    throw new NotImplementedError(
      `Adapter for '${input.model.provider}' does not support capability '${input.capability}'.`,
    );
  }

  const result = await fn.call(adapter, input.env, input.request);

  // Emit usage AFTER a successful call — non-blocking, buffered on failure,
  // thinking tokens separate, cost auto-priced by guardian.
  await emitUsage(
    input.env,
    input.db,
    {
      worker: GUARDIAN_WORKER_NAME,
      provider: input.model.provider,
      model: input.model.id,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      tokensThinking: result.tokensThinking,
      requests: 1,
      gateway: DEFAULT_SERVED_VIA === "gateway" ? AI_GATEWAY_ID : undefined,
      operationId: input.meta.revisionId,
      taskDescription: `${input.capability}:${input.model.id}`,
    },
    input.waitUntil,
  );

  return { ...result, servedVia: DEFAULT_SERVED_VIA, servedModel: input.model.id };
}
