/**
 * @fileoverview OpenAI image adapter — the official `openai` SDK against the
 * Images API (`images.generate` / `images.edit`). The registry model id decides
 * the model (`gpt-image-2`, …). Text-to-image → `generate`; any input/reference
 * image present → `edit` (source images combined, per the gpt-image contract).
 *
 * AI GATEWAY: OpenAI IS proxyable through Cloudflare AI Gateway (unlike Gemini's
 * Interactions API), so when the account id + gateway id resolve we point the
 * SDK `baseURL` at the gateway and, if a gateway token is set, send
 * `cf-aig-authorization`. If either is missing we fall back to calling OpenAI
 * directly — never a hard failure.
 *
 * USAGE: this adapter returns tokensIn/tokensOut from the response `usage`; the
 * dispatch wrapper (../dispatch/index.ts) is the single choke point that emits
 * them to core-guardian after every call (buffered to usage_outbox on failure).
 * So guardian coverage is structural whether the call went via gateway or direct.
 */

import OpenAI, { toFile } from "openai";
import type { Uploadable } from "openai";

import {
  getAiGatewayToken,
  getCloudflareAccountId,
  getOpenAiApiKey,
} from "@/backend/utils/secrets";
import { classifyProviderError, NotImplementedError, ProviderError } from "@/backend/core/errors";
import type { ProviderAdapter, ProviderRequest, ProviderResult } from "../dispatch/types";

/** OpenAI gpt-image sizes. Map our aspect ratio; default lets the model choose. */
function sizeFor(aspectRatio?: string): "1024x1024" | "1536x1024" | "1024x1536" | "auto" {
  switch (aspectRatio) {
    case "3:2":
      return "1536x1024";
    case "2:3":
      return "1024x1536";
    case "1:1":
      return "1024x1024";
    default:
      return "auto";
  }
}

/** Build an OpenAI client, pointed at AI Gateway when the ids resolve. */
async function makeClient(env: Env): Promise<OpenAI> {
  const apiKey = await getOpenAiApiKey(env);
  if (!apiKey) {
    throw new NotImplementedError("OpenAI generate: OPENAI_API_KEY unresolved (set the binding + value).");
  }

  const accountId = await getCloudflareAccountId(env);
  const gatewayId = env.AI_GATEWAY_ID;
  if (accountId && gatewayId) {
    const token = await getAiGatewayToken(env);
    const defaultHeaders = token ? { "cf-aig-authorization": `Bearer ${token}` } : undefined;
    return new OpenAI({
      apiKey,
      baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`,
      defaultHeaders,
    });
  }
  // No gateway ids → call OpenAI directly (still fine; usage still logged).
  return new OpenAI({ apiKey });
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function pngFile(b64: string, name: string): Promise<Uploadable> {
  return toFile(Buffer.from(b64, "base64"), name, { type: "image/png" });
}

/** Map the OpenAI Images response → ProviderResult (bytes + usage). */
function parseResponse(rsp: OpenAI.Images.ImagesResponse): ProviderResult {
  const b64 = rsp.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError("OpenAI Images returned no image data.");
  const out: ProviderResult = {
    outputImageBytes: b64ToArrayBuffer(b64),
    // OpenAI images have no multi-turn interaction handle to chain from.
    providerInteractionId: null,
  };
  const u = rsp.usage;
  if (u) {
    if (typeof u.input_tokens === "number") out.tokensIn = u.input_tokens;
    if (typeof u.output_tokens === "number") out.tokensOut = u.output_tokens;
  }
  return out;
}

export const openaiImageAdapter: ProviderAdapter = {
  provider: "openai",

  async generate(env: Env, req: ProviderRequest): Promise<ProviderResult> {
    const client = await makeClient(env);
    const size = sizeFor(req.aspectRatio);

    // Gather source images: the edited image first, then references (capped).
    const maxRefs = Math.max(0, req.model.capabilities.max_reference_images);
    const sources: string[] = [];
    if (req.inputImageBase64) sources.push(req.inputImageBase64);
    sources.push(...(req.referenceImagesBase64 ?? []).slice(0, maxRefs));

    try {
      // No source image → text-to-image generate; otherwise edit the sources.
      if (sources.length === 0) {
        const rsp = await client.images.generate({
          model: req.model.id,
          prompt: req.prompt,
          ...(size !== "auto" ? { size } : {}),
        });
        return parseResponse(rsp);
      }

      const image = await Promise.all(sources.map((b, i) => pngFile(b, `source-${i}.png`)));
      const mask = req.maskBase64 ? await pngFile(req.maskBase64, "mask.png") : undefined;
      const rsp = await client.images.edit({
        model: req.model.id,
        image,
        prompt: req.prompt,
        ...(mask ? { mask } : {}),
        ...(size !== "auto" ? { size } : {}),
      });
      const result = parseResponse(rsp);
      // OpenAI's mask channel is native (not emulated) when a mask was supplied.
      if (req.maskBase64) result.maskEmulated = false;
      return result;
    } catch (err) {
      if (err instanceof ProviderError || err instanceof NotImplementedError) throw err;
      throw classifyProviderError("OpenAI Images", err);
    }
  },
};
