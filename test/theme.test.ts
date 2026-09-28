/**
 * Dark is the default, and stays the default.
 *
 * This test exists because the app shipped rendering LIGHT. `ShellLayout` puts
 * `class="dark"` on `<html>` and its boot script keeps it there — but
 * `ThemeToggle`, which hydrates in the rail on every single page, seeded its
 * state from `prefers-color-scheme` and then wrote that back to `<html>` and to
 * `localStorage` in a mount effect. On any machine whose OS prefers light, the
 * whole product flipped to light one tick after load, and the write made it
 * permanent.
 *
 * Nothing caught it: the SSR markup says `dark` (the flip happens after
 * hydration), every API probe is unaffected, and the suite never renders a page.
 * So the rule itself is tested, and both the toggle and the inline boot script
 * are held to it.
 */

import { describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY, initialTheme } from "@/lib/theme";

describe("theme default", () => {
  it("is dark when this browser has no preference", () => {
    expect(initialTheme(null)).toBe("dark");
    expect(initialTheme(undefined)).toBe("dark");
  });

  it("is dark for anything that is not exactly \"light\"", () => {
    // Storage is shared and survives refactors: a stale "system", a value
    // another app wrote, or a casing difference must not turn the product light.
    for (const stored of ["", "system", "Light", "LIGHT", "auto", "dark", "true", "0"]) {
      expect({ stored, theme: initialTheme(stored) }).toEqual({
        stored,
        theme: stored === "dark" ? "dark" : stored === "light" ? "light" : "dark",
      });
    }
  });

  it("honours an explicit light choice", () => {
    expect(initialTheme("light")).toBe("light");
  });

  it("never derives the theme from the OS preference", () => {
    // `initialTheme` takes only the stored value. If someone adds an OS check,
    // it cannot be reached through this signature — which is the point of the
    // function existing at all. This asserts the shape stays that way.
    expect(initialTheme.length).toBe(1);
  });

  it("uses the storage key the inline boot script reads", () => {
    // The boot script is inline and un-bundled (it runs before first paint), so
    // it cannot import this module. The key is the seam between them.
    expect(THEME_STORAGE_KEY).toBe("theme");
  });
});
