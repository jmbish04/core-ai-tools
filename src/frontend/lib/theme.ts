/**
 * @fileoverview The one rule that decides the theme.
 *
 * Dark is not a preference in this product, it is the default (`~/AGENTS-frontend.md`).
 * So the rule is: dark unless this browser has explicitly been told light. The
 * OS setting is never consulted.
 *
 * This is a module rather than four lines inside the toggle because it was
 * getting it wrong that broke the app: `ShellLayout`'s boot script applies the
 * rule correctly at first paint, but `ThemeToggle` — which hydrates in the rail
 * on EVERY page — seeded its state from `prefers-color-scheme` and then, in an
 * effect, wrote that back to `<html>` and to `localStorage`. On any machine whose
 * OS prefers light (a headless browser included), the whole dark-first app
 * flipped to light one tick after load and stayed there, because the effect had
 * persisted `theme: "light"` on the way past. The boot script had already been
 * fixed for exactly this; the toggle that overrode it had not.
 *
 * Keep both sides reading from here, and test the rule rather than the toggle.
 */

export type Theme = "light" | "dark";

/** Where the preference is kept. Shared with the inline boot script by value. */
export const THEME_STORAGE_KEY = "theme";

/**
 * The theme to render, given whatever is stored for this browser.
 *
 * @param stored The raw `localStorage` value: `null` when nothing is stored, and
 *   any string when something unrecognised is (storage is shared and can hold
 *   anything).
 * @returns `"light"` ONLY for an explicit, exact `"light"`. Everything else —
 *   nothing stored, a stale value, a value from another app — is dark.
 * @example initialTheme(null) // → "dark"
 * @example initialTheme("light") // → "light"
 * @example initialTheme("system") // → "dark"
 */
export function initialTheme(stored: string | null | undefined): Theme {
  return stored === "light" ? "light" : "dark";
}

/**
 * Read the stored preference, tolerating a browser that refuses storage.
 *
 * @returns The stored string, or null when nothing is stored or storage throws
 *   (private mode, blocked site data) — both of which mean "no preference".
 */
export function readStoredTheme(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a preference the user actually expressed.
 *
 * Only ever called from the toggle's click handler. Writing on mount is what
 * made the OS fallback permanent: one hydration on a light-preferring machine
 * and the choice was recorded as if the user had made it.
 */
export function storeTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage blocked — the toggle still works for this page view */
  }
}

/** Apply a theme to `<html>`. The class is what every Tailwind dark: rule reads. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}
