/**
 * @fileoverview What the onboarding wizard actually writes, as two pure functions.
 *
 * These are lifted out of `ProjectWizard` because both had silent bugs that no
 * route test could reach: the decision lives in a React component, so a wrong
 * answer creates a project that looks right and is not. Pure and separate, they
 * are covered by `test/onboarding-settings.test.ts`.
 *
 * The rule they share is the one the whole settings model rests on: `null` means
 * "clear this and inherit from the folder above", and ABSENT means "leave it
 * alone". In the draft, a cleared field is the empty string; `settingsToWrite`
 * is the single place that turns it back into the `null` the API expects.
 */

import type { SettingsProposal } from "./OnboardingCopilot";
import type { ClonedSettings, OnboardingDraft } from "./types";

/** Raised when a clone was chosen but its settings were never resolved. */
export class UnresolvedCloneError extends Error {
  constructor(sourceName?: string | null) {
    super(
      `The settings from ${sourceName ?? "that project"} could not be read, so there is nothing to clone. Go back a step and pick it again, or choose "Don't clone".`,
    );
    this.name = "UnresolvedCloneError";
  }
}

/**
 * The settings body to PUT after the folder is created, or `null` to write none.
 *
 * @param draft The wizard's draft.
 * @param sourceName The clone source's display name, for the error message only.
 * @returns The body, or `null` when the project should inherit everything.
 * @throws UnresolvedCloneError when a clone source carries no resolved settings.
 *   Writing nothing in that case is indistinguishable from "inherit", which is
 *   how a project could be created claiming to be a clone of something while
 *   carrying none of its settings.
 * @example settingsToWrite(draft) // → { defaultPrompt: null, … } | null
 */
export function settingsToWrite(
  draft: OnboardingDraft,
  sourceName?: string | null,
): ClonedSettings | null {
  const source = draft.settingsSource;

  if (source.kind === "clone") {
    if (!source.settings) throw new UnresolvedCloneError(sourceName);
    return source.settings;
  }

  if (source.kind !== "custom") return null;

  return {
    defaultPrompt: draft.defaultPrompt.trim() || null,
    contextText:
      [draft.contextText.trim(), draft.scenario && `Scenario: ${draft.scenario}`]
        .filter(Boolean)
        .join("\n") || null,
    useCase: draft.useCase || null,
  };
}

/**
 * Fold a copilot proposal into the draft.
 *
 * @param draft The current draft.
 * @param proposal What the copilot settled this turn.
 * @returns A new draft. Fields the proposal does not name are untouched; fields
 *   it sets to `null` are cleared to `""`, which `settingsToWrite` turns back
 *   into the `null` that re-enables inheritance.
 * @example applyProposalToDraft(draft, { useCase: null }) // clears the use case
 */
export function applyProposalToDraft(
  draft: OnboardingDraft,
  proposal: SettingsProposal,
): OnboardingDraft {
  const next: OnboardingDraft = { ...draft, settingsSource: { kind: "custom" } };
  // `??` and never `&&`: a proposed null is an instruction, not an absence.
  if ("defaultPrompt" in proposal) next.defaultPrompt = proposal.defaultPrompt ?? "";
  if ("contextText" in proposal) next.contextText = proposal.contextText ?? "";
  if ("useCase" in proposal) next.useCase = proposal.useCase ?? "";
  return next;
}
