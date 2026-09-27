/**
 * @fileoverview The folder agent — the thing a user talks to beside the folder tree.
 *
 * Built on the OpenAI Agents SDK (`@openai/agents`), whose package ships `workerd`
 * export conditions, so it runs inside the Worker rather than needing a Node host.
 *
 * ROUTED THROUGH CORE-GUARDIAN. The model client points at guardian's
 * OpenAI-compatible `/v1/chat/completions`, which its own spec describes as
 * "routed and metered through the AI router" — so the agent's spend passes the
 * same budget and breaker checks as every other call, instead of being the one
 * path that escapes them. The request goes over the `GUARDIAN_HTTP` service
 * binding, so it never leaves Cloudflare's network, and the SDK's tracing egress
 * is disabled because a Worker has nowhere to send it.
 *
 * ITS TOOLS ARE THE MCP TOOLS. `ALL_TOOLS` from the MCP server is wrapped
 * directly — one registry, one code path. An agent that edited folders through
 * some private set of functions would drift from what an external MCP client can
 * do, and the two would slowly become different products.
 *
 * Because every mutation runs through core, the folder's WebSocket channel emits
 * for the agent exactly as it does for a person: the user watches the tree change
 * while they talk.
 */

import { Agent, run, setTracingDisabled, tool } from "@openai/agents";
import { OpenAIChatCompletionsModel } from "@openai/agents-openai";
import OpenAI from "openai";
import { z } from "zod";

import { ALL_TOOLS } from "@/backend/mcp/server";
import { callToolByName } from "@/backend/mcp/server";
import { createCoreContext, resolveSettings } from "@/backend/core";
import { listLibrary, requireFolder } from "@/backend/core";
import { getAiGatewayToken } from "@/backend/utils/secrets";

/** Guardian's OpenAI-compatible surface. The host is a placeholder: the service
 *  binding decides where it actually goes. */
const GUARDIAN_BASE_URL = "https://core-guardian/v1";

/** Public host, for the deep links the tools hand back. */
const PUBLIC_HOST = "core-ai-tools.hacolby.workers.dev";

/**
 * The tools the folder agent gets. Deliberately a SUBSET of the MCP surface:
 * a conversation about organising a folder has no business cancelling revisions
 * or setting asset TTLs, and a long tool list makes a model worse at choosing.
 */
const AGENT_TOOL_NAMES = [
  "list_folders",
  "create_folder",
  "move_folder",
  "get_folder_settings",
  "set_folder_settings",
  "list_library",
  "update_image_metadata",
  "get_image_by_public_id",
  "list_assets",
  "create_asset",
  "promote_image_to_asset",
  "list_asset_iterations",
  "compare_models",
  "list_available_models",
  "get_prompt_templates",
] as const;

/** What the caller gets back from one turn. */
export interface FolderAgentTurn {
  reply: string;
  /** Tools the model actually invoked, in order, with what each one did. */
  toolCalls: ToolCallRecord[];
  model: string;
}

/** One message in the conversation so far. */
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Build a model bound to THIS request's guardian client.
 *
 * Deliberately not `setDefaultOpenAIClient`: that is module-global in the SDK,
 * and a Worker isolate serves concurrent requests. Setting it per request means
 * a turn can finish against a client another request installed underneath it —
 * invisible while every request builds the same client, and wrong the moment the
 * gateway token is rotated (utils/secrets.ts deliberately does not cache, so
 * rotation takes effect without a redeploy). The model owns its client instead.
 *
 * @throws Error when the gateway token is unresolvable — the agent fails loudly
 *   rather than silently talking to OpenAI directly and escaping metering.
 */
async function buildModel(env: Env, modelId: string): Promise<OpenAIChatCompletionsModel> {
  const token = await getAiGatewayToken(env);
  if (!token) {
    throw new Error(
      "Folder agent: AI_GATEWAY_TOKEN unresolved, so the call cannot be routed through core-guardian. " +
        "Refusing to fall back to a direct provider call, which would bypass budget and breaker checks.",
    );
  }
  const client = new OpenAI({
    apiKey: token,
    baseURL: GUARDIAN_BASE_URL,
    // Internal hop: the service binding, never the public hostname.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      env.GUARDIAN_HTTP.fetch(new Request(String(input), init as RequestInit))) as typeof fetch,
  });
  // A Worker has nowhere to send traces, and the attempt costs a failed
  // subrequest. This one IS global, and safely so: it is the same value for every
  // request and carries no per-request state.
  setTracingDisabled(true);
  // Guardian speaks chat-completions, not the Responses API the SDK defaults to;
  // naming the class picks that wire format without a global mode switch.
  return new OpenAIChatCompletionsModel(client, modelId);
}

/** What one tool call did, recorded as it happens. */
export interface ToolCallRecord {
  name: string;
  ok: boolean;
  /** The error text the tool returned, when it failed. */
  error?: string;
}

/**
 * Wrap one MCP tool as an Agents SDK tool, keeping its schema and description.
 *
 * The outcome is recorded into `calls` HERE, at the point where it is actually
 * known. `callToolByName` returns a tool error as CONTENT rather than throwing —
 * that is deliberate, so the model can read what went wrong and adjust — which
 * means nothing downstream can tell a failed call from a successful one by
 * looking at the SDK's item stream. Deriving "ok" out there produced a flag that
 * was structurally incapable of ever being false.
 */
function asAgentTool(env: Env, name: string, calls: ToolCallRecord[]) {
  const def = ALL_TOOLS[name];
  if (!def) return null;
  return tool({
    name,
    description: def.description,
    parameters: def.schema as z.ZodObject<z.ZodRawShape>,
    async execute(args: unknown) {
      const ctx = createCoreContext(env);
      const out = await callToolByName(ctx, name, (args ?? {}) as Record<string, unknown>, PUBLIC_HOST);
      const first = out.content[0] as { text?: string } | undefined;
      const text = first?.text ?? JSON.stringify(out.content);
      calls.push(out.isError ? { name, ok: false, error: text.slice(0, 300) } : { name, ok: true });
      // Hand back the text the MCP surface would return — including the error
      // text on failure, so the model can read what went wrong and adjust rather
      // than being told only that "something failed".
      return text;
    },
  });
}

/**
 * Build the system prompt: who the agent is, and — the part that matters — what
 * folder it is looking at, what settings are in force there and where they came
 * from, and what is actually in it. Without this the agent asks the user for
 * things the URL already told it.
 */
async function buildInstructions(env: Env, folderId: string | null): Promise<string> {
  const base = [
    "You organise an image workspace with the user, working alongside them in the folder they have open.",
    "Folders nest, and their settings (default prompt, context, use case) inherit from the nearest ancestor that sets one. Clearing a setting — sending null — is how inheritance is re-enabled.",
    "Images carry a short public id (img_…), a title, a description, usage instructions and a role: base is the picture being edited, reference is a look to borrow, inject is an object to place in.",
    "Use the tools to make changes rather than describing what the user should click; they see the folder update live as you work.",
    "Be concrete and brief. When you change something, say what you changed. When a tool fails, say what it said rather than trying the same call again.",
  ];

  if (!folderId) {
    base.push("The user is not inside a folder yet, so ask which one, or create one when they describe a project.");
    return base.join("\n");
  }

  const ctx = createCoreContext(env);
  try {
    const [folder, settings, images] = await Promise.all([
      requireFolder(ctx, folderId),
      resolveSettings(ctx, folderId),
      listLibrary(ctx, { folderId, limit: 40 }),
    ]);

    const setting = (label: string, s: { value: unknown; inherited: boolean; fromFolderId: string | null }) =>
      s.value === null
        ? `- ${label}: not set anywhere above`
        : `- ${label}: ${JSON.stringify(s.value)}${s.inherited ? ` (inherited from folder ${s.fromFolderId})` : " (set on this folder)"}`;

    base.push(
      "",
      `Current folder: "${folder.name}" (id ${folder.id}).`,
      "Settings in force here:",
      setting("default prompt", settings.defaultPrompt),
      setting("context", settings.contextText),
      setting("use case", settings.useCase),
      "",
      images.length === 0
        ? "The folder has no images yet."
        : `Images in this folder (${images.length}):\n` +
          images
            .map(
              (i) =>
                `- ${i.publicId ?? i.id}: ${i.title ?? i.originalFilename ?? "untitled"}${i.role ? ` [${i.role}]` : ""}${i.description ? ` — ${i.description.slice(0, 80)}` : ""}`,
            )
            .join("\n"),
    );
  } catch {
    // A folder that vanished mid-conversation is not a reason to refuse to talk.
    base.push("", `Current folder id: ${folderId} (its details could not be read just now).`);
  }

  return base.join("\n");
}

/**
 * Run one turn of the folder conversation.
 *
 * @param env      Worker env (needs GUARDIAN_HTTP + AI_GATEWAY_TOKEN).
 * @param input.folderId The folder the user is looking at, from the page URL.
 * @param input.message  What the user just said.
 * @param input.history  Prior turns, oldest first.
 * @param input.model    Override the model; defaults to guardian's `auto` alias,
 *   which lets the router pick within the project's budget.
 * @returns The reply, the tools that ran, and the model used.
 * @throws Error when guardian cannot be reached or the gateway token is missing.
 * @example await runFolderTurn(env, { folderId, message: "tidy these into sub-folders by room" })
 */
export async function runFolderTurn(
  env: Env,
  input: { folderId: string | null; message: string; history?: AgentMessage[]; model?: string },
): Promise<FolderAgentTurn> {
  const model = input.model ?? "auto";
  const chatModel = await buildModel(env, model);

  const toolCalls: ToolCallRecord[] = [];
  const tools = AGENT_TOOL_NAMES.map((n) => asAgentTool(env, n, toolCalls)).filter(
    (t): t is NonNullable<ReturnType<typeof asAgentTool>> => t !== null,
  );

  const agent = new Agent({
    name: "Folder agent",
    instructions: await buildInstructions(env, input.folderId),
    model: chatModel,
    tools,
  });

  // The SDK takes either a string or a message list; history keeps the thread.
  const conversation = [
    ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message },
  ];

  const result = await run(agent, conversation as never, { maxTurns: 8 });

  return {
    reply: result.finalOutput ?? "",
    toolCalls,
    model,
  };
}
