/**
 * @fileoverview The onboarding draft — what the wizard collects before a project
 * exists, and how it is kept between visits.
 *
 * A draft is deliberately client-side for now: nothing here is worth a row until
 * the user commits, and a half-filled project in D1 would show up in the folder
 * tree as a real folder that isn't one. When drafts need to survive a change of
 * device, this moves to a `project_drafts` table — the shape below is already
 * the payload that would go in it.
 */

import type { AssetRow } from "@/components/assets/types";

/** How an uploaded image is meant to be used by the models. */
export type ImageRole = "base" | "reference" | "inject";

/** One image the user has staged in the wizard, before the project is created. */
export interface StagedImage {
  /** The library image id, once uploaded. */
  imageId: string;
  publicId: string | null;
  deliveryUrl: string;
  filename: string;
  role: ImageRole;
  /** What this picture is for — "the island we want", "the fabric". */
  note: string;
}

/** The three inheritable text settings, already resolved on the source folder. */
export interface ClonedSettings {
  defaultPrompt: string | null;
  contextText: string | null;
  useCase: string | null;
}

/**
 * Where a new project's settings come from.
 *
 * The clone variant carries the RESOLVED settings, not just the folder id. They
 * used to live in component state beside the draft, which meant a draft saved on
 * step 4 and restored later had a clone source with nothing behind it: `create()`
 * skipped the settings PUT entirely and silently, while the review step still
 * said "Cloned from X". Anything `create()` needs belongs in the draft, because
 * the draft is the thing that survives a reload.
 *
 * `settings: null` means "chosen but not resolved yet" — `create()` refuses
 * rather than quietly writing nothing.
 */
export type SettingsSource =
  | { kind: "inherit" }
  | { kind: "clone"; folderId: string; settings: ClonedSettings | null }
  | { kind: "custom" };

export interface OnboardingDraft {
  name: string;
  parentFolderId: string | null;
  assets: AssetRow[];
  images: StagedImage[];
  useCase: string;
  scenario: string;
  defaultPrompt: string;
  contextText: string;
  settingsSource: SettingsSource;
  savedAt?: string;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  name: "",
  parentFolderId: null,
  assets: [],
  images: [],
  useCase: "",
  scenario: "",
  defaultPrompt: "",
  contextText: "",
  settingsSource: { kind: "inherit" },
};

const KEY = "core-ai-tools:onboarding-draft";

/**
 * Read the saved draft, if any.
 *
 * @returns The draft, or null when nothing is saved or the stored value is
 *   unreadable (a shape change should lose a draft, never crash the wizard).
 */
export function loadDraft(): OnboardingDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? ({ ...EMPTY_DRAFT, ...JSON.parse(raw) } as OnboardingDraft) : null;
  } catch {
    return null;
  }
}

/** Persist the draft. Failure is silent: saving a draft must never block the wizard. */
export function saveDraft(draft: OnboardingDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* storage full or blocked — the wizard still works, the draft just isn't kept */
  }
}

/** Forget the draft — called once the project is actually created. */
export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** The use cases this product actually implements, not an aspirational list. */
export const USE_CASES = [
  { id: "edit", label: "Edit a photo", hint: "Change part of a picture, keep the rest." },
  { id: "refinish", label: "Refinish / restyle", hint: "Same subject, different materials or finish." },
  { id: "generate", label: "Generate from scratch", hint: "No source picture — start from a prompt." },
  { id: "compare", label: "Compare models", hint: "Run one intent across several models." },
] as const;

/** The scenarios that change how a prompt should be written. */
export const SCENARIOS = [
  { id: "home-remodel", label: "Home remodel", hint: "Rooms, materials, fixtures." },
  { id: "try-it-on", label: "Try it on", hint: "A garment or product on a person." },
  { id: "creative", label: "Creative exploration", hint: "No fixed subject." },
  { id: "other", label: "Something else", hint: "Describe it in the context box." },
] as const;
