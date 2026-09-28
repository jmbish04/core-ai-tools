/**
 * The two ways the onboarding wizard could write the wrong settings.
 *
 * Both were found reviewing this PR, and both are silent — the project is
 * created, the UI says it worked, and the settings are simply not what the user
 * chose. Neither is reachable from a route test, because the decision lives in
 * the wizard, so the decision itself is extracted and tested here.
 *
 * 1. A clone source whose settings never resolved. `create()` used to read them
 *    from component state that the saved draft did not carry, so a draft saved
 *    on step 4 and restored later cloned NOTHING — no settings PUT at all —
 *    while the review step still said "Cloned from X".
 * 2. A copilot proposal of `useCase: null`, which the parser documents and tests
 *    as "clear it and inherit again". A truthiness check dropped it and kept the
 *    old value, which is the opposite instruction.
 */

import { describe, expect, it } from "vitest";

import { applyProposalToDraft, settingsToWrite } from "@/components/onboarding/settings";
import { EMPTY_DRAFT } from "@/components/onboarding/types";
import type { OnboardingDraft } from "@/components/onboarding/types";

const draft = (over: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  ...EMPTY_DRAFT,
  name: "Kitchen remodel",
  ...over,
});

const CLONED = { defaultPrompt: "photoreal", contextText: "a 1920s kitchen", useCase: "refinish" };

describe("what the wizard writes", () => {
  it("writes nothing at all when the source is inherit", () => {
    // Not `{}` and not nulls: an absent PUT is what keeps every setting
    // resolving up the tree.
    expect(settingsToWrite(draft({ settingsSource: { kind: "inherit" } }))).toBeNull();
  });

  it("writes the clone's resolved settings", () => {
    const d = draft({ settingsSource: { kind: "clone", folderId: "f1", settings: CLONED } });
    expect(settingsToWrite(d)).toEqual(CLONED);
  });

  it("REFUSES a clone whose settings never resolved", () => {
    // The bug: this returned null, indistinguishable from "inherit", so the
    // project was created with no settings and no error.
    const d = draft({ settingsSource: { kind: "clone", folderId: "f1", settings: null } });
    expect(() => settingsToWrite(d)).toThrow(/could not be read|nothing to clone/i);
  });

  it("turns empty custom fields into null so they inherit again", () => {
    const d = draft({
      settingsSource: { kind: "custom" },
      defaultPrompt: "  ",
      contextText: "",
      useCase: "",
    });
    expect(settingsToWrite(d)).toEqual({
      defaultPrompt: null,
      contextText: null,
      useCase: null,
    });
  });

  it("folds the scenario into the context it sends", () => {
    const d = draft({
      settingsSource: { kind: "custom" },
      contextText: "a 1920s kitchen",
      scenario: "home-remodel",
      useCase: "refinish",
    });
    expect(settingsToWrite(d)?.contextText).toBe("a 1920s kitchen\nScenario: home-remodel");
  });
});

describe("applying a copilot proposal", () => {
  it("applies the fields it names", () => {
    const next = applyProposalToDraft(draft(), {
      defaultPrompt: "photoreal, keep the cabinetry",
      useCase: "refinish",
    });
    expect(next.defaultPrompt).toBe("photoreal, keep the cabinetry");
    expect(next.useCase).toBe("refinish");
    expect(next.settingsSource).toEqual({ kind: "custom" });
  });

  it("leaves a field the proposal does not mention alone", () => {
    const next = applyProposalToDraft(draft({ contextText: "kept" }), { useCase: "edit" });
    expect(next.contextText).toBe("kept");
  });

  it("clears a field the proposal sets to null", () => {
    // `null` is "clear it and inherit again" everywhere else in this codebase,
    // and the copilot parser is tested for passing it through. Dropping it here
    // silently kept the old value.
    const before = draft({ defaultPrompt: "old prompt", contextText: "old ctx", useCase: "edit" });
    const next = applyProposalToDraft(before, {
      defaultPrompt: null,
      contextText: null,
      useCase: null,
    });
    expect({ p: next.defaultPrompt, c: next.contextText, u: next.useCase }).toEqual({
      p: "",
      c: "",
      u: "",
    });
    // And an empty draft field becomes a real null on the wire.
    expect(settingsToWrite(next)).toEqual({
      defaultPrompt: null,
      contextText: null,
      useCase: null,
    });
  });
});
