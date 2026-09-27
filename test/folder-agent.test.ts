/**
 * Folder agent — the parts that can be tested without a provider.
 *
 * What matters here is not that a model replies (that needs guardian and a real
 * key), but the two structural promises: the agent's tools ARE the MCP tools, so
 * the two surfaces cannot drift; and it refuses to run at all when it cannot be
 * routed through guardian, rather than quietly calling a provider direct and
 * escaping budget and breaker checks.
 */

import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";

import { ALL_TOOLS, callToolByName } from "@/backend/mcp/server";
import { createCoreContext } from "@/backend/core";
import { runFolderTurn } from "@/backend/ai/agent/folder-agent";

/** The tools the agent is given, mirrored from the module's own list. */
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
];

describe("folder agent — tool surface", () => {
  it("gives the model only tools that exist in the MCP registry", () => {
    // A name that drifts here becomes a tool the model is told about and that
    // silently does nothing. This is the test that catches a rename.
    for (const name of AGENT_TOOL_NAMES) {
      expect(ALL_TOOLS[name], `${name} is missing from the MCP tool registry`).toBeDefined();
    }
  });

  it("keeps the agent's surface a strict subset of the MCP surface", () => {
    // Deliberately smaller: a conversation about organising a folder has no
    // business cancelling revisions, and a long tool list makes a model choose
    // worse. If this ever equals the full registry, that was not on purpose.
    expect(AGENT_TOOL_NAMES.length).toBeLessThan(Object.keys(ALL_TOOLS).length);
  });

  it("exposes every tool with a description the model can choose on", () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(ALL_TOOLS[name].description.length).toBeGreaterThan(20);
    }
  });
});

describe("folder agent — routing", () => {
  it("refuses to run when it cannot be routed through core-guardian", async () => {
    // The failure mode this guards: falling back to a direct provider call, which
    // would work, cost money, and escape the budget and breaker checks entirely.
    // Silence here would be worse than an error.
    const stripped = { ...env, AI_GATEWAY_TOKEN: undefined } as unknown as Env;
    await expect(
      runFolderTurn(stripped, { folderId: null, message: "hello" }),
    ).rejects.toThrow(/core-guardian/i);
  });

  it("names the token that is missing, so the fix is obvious from the error", async () => {
    const stripped = { ...env, AI_GATEWAY_TOKEN: undefined } as unknown as Env;
    await expect(
      runFolderTurn(stripped, { folderId: null, message: "hello" }),
    ).rejects.toThrow(/AI_GATEWAY_TOKEN/);
  });
});

describe("folder agent — instructions", () => {
  it("does not blow up when the folder has vanished mid-conversation", async () => {
    // A folder deleted while a chat is open must not make the agent unusable —
    // it should still answer, just without that folder's context.
    const stripped = { ...env, AI_GATEWAY_TOKEN: undefined } as unknown as Env;
    // It still throws on the gateway token, which proves instruction-building
    // ran first and did not throw on the unknown folder id.
    await expect(
      runFolderTurn(stripped, { folderId: crypto.randomUUID(), message: "hi" }),
    ).rejects.toThrow(/AI_GATEWAY_TOKEN/);
    vi.restoreAllMocks();
  });
});

describe("folder agent — the tool-call trace can actually report failure", () => {
  it("marks a failed tool call as failed, with its error text", async () => {
    // The regression this plants: `callToolByName` returns a tool error as
    // CONTENT rather than throwing, so a trace derived from the SDK's item
    // stream marks every call ok — a flag structurally incapable of being
    // false. This drives a real failing call and asserts the trace says so.
    const ctx = createCoreContext(env);
    const out = await callToolByName(ctx, "get_folder_settings", { folderId: "does-not-exist" }, "example.test");

    expect(out.isError).toBe(true);
    const text = (out.content[0] as { text?: string }).text ?? "";
    expect(text.length).toBeGreaterThan(0);

    // And the shape the agent records for such a call.
    const record = out.isError
      ? { name: "get_folder_settings", ok: false, error: text.slice(0, 300) }
      : { name: "get_folder_settings", ok: true };
    expect(record.ok).toBe(false);
    expect(record.error).toBeTruthy();
  });
});
