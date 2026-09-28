/**
 * The onboarding copilot's reply parser.
 *
 * The copilot cannot call `set_folder_settings` — the project folder does not
 * exist while the wizard is open — so what it settles has to come back inside its
 * reply, and the wizard writes it on finish. That makes this parser the seam the
 * whole step balances on, and it is exactly the kind of code that looks right and
 * silently does nothing: a block that fails to parse, a schema that rejects, or a
 * fence the model tagged differently would all show the user a normal reply with
 * no proposal attached, and no error anywhere.
 *
 * So the cases below are the ones a model actually produces, not the happy path.
 */

import { describe, expect, it } from "vitest";

import { buildOnboardingInstructions, parseCopilotReply } from "@/backend/ai/agent/onboarding-copilot";

const block = (json: string, tag = "settings") => "```" + tag + "\n" + json + "\n```";

describe("copilot reply parsing", () => {
  it("takes the settings out of the reply and leaves the prose", () => {
    const raw = `That keeps the cabinetry while the island changes.\n\n${block(
      '{"defaultPrompt":"photoreal, keep the cabinetry","useCase":"refinish","summary":"Photoreal refinish"}',
    )}`;
    const { reply, proposal } = parseCopilotReply(raw);

    expect(reply).toBe("That keeps the cabinetry while the island changes.");
    expect(proposal).toEqual({
      defaultPrompt: "photoreal, keep the cabinetry",
      useCase: "refinish",
      summary: "Photoreal refinish",
    });
  });

  it("returns no proposal for a turn that only asks a question", () => {
    const { reply, proposal } = parseCopilotReply("Is this a photo you want changed, or a new image?");
    expect(proposal).toBeNull();
    expect(reply).toBe("Is this a photo you want changed, or a new image?");
  });

  it("accepts the fences a model actually emits", () => {
    for (const tag of ["settings", "json", "JSON", "Settings"]) {
      const { proposal } = parseCopilotReply(`Here.\n${block('{"useCase":"edit"}', tag)}`);
      expect({ tag, proposal }).toEqual({ tag, proposal: { useCase: "edit" } });
    }
  });

  it("keeps the prose when the block is not usable", () => {
    // Malformed JSON, a block of something else, and a shape the schema rejects.
    // Losing the sentence the model wrote would be worse than losing the proposal.
    const cases = [
      `Nearly.\n${block("{not json at all}")}`,
      `Run this:\n${block("pnpm dev", "bash")}`,
      `Hmm.\n${block('{"useCase":42}')}`,
    ];
    for (const raw of cases) {
      const { reply, proposal } = parseCopilotReply(raw);
      expect({ raw: raw.slice(0, 12), proposal }).toEqual({ raw: raw.slice(0, 12), proposal: null });
      expect(reply.length).toBeGreaterThan(0);
    }
  });

  it("does not treat a summary-only block as something to apply", () => {
    // A proposal with nothing in it would light up the wizard's "use this"
    // affordance with no settings behind it.
    expect(parseCopilotReply(`Ok.\n${block('{"summary":"nothing settled yet"}')}`).proposal).toBeNull();
    expect(parseCopilotReply(`Ok.\n${block("{}")}`).proposal).toBeNull();
  });

  it("passes null through, because null is how a setting stays inherited", () => {
    const { proposal } = parseCopilotReply(`Leave it.\n${block('{"defaultPrompt":null}')}`);
    // `undefined` here would mean "don't touch", which is a different instruction.
    expect(proposal).toEqual({ defaultPrompt: null });
    expect(proposal && "defaultPrompt" in proposal).toBe(true);
  });
});

describe("copilot instructions", () => {
  it("tells the copilot what the user has already filled in", () => {
    const text = buildOnboardingInstructions({
      name: "Kitchen remodel",
      parentFolderName: "126 Colby",
      scenario: "home-remodel",
      images: [{ title: "Kitchen as it stands", role: "base" }],
      assets: ["Walnut slab"],
    });
    expect(text).toContain("Kitchen remodel");
    expect(text).toContain("126 Colby");
    expect(text).toContain("Kitchen as it stands [base]");
    expect(text).toContain("Walnut slab");
  });

  it("names the parent's settings so the copilot does not restate them", () => {
    const text = buildOnboardingInstructions({
      inherited: { defaultPrompt: "photoreal", useCase: "refinish" },
    });
    expect(text).toContain("do not repeat these");
    expect(text).toContain("photoreal");
  });

  it("constrains the use case to the ids the wizard offers", () => {
    // A copilot that proposes "interior-design" writes a value the wizard's own
    // use-case list cannot display.
    const text = buildOnboardingInstructions({});
    expect(text).toContain("edit, refinish, generate, compare");
  });
});
