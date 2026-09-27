/**
 * The shell's navigation contract.
 *
 * `ShellLayout` marks a rail item current by comparing its `section` prop to the
 * `id` of a record in the app shell block's own rail data. Nothing enforces that
 * at the type level — `section` is a string — so a typo, or a section a page
 * invents, silently produces a page where NOTHING in the rail is highlighted.
 * That is invisible in SSR markup, invisible to an API probe, and easy to miss
 * in a screenshot if you are looking at the page body.
 *
 * So: every section `shellNavFor` can return must exist in the rail (except
 * `home`, which deliberately matches nothing), every pill item must point at a
 * route that exists, and every route with a pill must mark one of its own items
 * current. Those are the three ways this can be wrong.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  ASSISTANT_SUBNAV,
  DOCS_SUBNAV,
  OPS_SUBNAV,
  WORKSPACE_SUBNAV,
  shellNavFor,
} from "@/lib/nav";
import type { TestEnv } from "./env";

/**
 * The REAL rail ids, extracted from
 * `components/blocks/app-shell-22/components/data.tsx` by `vitest.config.mts`
 * and handed over as a binding. That module is TSX importing lucide-react, which
 * the workers pool cannot load, so it is read rather than imported — but read,
 * not transcribed: a transcribed copy would agree with itself forever while the
 * rail moved underneath it.
 */
const RAIL_IDS = (env as unknown as TestEnv).RAIL_SECTION_IDS;

/** Every route a page exists for, and what the rail should say about it. */
const PAGES: { path: string; section: string }[] = [
  { path: "/", section: "home" },
  { path: "/folders", section: "folders" },
  { path: "/library", section: "library" },
  { path: "/assets", section: "assets" },
  { path: "/assets/asset_123", section: "assets" },
  { path: "/sessions", section: "sessions" },
  { path: "/sessions/2f0c5f1e-0000-4000-8000-000000000000", section: "sessions" },
  { path: "/compare", section: "compare" },
  { path: "/projects/new", section: "new" },
  { path: "/models", section: "models" },
  { path: "/prompts", section: "models" },
  { path: "/docs", section: "docs" },
  { path: "/connect", section: "docs" },
  { path: "/chat", section: "assistant" },
  { path: "/assistant", section: "assistant" },
  { path: "/settings", section: "settings" },
  { path: "/settings/preferences", section: "settings" },
  { path: "/settings/webhooks", section: "settings" },
];

describe("shell navigation", () => {
  it("reads the rail's own ids, so the list below cannot be a stale copy", () => {
    // If the extraction ever silently returns nothing, every other assertion
    // here would pass vacuously.
    expect(RAIL_IDS.length).toBeGreaterThanOrEqual(8);
    expect(RAIL_IDS).toContain("folders");
    expect(RAIL_IDS).toContain("settings");
  });

  it("gives every page a section the rail can actually highlight", () => {
    for (const page of PAGES) {
      const nav = shellNavFor(page.path);
      expect({ path: page.path, section: nav.section }).toEqual({
        path: page.path,
        section: page.section,
      });
      if (nav.section !== "home") {
        expect(RAIL_IDS, `no rail record for "${nav.section}" (${page.path})`).toContain(
          nav.section,
        );
      }
    }
  });

  it("marks one of its own pill items current wherever a pill is drawn", () => {
    for (const page of PAGES) {
      const nav = shellNavFor(page.path);
      if (nav.subnav.length === 0) {
        // No pill: `subnavCurrent` must be empty too, or the block would look
        // for an item that is not there.
        expect({ path: page.path, current: nav.subnavCurrent }).toEqual({
          path: page.path,
          current: "",
        });
        continue;
      }
      expect(
        nav.subnav.map((i) => i.id),
        `"${nav.subnavCurrent}" is not in the pill drawn on ${page.path}`,
      ).toContain(nav.subnavCurrent);
    }
  });

  it("only ever points the pill at a route a page exists for", () => {
    const known = new Set(PAGES.map((p) => p.path));
    for (const item of [
      ...WORKSPACE_SUBNAV,
      ...OPS_SUBNAV,
      ...DOCS_SUBNAV,
      ...ASSISTANT_SUBNAV,
    ]) {
      expect(known, `pill item "${item.label}" links to ${item.href}, which has no page`).toContain(
        item.href,
      );
    }
  });

  it("treats a trailing slash as the same route", () => {
    expect(shellNavFor("/folders/")).toEqual(shellNavFor("/folders"));
    expect(shellNavFor("/")).toEqual(shellNavFor(""));
  });

  it("falls back to home rather than highlighting the wrong section", () => {
    // A 404, or a route added without a nav entry, must not claim to be Folders
    // (the shell's own default) — that tells the user they are somewhere else.
    expect(shellNavFor("/nope").section).toBe("home");
    expect(shellNavFor("/foldersomething").section).toBe("home");
  });
});
