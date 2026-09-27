/**
 * @fileoverview The theme toggle, at the foot of the rail.
 *
 * It reads the same rule the boot script does (`@/lib/theme`): dark unless this
 * browser was explicitly set to light. It does NOT consult
 * `prefers-color-scheme`, and it does NOT write to storage on mount — doing both
 * is what silently turned this dark-first app light on every machine whose OS
 * prefers light. See `lib/theme.ts` for the whole story.
 */

import { MoonIcon, SunIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { applyTheme, initialTheme, readStoredTheme, storeTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";

export const ThemeToggle: React.FC = () => {
  // Start from the rule, not from the OS. On the server this is "dark", which is
  // what `<html class="dark">` already says, so hydration does not flash.
  const [theme, setTheme] = React.useState<Theme>(() => initialTheme(readStoredTheme()));

  // Re-read once on mount: SSR cannot see this browser's storage, so a user who
  // did choose light gets it applied here rather than staying dark.
  React.useEffect(() => {
    const stored = initialTheme(readStoredTheme());
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      applyTheme(next);
      // Written only here: this is the one place the user has actually chosen.
      storeTheme(next);
      return next;
    });
  };

  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      className="text-white/90 hover:bg-white/10 hover:text-white"
    >
      {isDark ? (
        <MoonIcon className="size-4" aria-hidden="true" />
      ) : (
        <SunIcon className="size-4" aria-hidden="true" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};
