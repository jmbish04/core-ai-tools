---
date: 2026-09-27
status: open
owner: Justin
tags: [frontend, settings, theme]
---

# `/settings/preferences` stores a theme that nothing reads

## What I found

Fixing the app rendering light (see below) meant establishing one rule for the theme:
`lib/theme.ts#initialTheme` — **dark unless this browser explicitly stored `"light"`**, and
the OS preference is never consulted. The rail's toggle and `ShellLayout`'s inline boot
script both follow it, and `test/theme.test.ts` holds them to it.

While doing that I found a second, older theme control that has never been connected to
anything:

- `db/schemas/settings/preferences.ts` has `theme text NOT NULL DEFAULT 'system'`, described
  as "Color scheme: system, light, or dark."
- `PUT /api/settings/preferences` accepts and persists it.
- `/settings/preferences` renders a Theme select bound to it, and saving reports success.
- **Nothing reads it.** `grep` for a consumer finds only `ui/chart.tsx`, which uses an
  unrelated per-series `theme` key. The shell's appearance comes entirely from
  `localStorage`, written by the rail toggle.

So a user can set Theme to Light on the settings page, see "Saved", and watch nothing
change — and the column's default is `system`, which is precisely the follow-the-OS
behaviour the shell now deliberately refuses.

## Why it matters

Three reasons, in order of how much they cost:

1. **A control that reports success and does nothing is worse than a missing control.** The
   user has no way to tell it did not work, so the next thing they do is doubt the rest of
   the settings page.
2. **The default encodes the opposite of the product's rule.** `system` in D1 versus "dark
   unless told otherwise" in `lib/theme.ts`. Whoever wires this up next will read the
   column's default as the intended behaviour and reintroduce the exact bug that was just
   fixed — the whole dark-first app flipping to light on any machine whose OS prefers
   light, permanently, because the toggle persisted the OS answer on mount.
3. **It is a genuine product question, not a cleanup.** Should appearance be per-account
   (stored in D1, so it follows the user to another browser) or per-browser (localStorage,
   which is what works today)? They are different products, and the answer decides whether
   this row is wired up or removed.

## Options

1. **(Recommended) Delete the Theme row from `/settings/preferences`, keep the toggle in
   the rail.** Appearance is per-browser, which is how every other dark-first app behaves
   and how this one already behaves. Leave the column in place (migrations only ever stack)
   but stop surfacing it, and note in the schema description that it is unused. Smallest
   change, and it removes the lie immediately.
2. **Wire it up as the source of truth: D1 preference → shell.** Appearance follows the
   account. Needs the preference read during SSR and written into `ShellLayout`'s boot
   script (the script runs before first paint and cannot fetch), the rail toggle writing
   through to the API, and a decision about what `system` means given the dark-first rule —
   probably that the option is dropped, leaving light/dark.
3. **Leave it.** Zero work, and the settings page keeps claiming to do something it does
   not. Not recommended; it is the kind of thing that erodes trust in the page it sits on.

## What I did not do

I did not touch it. Removing a settings control and changing what a stored preference means
are product calls, and option 2 in particular changes where appearance lives. The theme bug
I actually fixed — the toggle overriding the boot script — is unrelated to this row and is
fixed independently of whichever option you pick.
