/**
 * @fileoverview Pure prompt expansion for prompt-only image generation, adapted
 * from gemini-cli-extensions/nanobanana (`buildBatchPrompts`, `buildIconPrompt`,
 * `buildPatternPrompt`, `buildDiagramPrompt`, `generateStorySequence`).
 *
 * Differences from the original:
 *  - Styles × variations expand as a true cross product, then clamp to `count`
 *    (the original silently discarded styles when variations were also given).
 *  - `count` always yields exactly `count` prompts, cycling the expansion when
 *    it is shorter (the original returned fewer than requested).
 *  - Story frames get an explicit consistency instruction; continuity itself is
 *    carried by chaining the provider interaction (see generate.ts).
 *
 * No I/O — every function here is deterministic and unit-tested.
 */

export const GENERATE_PRESETS = ["none", "icon", "pattern", "diagram", "story"] as const;
export type GeneratePreset = (typeof GENERATE_PRESETS)[number];

/** Two prompt suffixes per variation axis (same axes as nanobanana). */
export const VARIATION_SUFFIXES: Record<string, [string, string]> = {
  lighting: ["dramatic lighting", "soft lighting"],
  angle: ["from above", "close-up view"],
  "color-palette": ["warm color palette", "cool color palette"],
  composition: ["centered composition", "rule of thirds composition"],
  mood: ["cheerful mood", "dramatic mood"],
  season: ["in spring", "in winter"],
  "time-of-day": ["at sunrise", "at sunset"],
};

/** Hard ceiling on images per call — bounds cost and parallel provider calls. */
export const MAX_GENERATE_COUNT = 8;

export interface PresetOptions {
  /** Preset sub-type: icon app-icon|favicon|ui-element; pattern seamless|texture|wallpaper;
   *  diagram flowchart|architecture|…; story story|process|tutorial|timeline. */
  type?: string;
  /** Visual style, e.g. minimal, geometric, hand-drawn. */
  style?: string;
  /** Icon background (default transparent). */
  background?: string;
  /** Pattern density (sparse|medium|dense) or diagram complexity. */
  density?: string;
  /** Color scheme, e.g. mono, duotone, accent. */
  colors?: string;
  /** Diagram layout, e.g. hierarchical, horizontal. */
  layout?: string;
}

export interface ExpandInput extends PresetOptions {
  prompt: string;
  preset?: GeneratePreset;
  /** Images to produce (1–MAX_GENERATE_COUNT). Default: expansion size, else 1. */
  count?: number;
  styles?: string[];
  variations?: string[];
}

/** Apply a preset's framing to the base prompt (nanobanana's build*Prompt). */
export function applyPreset(prompt: string, preset: GeneratePreset, o: PresetOptions = {}): string {
  switch (preset) {
    case "icon": {
      const type = o.type ?? "app-icon";
      let p = `${prompt}, ${o.style ?? "modern"} style ${type}`;
      if (type === "app-icon") p += ", rounded corners";
      p += o.background && o.background !== "transparent" ? `, ${o.background} background` : ", plain transparent-style background";
      return `${p}, centered, legible at small sizes, clean design, high quality, professional`;
    }
    case "pattern": {
      const type = o.type ?? "seamless";
      let p = `${prompt}, ${o.style ?? "abstract"} style ${type} pattern, ${o.density ?? "medium"} density, ${o.colors ?? "colorful"} colors`;
      if (type === "seamless") p += ", perfectly tileable repeating pattern with no visible seams at the edges";
      return `${p}, high quality`;
    }
    case "diagram":
      return (
        `${prompt}, ${o.type ?? "flowchart"} diagram, ${o.style ?? "professional"} style, ${o.layout ?? "hierarchical"} layout, ` +
        `${o.density ?? "detailed"} level of detail, ${o.colors ?? "accent"} color scheme, ` +
        "clear correctly-spelled labels, clean technical illustration, clear visual hierarchy"
      );
    default:
      return prompt;
  }
}

/** Per-frame prompt for a story/process sequence. */
export function storyFramePrompt(prompt: string, step: number, total: number, o: PresetOptions = {}): string {
  const context: Record<string, string> = {
    story: `narrative sequence, ${o.style ?? "consistent"} art style`,
    process: "procedural step, instructional illustration",
    tutorial: "tutorial step, educational diagram",
    timeline: "chronological progression, timeline visualization",
  };
  const kind = o.type ?? "story";
  let p = `${prompt}, step ${step} of ${total}, ${context[kind] ?? context.story}`;
  if (step > 1) {
    p += ". Keep characters, color palette, typography, and art style identical to the previous frame";
  }
  return p;
}

/**
 * Expand one request into the exact list of prompts to render.
 *
 * @returns `count` prompts (or the expansion size when count is omitted), never empty.
 * @throws Error when count is outside 1–MAX_GENERATE_COUNT.
 * @example expandPrompts({ prompt: "fox", styles: ["watercolor", "sketch"] })
 *   // → ["fox, watercolor style", "fox, sketch style"]
 */
export function expandPrompts(input: ExpandInput): string[] {
  const preset = input.preset ?? "none";
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATE_COUNT)) {
    throw new Error(`count must be an integer 1–${MAX_GENERATE_COUNT}.`);
  }

  if (preset === "story") {
    const total = input.count ?? 4;
    return Array.from({ length: total }, (_, i) => storyFramePrompt(input.prompt, i + 1, total, input));
  }

  const base = applyPreset(input.prompt, preset, input);
  let expanded = input.styles?.length ? input.styles.map((s) => `${base}, ${s} style`) : [base];
  const suffixes = (input.variations ?? []).flatMap((v) => VARIATION_SUFFIXES[v] ?? []);
  if (suffixes.length) expanded = expanded.flatMap((p) => suffixes.map((s) => `${p}, ${s}`));

  const total = input.count ?? expanded.length;
  return Array.from({ length: Math.min(total, MAX_GENERATE_COUNT) }, (_, i) => expanded[i % expanded.length]);
}
