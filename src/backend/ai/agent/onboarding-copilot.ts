/**
 * @fileoverview The onboarding copilot — the wizard's last step.
 *
 * The project does not exist yet when this runs. That is the whole difficulty:
 * the folder agent settles a folder's settings by CALLING `set_folder_settings`,
 * and there is no folder to call it on, because the wizard deliberately writes
 * nothing until the user commits (a half-written project shows up in the tree as
 * a real folder that is not one).
 *
 * So the copilot proposes instead of acting. It is the same guardian-routed
 * model, given the draft the user has filled in so far and told to end a turn
 * that has settled something with a fenced `settings` block. The block is parsed
 * out here and returned separately, and the wizard writes it — once — on finish.
 *
 * No new tool. The agent's tool set stays `ALL_TOOLS`; adding a "propose"
 * tool that writes nothing would put a second, parallel way to set folder
 * settings into the surface every MCP client sees.
 */

import { z } from "zod";

/** What the copilot can settle. Mirrors the three inheritable text settings. */
export const settingsProposalSchema = z.object({
  defaultPrompt: z.string().nullable().optional(),
  contextText: z.string().nullable().optional(),
  useCase: z.string().nullable().optional(),
  /** The copilot's one-line summary of what it settled, for the wizard's review. */
  summary: z.string().optional(),
});

export type SettingsProposal = z.infer<typeof settingsProposalSchema>;

/** The draft the user has filled in so far — everything the copilot needs to know. */
export interface OnboardingDraftContext {
  name?: string | null;
  parentFolderName?: string | null;
  /** Settings already in force on the parent, so the copilot does not restate them. */
  inherited?: { defaultPrompt?: string | null; contextText?: string | null; useCase?: string | null };
  useCase?: string | null;
  scenario?: string | null;
  defaultPrompt?: string | null;
  contextText?: string | null;
  /** Titles + roles of the images staged so far. */
  images?: { title: string; role: string }[];
  /** Names of the assets chosen so far. */
  assets?: string[];
}

/** The use-case ids the wizard offers. The copilot must pick one of these or none. */
const USE_CASE_IDS = ["edit", "refinish", "generate", "compare"] as const;

/**
 * Instructions for the copilot turn.
 *
 * @param draft What the user has filled in so far.
 * @returns The system prompt.
 */
export function buildOnboardingInstructions(draft: OnboardingDraftContext): string {
  const lines = [
    "You are helping someone set up a new project in an image workspace, by talking it through with them.",
    "A project IS a folder. It carries three settings that every edit inside it starts from:",
    "- default prompt: the wording prepended to each generation (style, what to preserve).",
    "- context: what the job is, in a sentence or two — the model reads it, so write it for the model.",
    `- use case: exactly one of ${USE_CASE_IDS.join(", ")}.`,
    "Anything left blank inherits from the folder above, so do not restate a setting the parent already provides unless the user wants to override it.",
    "",
    "Ask at most one short question per turn, and only when the answer would change the settings. Two or three exchanges is a good conversation; do not interview them.",
    "As soon as you have enough to write a setting, propose it.",
    "",
    "TO PROPOSE, end your message with a fenced code block tagged `settings` containing JSON with any of: defaultPrompt, contextText, useCase, summary.",
    "Use null for a setting that should stay inherited. Omit a key you are not changing. `summary` is one line for the user, not for the model.",
    "Write prose above the block explaining the proposal in a sentence. Never mention the block itself.",
    "",
    "Example of a complete reply:",
    "That should keep the original cabinetry while changing the island.",
    "```settings",
    '{"defaultPrompt":"photoreal, keep the existing cabinetry and floor","contextText":"A 1920s kitchen. The client is choosing between island materials.","useCase":"refinish","summary":"Photoreal refinish, cabinetry preserved"}',
    "```",
  ];

  lines.push("", "What the user has filled in so far:");
  lines.push(`- name: ${draft.name?.trim() || "(not named yet)"}`);
  lines.push(`- lives in: ${draft.parentFolderName || "the library root"}`);
  if (draft.scenario) lines.push(`- kind of work: ${draft.scenario}`);
  if (draft.useCase) lines.push(`- use case chosen: ${draft.useCase}`);
  if (draft.defaultPrompt?.trim()) lines.push(`- default prompt so far: ${draft.defaultPrompt.trim()}`);
  if (draft.contextText?.trim()) lines.push(`- context so far: ${draft.contextText.trim()}`);
  if (draft.assets?.length) lines.push(`- assets chosen: ${draft.assets.join(", ")}`);
  if (draft.images?.length) {
    lines.push(
      `- images staged (${draft.images.length}): ` +
        draft.images.map((i) => `${i.title} [${i.role}]`).join(", "),
    );
  }

  const inherited = draft.inherited;
  if (inherited && (inherited.defaultPrompt || inherited.contextText || inherited.useCase)) {
    lines.push("", "Already inherited from the parent folder (do not repeat these):");
    if (inherited.defaultPrompt) lines.push(`- default prompt: ${inherited.defaultPrompt}`);
    if (inherited.contextText) lines.push(`- context: ${inherited.contextText}`);
    if (inherited.useCase) lines.push(`- use case: ${inherited.useCase}`);
  }

  return lines.join("\n");
}

/** A reply split into what the user reads and what the wizard applies. */
export interface ParsedCopilotReply {
  /** The reply with the proposal block removed. Never empty if the model said anything. */
  reply: string;
  /** The settings the copilot settled, or null when it only asked a question. */
  proposal: SettingsProposal | null;
}

// Tolerant on purpose: models fence with ```settings, ```json, or bare ```, and
// sometimes add a language hint after the tag. The tag is captured so a block
// that is plainly something else (```bash) is left alone.
const FENCE = /```[ \t]*(settings|json)?[ \t]*\r?\n([\s\S]*?)```/gi;

/**
 * Pull the settings proposal out of a copilot reply.
 *
 * Returns `proposal: null` rather than throwing when there is no block, when the
 * block is not JSON, or when the JSON does not match the schema — a copilot turn
 * that only asks a question is the normal case, and a malformed block must not
 * lose the user the sentence the model wrote.
 *
 * @param raw The model's reply.
 * @returns The user-facing text and the parsed proposal.
 * @example parseCopilotReply('Sure.\n```settings\n{"useCase":"edit"}\n```')
 */
export function parseCopilotReply(raw: string): ParsedCopilotReply {
  let proposal: SettingsProposal | null = null;
  const stripped = raw.replace(FENCE, (match, _tag, body: string) => {
    if (proposal) return match; // keep any second block visible rather than eating it
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      return match;
    }
    const result = settingsProposalSchema.safeParse(parsed);
    if (!result.success) return match;
    // A block with no settings in it is not a proposal — an empty object, or one
    // carrying only a summary, would otherwise light up the "apply" affordance
    // with nothing behind it.
    const { summary: _summary, ...settings } = result.data;
    if (Object.keys(settings).length === 0) return match;
    proposal = result.data;
    return "";
  });

  return { reply: stripped.trim(), proposal };
}
