/**
 * @fileoverview The shell's navigation, in one place.
 *
 * Every product route renders inside `ShellLayout`, which needs a rail
 * `section` and the pill nav's `subnav`. Those arrays used to be re-declared
 * verbatim at the top of each page, so `/folders`, `/assets` and `/compare`
 * each carried their own copy of the same three links — three places to edit
 * and three chances to drift. They live here now, and a page passes
 * `...shellNavFor(Astro.url.pathname)`.
 *
 * `section` ids MUST match a record in the app shell's own rail data
 * (`components/blocks/app-shell-22/components/data.tsx`) or nothing is marked
 * current. `"home"` is deliberately not a rail record: the landing page is
 * reached through the brand mark, and highlighting a workspace section there
 * would say the user is somewhere they are not.
 */

/** A pill-nav entry. Mirrors the block's `NavRecord`, kept structural on purpose. */
export interface SubnavItem {
  id: string;
  label: string;
  href: string;
}

/** Rail section ids. `home` matches no rail record, so nothing is marked current. */
export type ShellSection =
  | "home"
  | "folders"
  | "library"
  | "assets"
  | "sessions"
  | "compare"
  | "new"
  | "models"
  | "docs"
  | "assistant"
  | "settings";

/** The work itself: the folder tree, the images in it, and what came out. */
export const WORKSPACE_SUBNAV: SubnavItem[] = [
  { id: "folders", label: "Folders", href: "/folders" },
  { id: "library", label: "Images", href: "/library" },
  { id: "assets", label: "Assets", href: "/assets" },
  { id: "sessions", label: "Sessions", href: "/sessions" },
  { id: "compare", label: "Compare models", href: "/compare" },
];

/** The machinery a run is configured from. */
export const OPS_SUBNAV: SubnavItem[] = [
  { id: "models", label: "Models", href: "/models" },
  { id: "prompts", label: "Prompts", href: "/prompts" },
];

/** How to read this thing, and how to drive it from an MCP client. */
export const DOCS_SUBNAV: SubnavItem[] = [
  { id: "docs", label: "Docs", href: "/docs" },
  { id: "connect", label: "Connect over MCP", href: "/connect" },
];

/** The general assistant, which is not the folder agent. */
export const ASSISTANT_SUBNAV: SubnavItem[] = [
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "assistant", label: "Threads", href: "/assistant" },
];

/** What `ShellLayout` needs to draw its chrome for one route. */
export interface ShellNav {
  section: ShellSection;
  subnav: SubnavItem[];
  subnavCurrent: string;
}

/**
 * Longest-prefix route table. Order matters only in that a more specific path
 * must come before its parent — `/sessions/…` before `/sessions` is handled by
 * matching on prefix, so the list stays flat.
 */
const ROUTES: { prefix: string; nav: ShellNav }[] = [
  { prefix: "/folders", nav: { section: "folders", subnav: WORKSPACE_SUBNAV, subnavCurrent: "folders" } },
  { prefix: "/library", nav: { section: "library", subnav: WORKSPACE_SUBNAV, subnavCurrent: "library" } },
  { prefix: "/assets", nav: { section: "assets", subnav: WORKSPACE_SUBNAV, subnavCurrent: "assets" } },
  { prefix: "/sessions", nav: { section: "sessions", subnav: WORKSPACE_SUBNAV, subnavCurrent: "sessions" } },
  { prefix: "/compare", nav: { section: "compare", subnav: WORKSPACE_SUBNAV, subnavCurrent: "compare" } },
  { prefix: "/projects/new", nav: { section: "new", subnav: [], subnavCurrent: "" } },
  { prefix: "/models", nav: { section: "models", subnav: OPS_SUBNAV, subnavCurrent: "models" } },
  { prefix: "/prompts", nav: { section: "models", subnav: OPS_SUBNAV, subnavCurrent: "prompts" } },
  { prefix: "/docs", nav: { section: "docs", subnav: DOCS_SUBNAV, subnavCurrent: "docs" } },
  { prefix: "/connect", nav: { section: "docs", subnav: DOCS_SUBNAV, subnavCurrent: "connect" } },
  { prefix: "/chat", nav: { section: "assistant", subnav: ASSISTANT_SUBNAV, subnavCurrent: "chat" } },
  { prefix: "/assistant", nav: { section: "assistant", subnav: ASSISTANT_SUBNAV, subnavCurrent: "assistant" } },
  // Settings renders its own richer sub-navigation (`SettingsNav`, with
  // descriptions) in a left column, so the pill stays empty rather than
  // printing the same five links twice.
  { prefix: "/settings", nav: { section: "settings", subnav: [], subnavCurrent: "" } },
];

const HOME: ShellNav = { section: "home", subnav: [], subnavCurrent: "" };

/**
 * The shell chrome for a pathname.
 *
 * @param pathname `Astro.url.pathname`, with or without a trailing slash.
 * @returns The rail section and pill items, spreadable straight into `ShellLayout`.
 * @example <ShellLayout title="Sessions" {...shellNavFor(Astro.url.pathname)}>
 */
export function shellNavFor(pathname: string): ShellNav {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "") return HOME;
  // Longest prefix wins, so `/projects/new` beats a future `/projects`.
  const match = ROUTES.filter((r) => path === r.prefix || path.startsWith(`${r.prefix}/`)).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0];
  return match ? match.nav : HOME;
}
