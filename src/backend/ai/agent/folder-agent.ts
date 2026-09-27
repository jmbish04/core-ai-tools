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
import { buildOnboardingInstructions, parseCopilotReply } from "./onboarding-copilot";
import type { OnboardingDraftContext, SettingsProposal } from "./onboarding-copilot";

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
  /**
   * Settings the onboarding copilot settled this turn, for the wizard to write
   * on finish. Absent for a normal folder turn, and null for a copilot turn that
   * only asked a question.
   */
  proposal?: SettingsProposal | null;
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
/** What one turn is asked to do. Shared by the buffered and streamed paths. */
export interface FolderTurnInput {
  folderId: string | null;
  message: string;
  history?: AgentMessage[];
  model?: string;
  /**
   * `onboarding` is the wizard's copilot: the project folder does not exist
   * yet, so the copilot PROPOSES settings in its reply instead of calling
   * `set_folder_settings`, and the wizard writes them on finish. It gets no
   * tools for the same reason — there is nothing for it to edit.
   */
  mode?: "folder" | "onboarding";
  /** The wizard's draft so far. Only read in `onboarding` mode. */
  draft?: OnboardingDraftContext;
}

/**
 * Everything a turn needs, built once. Both `runFolderTurn` and
 * `streamFolderTurn` go through here so the two paths cannot drift into
 * different agents, different tool sets or different turn limits — the kind of
 * difference that shows up as "it behaves differently when it streams".
 */
async function prepareTurn(env: Env, input: FolderTurnInput) {
  const model = input.model ?? "auto";
  const onboarding = input.mode === "onboarding";
  const toolCalls: ToolCallRecord[] = [];

  const agent = new Agent({
    name: onboarding ? "Onboarding copilot" : "Folder agent",
    instructions: onboarding
      ? buildOnboardingInstructions(input.draft ?? {})
      : await buildInstructions(env, input.folderId),
    model: await buildModel(env, model),
    tools: onboarding
      ? []
      : AGENT_TOOL_NAMES.map((n) => asAgentTool(env, n, toolCalls)).filter(
          (t): t is NonNullable<ReturnType<typeof asAgentTool>> => t !== null,
        ),
  });

  return {
    agent,
    model,
    onboarding,
    toolCalls,
    // The SDK takes either a string or a message list; history keeps the thread.
    conversation: [
      ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: input.message },
    ],
    // One turn is enough with no tools; the folder agent needs room to chain them.
    maxTurns: onboarding ? 2 : 8,
  };
}

/** Shape the final result the same way for both paths. */
function finishTurn(
  raw: string,
  toolCalls: ToolCallRecord[],
  model: string,
  onboarding: boolean,
): FolderAgentTurn {
  if (!onboarding) return { reply: raw, toolCalls, model };
  const { reply, proposal } = parseCopilotReply(raw);
  return { reply, toolCalls, model, proposal };
}

export async function runFolderTurn(env: Env, input: FolderTurnInput): Promise<FolderAgentTurn> {
  const { agent, conversation, maxTurns, model, onboarding, toolCalls } = await prepareTurn(
    env,
    input,
  );
  const result = await run(agent, conversation as never, { maxTurns });
  return finishTurn(result.finalOutput ?? "", toolCalls, model, onboarding);
}

/** One frame of a streamed turn. Serialised as SSE `data:` lines by the route. */
export type FolderTurnFrame =
  /** A piece of the reply as the model writes it. */
  | { type: "delta"; text: string }
  /** A tool finished. Emitted when it ran, not at the end. */
  | { type: "tool"; name: string; ok: boolean; error?: string }
  /** The turn is over. Carries the whole reply, so a client can ignore deltas. */
  | { type: "done"; turn: FolderAgentTurn }
  /** The turn failed. The message is the one the user should see. */
  | { type: "error"; message: string };

/**
 * Run one turn, yielding frames as they happen.
 *
 * Streaming is the difference between watching the agent think and staring at a
 * spinner for eight seconds. The tool frames matter more than the text ones: a
 * turn that renames four folders spends most of its time in tools, and until now
 * the only sign of that was the folder WebSocket updating a tree the user might
 * not be looking at.
 *
 * The onboarding copilot's settings block is NOT streamed as text — the block is
 * machine-readable and half of it on screen is noise. Its deltas are emitted, and
 * the `done` frame carries the reply with the block already parsed out, so a
 * client renders the final text over the streamed one.
 *
 * @param env   Worker env (needs GUARDIAN_HTTP + AI_GATEWAY_TOKEN).
 * @param input The same input `runFolderTurn` takes.
 * @yields Frames in order, ending with exactly one `done` or one `error`.
 * @example for await (const f of streamFolderTurn(env, { folderId, message })) { … }
 */
export async function* streamFolderTurn(
  env: Env,
  input: FolderTurnInput,
): AsyncGenerator<FolderTurnFrame> {
  let toolCalls: ToolCallRecord[] = [];
  let model = input.model ?? "auto";
  let onboarding = input.mode === "onboarding";
  let raw = "";

  try {
    const prepared = await prepareTurn(env, input);
    ({ toolCalls, model, onboarding } = prepared);

    const result = await run(prepared.agent, prepared.conversation as never, {
      maxTurns: prepared.maxTurns,
      stream: true,
    });

    // Tools record themselves into `toolCalls` from inside their own execute, so
    // the stream reports whatever has appeared since the last frame rather than
    // trying to reconstruct a result from the SDK's item events — which say a
    // tool was CALLED, not whether it succeeded. A trace built from those marks
    // every call successful, which is a flag structurally incapable of being
    // false (see the `folder-agent` notes in AGENTS.md).
    let reported = 0;
    const drainTools = function* (): Generator<FolderTurnFrame> {
      while (reported < toolCalls.length) {
        const call = toolCalls[reported++];
        yield { type: "tool", ...call };
      }
    };

    for await (const event of result) {
      if (
        event.type === "raw_model_stream_event" &&
        (event.data as { type?: string }).type === "output_text_delta"
      ) {
        const text = (event.data as { delta?: string }).delta ?? "";
        if (text) {
          raw += text;
          yield { type: "delta", text };
        }
      }
      yield* drainTools();
    }

    // The generator above only sees tools that finished before the last event.
    await result.completed;
    yield* drainTools();

    // `finalOutput` is authoritative: the deltas can miss a final chunk, and for
    // the copilot the parsed reply differs from the raw text anyway.
    yield { type: "done", turn: finishTurn(result.finalOutput ?? raw, toolCalls, model, onboarding) };
  } catch (err) {
    // A failed turn must say so on the stream. Throwing here would close the
    // response mid-flight and leave the client showing a half-written reply with
    // no indication anything went wrong.
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "The agent could not be reached.",
    };
  }
}
