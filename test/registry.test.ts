/**
 * Model registry tests — the pure capability/resolution logic + the D1-backed
 * authoritative resolution (task_model_defaults) and seeding.
 */

import { describe, expect, it } from "vitest";

import {
  assertCapability,
  listModels,
  modelSatisfies,
  pickFallbackModel,
  requireModel,
  resolveModelId,
  seedRegistry,
  validateTaskDefaults,
} from "@/backend/ai/registry";
import { taskModelDefaults } from "@/backend/db/schema";
import { CapabilityError, ValidationError } from "@/backend/core";
import { eq } from "drizzle-orm";
import { ctx } from "./helpers";

describe("registry — pure capability logic", () => {
  it("registers pinned models and never Imagen", () => {
    const ids = listModels().map((m) => m.id);
    expect(ids).toContain("gemini-3.1-flash-image");
    expect(ids.some((i) => i.includes("imagen"))).toBe(false);
  });

  it("exposes the current OpenAI image model and deprecates the old one", () => {
    const two = requireModel("gpt-image-2");
    expect(two.provider).toBe("openai");
    expect(two.deprecated).toBeFalsy();
    expect(two.capabilities.mask_inpainting).toBe(true);
    expect(requireModel("gpt-image-1").deprecated).toBe(true);
  });

  it("every model has a display_name — the field the UI picker renders", () => {
    // Guards the ComposePane bug where the picker read the wrong field and showed
    // only "(provider)". Non-empty display_name for every registered model.
    for (const m of listModels()) {
      expect(typeof m.display_name).toBe("string");
      expect(m.display_name.length).toBeGreaterThan(0);
    }
  });

  it("enforces mask capability — allows native OR emulated, rejects models with neither", () => {
    // gemini-3.6-flash is understanding-only: no mask channel and no emulation.
    expect(() => assertCapability("gemini-3.6-flash", { mask_inpainting: true })).toThrow(
      CapabilityError,
    );
    // Gemini image models support native masking → allowed.
    expect(assertCapability("gemini-3.1-flash-image", { mask_inpainting: true }).id).toBe(
      "gemini-3.1-flash-image",
    );
    // OpenAI has a native mask channel.
    expect(assertCapability("gpt-image-1", { mask_inpainting: true }).id).toBe("gpt-image-1");
  });

  it("enforces Image Search grounding (only 3.1 Flash)", () => {
    expect(modelSatisfies(requireModel("gemini-3.1-flash-image"), { grounding_image_search: true })).toBe(
      true,
    );
    expect(modelSatisfies(requireModel("gemini-3-pro-image"), { grounding_image_search: true })).toBe(
      false,
    );
  });

  it("enforces reference-image limits", () => {
    expect(modelSatisfies(requireModel("gemini-3.1-flash-image"), { multi_reference_count: 14 })).toBe(
      true,
    );
    expect(modelSatisfies(requireModel("gemini-3.1-flash-image"), { multi_reference_count: 15 })).toBe(
      false,
    );
    expect(modelSatisfies(requireModel("gemini-3.1-flash-lite-image"), { multi_reference_count: 1 })).toBe(
      false,
    );
  });

  it("picks a fallback that satisfies the requirement, excluding failed + deprecated", () => {
    const fb = pickFallbackModel("gemini-3.1-flash-image", { mask_inpainting: true });
    expect(fb).not.toBeNull();
    expect(fb!.id).not.toBe("gemini-3.1-flash-image");
    expect(fb!.deprecated).toBeFalsy();
  });
});

describe("registry — authoritative resolution (D1)", () => {
  it("resolves explicit → override → default → error", async () => {
    const c = ctx();
    await seedRegistry(c.db);

    // explicit wins
    expect(await resolveModelId(c.db, { taskKey: "image_edit", explicit: "gemini-3-pro-image" })).toBe(
      "gemini-3-pro-image",
    );
    // session override next
    expect(
      await resolveModelId(c.db, {
        taskKey: "image_edit",
        sessionOverrides: { image_edit: "gemini-3.1-flash-lite-image" },
      }),
    ).toBe("gemini-3.1-flash-lite-image");
    // falls to the seeded task default — Images 2.5 Flare, which (unlike the
    // Gemini image models) has a NATIVE mask channel, so masked edits are precise
    // rather than emulated.
    expect(await resolveModelId(c.db, { taskKey: "image_edit" })).toBe("gpt-image-2.5-flare");
    // generation stays on Gemini
    expect(await resolveModelId(c.db, { taskKey: "image_generate" })).toBe("gemini-3.1-flash-image");
  });

  it("errors when no model resolves (unknown task, no default)", async () => {
    const c = ctx();
    await seedRegistry(c.db);
    await expect(resolveModelId(c.db, { taskKey: "video" as never })).resolves.toBeTruthy(); // video IS seeded
    // A task with no default + no explicit/override:
    await c.db.delete(taskModelDefaults).where(eq(taskModelDefaults.taskKey, "image_generate"));
    await expect(resolveModelId(c.db, { taskKey: "image_generate" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("seedRegistry is idempotent and leaves task defaults valid", async () => {
    const c = ctx();
    await seedRegistry(c.db);
    await seedRegistry(c.db); // second run must not throw or duplicate
    expect(await validateTaskDefaults(c.db)).toEqual([]);
  });
});
