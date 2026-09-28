# Frontends — ReUI is the default, everywhere

> Part of the workstation briefing. **`~/AGENTS.md` is the parent — read it first**;
> it carries the rules that apply everywhere (secrets, backups, how to write to
> Justin, when to flag). This file adds the rules for **any user interface**. If
> the UI ships on a Worker, also load `~/AGENTS-cloudflare-workers.md` — it owns
> the MCP, icon, and deploy rules this file defers to.

---

# One frontend, three runtimes, zero porting

There is exactly **one** frontend stack, and it is deliberately portable so the
same UI runs on **any** backend without rewriting the frontend:

| | Backend runtime | Frontend |
|---|---|---|
| **Cloudflare Workers** | Hono + zod-openapi + Drizzle/D1 | Astro + React + **ReUI** |
| **Python FastAPI** | FastAPI + Pydantic + SQLite | Astro + React + **ReUI** (same `src/`) |
| **Python Flask** | Flask + SQLite | Astro + React + **ReUI** (same `src/`) |

The **frontend does not care** what serves `/api`. Only the backend half differs.
This is why "port this to a Worker" must be a backend change, never a frontend
rewrite — the shell, the blocks, the theme, and the components travel as-is.

Never start a UI from scratch; never re-decide the stack per project. Copy the
template, then adapt:

```bash
bash ~/.colby-ecosystem/frontend/install.sh
```

Stack, locked:
- **Astro + React islands** — SSR + only ship JS that must be interactive
- **ReUI** (`@reui`, Pro) — the design system and block library
- **shadcn/ui** primitives — ReUI builds on them
- **Tailwind CSS v4** + `tw-animate-css`
- **mcpcn** (`@mcpcn`, public, no key) — MCP App UI blocks, for tool results a
  person reads. Both registries ship in the template's `components.json`, and
  `install.sh` adds `@mcpcn` to an existing one. See "MCP servers" in
  `~/AGENTS-cloudflare-workers.md`.
- **PNPM is the default package manager.** Use `pnpm` for installs, `pnpm dlx
  shadcn@latest add`, `pnpm run <script>`, `pnpm run test`. Never `npm`/`yarn`/`bun`.

---

# ReUI is the default design system — and it is non-negotiable

**The style is ALWAYS the default ReUI theme with dark enabled. Never deviate
from it.** No custom palettes, no restyled blocks, no light-mode override, no
hand-rolled "brand" theme. ReUI's default theme *is* the brand.

- `<html lang="en" class="dark">` — dark is the default and the only default.
- The header ships the theme toggle, but the app **starts dark** and stays dark
  unless a user flips it in the shell. Never force light, never add a light-first
  layout.
- **Do not restyle what ReUI already provides.** The ReUI workflow is
  *reuse-first*: wire real data and the existing theme into a block. Adapt by
  *reuse*, never by hand-rolling or recoloring a component to "fit" the project.
- **Surface `frame`** — locked project-wide. Pass `surface: "frame"` on **every**
  ReUI MCP search so blocks stay visually consistent. Never mix `frame` and
  `card` blocks on one screen.

**Better Design and ReUI are two jobs, not two options.** `~/.claude/CLAUDE.md`
carries a tool-injected block telling agents to reach for the Better Design MCP on
any UI work. That stands — with the boundary stated here:

| Better Design MCP owns | ReUI + the design system own |
|---|---|
| product discovery: what this screen is for, who reads it, what decision it supports | the component vocabulary — every control, grid, chart and shell |
| the user journey and information architecture: what belongs on a page, in what order, what is a separate route | tokens, theme, density, radius, spacing |
| turning data into *information*: is this intake or display, what does the reader do next | how a value is rendered (see "Data to interface" in the design system) |
| UX review after the fact (`get-review-rules`, `get-ux-principle`) | which block implements the thing Better Design described |

**`find-design-system` and `create-design-system` never run.** The design system
exists, it is bought and paid for, and a second one is the drift this whole file
prevents. When Better Design proposes a layout, translate it into ReUI blocks —
name them from the catalogue and install them; do not let it generate a kit, a
palette or a component set.

Feed it the vocabulary. A journey described against "a dashboard" comes back
generic; a journey described against *the ReUI catalogue* — the 8 dashboards, 15
stats panels, 30 chart cards, 37 Data Grid blocks — comes back as something
installable, and those blocks are themselves well-designed user journeys worth
borrowing from.

**Why this boundary is drawn so hard.** The failures that made ReUI necessary were
never "the agent had no design opinion" — they were: currency rendered as
`8232563.021`, storage in bytes because D1 stored bytes, a stat card overflowing
with an eleven-digit number, "grouping" hand-rolled onto a plain table when the
Data Grid ships it, a filter strip of badges scrolling off an iPhone instead of the
Filters builder that was asked for, tags collected as a comma-separated string
against a schema that had a `tags` table, black axis labels on a dark chart, and
two screens in one app at different densities. Every one of those is a
*component-and-data* failure, which is the ReUI half. **The design system's "Data
to interface" section is the fix, and it is mandatory reading before building any
screen backed by a table.**

**The app shell is a ReUI block — which one is a decision you make per app.**
There is no default shell, and there never should be: pick the shell that fits
what this app actually is, from the app-shell block page. What is fixed is that
it *comes from ReUI*. A hand-rolled shell is the single most common way an agent
ends up rebuilding what ReUI already ships, and then asking about ReUI later as
though the shell were a separate question. It is not — the shell is the first
ReUI decision, not an exception to it.

- Read `https://reui.io/blocks/application/app-shell` **before** choosing. Every
  shell there has a live preview, its constituent components, and a one-line
  description in the page's end-of-page summary. Read those descriptions; that is
  what they are for.
- Match the topology to the product: an icon rail with per-section secondary nav
  suits a broad app with many sections; a three-region resizable layout suits an
  ops workbench; an inset or floating shell suits a focused single-purpose tool.
- **Strip what the app has no use for**, whichever shell you picked — the
  workspace/project selector and the user avatar menu are the usual two (these
  apps have no users; the theme toggle moves to the header).

---

# The design system — read it before the first component

ReUI is the registry. **"ReUI Astro React" is the design system built on top of
it**, and it is where the decisions that are NOT in the ReUI docs live: the token
set in both themes, the shell contract, the per-page responsive strategy, the
documentation and Mermaid rules, the chart doctrine, and the `AGENTS.md` a repo
gets at its root.

**https://claude.ai/artifact/74kf88M44NMA7Xh769vJge**

Read it with the Artifact tool — `action: "read"`, `path: "project/README.md"`
first, which indexes everything else. Never web-fetch it. Never re-derive what it
already decided.

What it carries, and when you need it:

| Section | Read it when |
|---|---|
| `project/tokens.json` | any colour, spacing, radius or type decision — 39 colours in light + dark, shadcn base plus ReUI's nine extended tokens, each with a usage note |
| Setting up ReUI | a new repo: React 19, Tailwind v4, `components.json`, token install order |
| The registry, and the licence key | the tokens-CLI and Secret-Store paths (the same two this file describes) |
| Surface mode and consistency | the drift audit to run after every block install |
| Responsive strategy | **every page** — the per-platform plan that replaces the default stack |
| Charts | before any visualization: no pies, horizontal bars, the three dashboard layers |
| Pro blocks · the block catalogue · AI, agent and Data Grid blocks | picking blocks — all 543 by install name, with what each family actually solves |
| Agent instructions | the `AGENTS.md` template that goes at a repo root |
| The bundle (`window.ReUIAstro`) | `AppShell`, `MetricStrip`, `DataGridFrame`, `Surface`, `Alert`, `Badge`, `Button`, `StatTile`, `StatusDot` — the connective tissue between installed blocks |

Where it and this file agree, they agree on purpose: surface `frame`, dark
default, pnpm, the key from the tokens CLI or the Secret Store. **Where a project
question is not answered here, the design system answers it** — and if the two
ever disagree, this file wins and the design system gets corrected in the same
session.

---

# Adopting a repo — new, and not-yet-adopted

## A new repo: configure it correctly, first commit

1. `bash ~/.colby-ecosystem/frontend/install.sh` — stack, `components.json`, both
   registries, the key resolved from the tokens CLI.
2. Compile the design system's tokens into the project's `tokens.css` / theme
   layer **before installing any component**. Installing first means retokening
   every file by hand afterwards.
3. Drop the design system's `AGENTS.md` at the repo root (its "Agent instructions"
   section is the template) and fill in the project-specific lines.
4. Pick the app shell from the block catalogue; strip what the app has no use for.
5. Wire `/docs`, `/openapi.json`, `/scalar`, `/swagger` into the nav — these are
   already in "What every app ships"; the shell contract is what enforces them.

## An existing repo that has not adopted it — ask once, then respect the answer

A repo qualifies as **not yet adopted** when any of these is true: no `@reui`
entry in `components.json`; hand-rolled `<table>`s where a Data Grid belongs; raw
hex or Tailwind palette utilities (`text-gray-500`, `bg-slate-800`) in components;
no root `AGENTS.md`; a light-first or custom theme.

**On the first session where you touch that repo's frontend, ask Justin — once:**

> This repo hasn't adopted the ReUI design system. Want me to run a full frontend
> audit and build a retrofit plan (epics + tasks recorded on colby-maestro)?
> 1. **Yes — audit and plan** (recommended): I inventory every page, component
>    and token, then file the plan. Nothing is changed until you approve it.
> 2. **No** — I record the decision in the repo's `AGENTS.md` so no agent asks
>    again; ask me explicitly if you want it later.
> 3. **Not now, ask me next time** — I leave it open.
>
> If you say nothing, I continue the task you asked for and leave the repo as it is.

Ask as plain text in the conversation.

### If YES — the audit, then the plan, both recorded

**Audit** (read-only; no edits during this phase):

| Dimension | What you record |
|---|---|
| Inventory | every route/page, every component file, which are hand-rolled vs installed |
| Tokens | every raw hex, `rgb()`, and Tailwind palette utility, by file and line |
| Components | hand-rolled tables, selects, modals, steppers, date pickers — each mapped to the ReUI component or block that replaces it |
| Shell | what the current nav is, whether `/docs`, `/openapi.json`, `/scalar`, `/swagger` exist and are linked |
| Responsive | which pages have a real per-platform strategy and which just stack |
| Charts | every pie and vertical bar (both are replacements under the standing preferences) |
| Theme | whether dark is the default and whether both themes actually render |
| Accessibility | suppressed focus rings, colour-only status, unlabelled controls |

**Plan** — one epic per dimension above that has findings, tasks under it sized to
one page or one component family each, ordered so tokens land first (everything
else depends on them), then the shell, then page-by-page. Each task names the
block or component that replaces what is there, from the design system's catalogue.

**Record it on colby-maestro** — the plan lives there, not in a chat transcript.
Use the session's `mcp__colby-maestro__*` tools (pre-approved; no need to ask):
the repo slug as `project_key`, an epic as a parent task, each retrofit item as a
child, `task_type` and `priority` on every one, tagged `reui,retrofit`. The audit
findings go in the epic's worklog so the evidence travels with the plan. If the
MCP is not in this session, fall back to the Worker's REST API — both shapes are
in `~/AGENTS-maestro.md`. Then tell Justin what you filed, and stop: the retrofit
executes only when he says so.

### If NO — record it so nobody asks again

Write the decision into the repo's root `AGENTS.md` (create it if absent) so every
future session reads it instead of re-asking:

```markdown
## ReUI design system

**Retrofit: declined by Justin on <YYYY-MM-DD>.** This repo's frontend predates the
ReUI Astro React design system (https://claude.ai/artifact/74kf88M44NMA7Xh769vJge)
and is not being migrated. Do not offer an audit or a retrofit plan again — Justin
will ask explicitly if he wants one.

New code added to this repo still follows the design system where it does not
require touching existing screens: tokens over raw colour, ReUI components over
hand-rolled ones, no pie charts, horizontal bars.
```

That block is the whole point of asking once: a declined offer that keeps
returning every session is the same as not having asked. "Not now" gets nothing
written — that is what leaves it open.

---

# The ReUI license key — one name, two places

`REUI_LICENSE_KEY` (Pro) is the single credential that authenticates ReUI. It
lives in the tokens CLI locally **and** in the Cloudflare Secret Store under the
**same name** — resolve the name once, use it on both sides.

## Local: tokens CLI

Resolve at install time — never paste the key into a repo file, never a `.env`,
never hardcode it. The `install.sh` already does this:

```bash
tokens find REUI_LICENSE_KEY                       # verify it exists (names only)
export REUI_LICENSE_KEY="$(tokens show REUI_LICENSE_KEY --value-only)"
```

`components.json` authenticates the `@reui` registry with it. **Two separate
things make a Pro block 401, and fixing only one leaves you stuck.**

**1. No header.** `shadcn registry add @reui` writes the bare URL with no
Authorization header.

**2. The redirect — and this is the one that looks like a bad licence key.**
`https://reui.io/r/{style}/{name}.json` answers **307** to
`/r/styles/{style}/{name}.json?v=<deployment>`, and **the shadcn CLI drops the
Authorization header across that redirect**. Every install then fails with *"You
are not authorized to access the item"* while `curl -L` with the same key returns
200. The fix is to write the **already-redirected, versioned** URL:

```jsonc
{
  "registries": {
    "@reui": {
      "url": "https://reui.io/r/styles/{style}/{name}.json?v=dpl_...",
      "headers": { "Authorization": "Bearer ${REUI_LICENSE_KEY}" }
    }
  }
}
```

Do not write that `v` by hand. **`reui-registry`** (`~/.local/bin/reui-registry`)
resolves the current deployment id off the redirect and writes it for you. The
`shadcn()` wrapper in `.zshrc` runs it after `init`/`create`; the agent
SessionStart hook runs it **read-only** (`--check --quiet`) and only tells you
when a repo needs pinning — it never rewrites `components.json` behind you:

```bash
reui-registry .            # pin this repo
reui-registry . --check    # report only; exit 1 if it needs patching
```

`v` is ReUI's deployment id, so it changes whenever they ship. **When an install
starts 401ing again, ReUI has redeployed — re-run `reui-registry`.** If it cannot
reach reui.io it leaves an existing pin alone rather than reverting it, and says
`UNPINNED` when it had to fall back to the bare URL.

For scripts, unit tests, and `.mjs` tooling, use the first-party SDK instead of
shelling out to `tokens show`:

```bash
tokens agent-onboarding --scaffold-mjs    scripts/tokens.mjs
tokens agent-onboarding --scaffold-python utils/tokens.py
```

```js
import { requireSecret } from "./tokens.mjs";
const reuiKey = requireSecret("REUI_LICENSE_KEY");
```

**Use the Pro MCP server.** `mcp__reui__*` is the licensed one;
`mcp__claude_ai_reui__*` is the free tier and will not see Pro blocks. If a
session has both, prefer `mcp__reui__*`.

The ReUI MCP reads the key from `.env.local` for premium installs (blocks need
Pro or Ultimate; icons and templates need Ultimate). Free items — the 22
components and all `c-*` examples — install with **no license at all**.

## Cloudflare Worker: Secret Store binding

The frontend of a Worker authenticates with ReUI via a **Secret Store binding**
of the same name. Declare it in `wrangler.jsonc`:

```jsonc
{
  "secrets_store_secrets": [
    {
      "binding": "REUI_LICENSE_KEY",
      "store_id": "8c42fa70938644e0a8a109744467375f",
      "secret_name": "REUI_LICENSE_KEY"
    }
  ]
}
```

A Secret Store binding is an **object**, not a string — read it through the
scaffolded helper, never `=== env.REUI_LICENSE_KEY`:

```bash
tokens agent-onboarding --scaffold-worker src/backend/utils/secrets.ts
wrangler types
```

```typescript
import { requireSecret, getSecret } from "@/backend/utils/secrets";

// In a route / handler that needs to auth a ReUI call on the backend:
const reuiKey = await requireSecret(env, "REUI_LICENSE_KEY"); // throws if unresolvable
```

> **The trap (same as `WORKER_API_KEY`):** `apiKey === env.REUI_LICENSE_KEY` is
> `string === object`, so it is **always false**, and
> `sha256Hex(env.REUI_LICENSE_KEY)` hashes `"[object Object]"`. Go through
> `utils/secrets.ts`, which also falls back to a plain env var so the same call
> site works in `wrangler dev` and in production.

Live examples of the binding-in-practice live across `/Volumes/Projects/workers`
— `colby-maestro/wrangler.jsonc` binds `REUI_LICENSE_KEY` from the Secret Store,
and `core-bridge` ships ReUI blocks (`Frame`, `FramePanel`, `Badge`, `DataGrid`)
from `@/components/reui/` on a single Worker.

---

# Consult the ReUI MCP — always, and before writing code

The **ReUI MCP** (`mcp__reui__*`) is the consultation layer for every ReUI
decision. Do not guess a component API, do not invent a block name, do not
hand-roll a prop from memory. The workflow is:

```
search ──▶ get_component (read the real API BEFORE writing props)
     ──▶ get_install_command (exact pnpm/shadcn CLI command)
     ──▶ adapt by REUSE (wire real data + theme; never restyle)
     ──▶ validate_usage (catch invented props/names before code)
     ──▶ get_audit_checklist (production-quality checks)
```

The tools, in the order they are used:

| Tool | When |
|---|---|
| `search` | Every ReUI/shadcn request. Pass `surface: "frame"`. Returns ranked items with `installCommand`, `docsUrl`, live `previewUrl`, `componentsUsed`, `dependencies`, `free`/`requiredPlan`, and a score. **Share `previewUrl` with the user so they can SEE a block before it is installed.** |
| `get_component` | Read one or more components' inline API (props + usage). Pass an **array** of names to read several APIs in one call. Never write props before this. |
| `get_examples` | Copy a free `c-*` worked example's exact composition — the fastest correct path. |
| `get_install_command` | The exact `shadcn` CLI command for the project's package manager (**pnpm**). Validates the item exists (did-you-mean on a wrong name). |
| `compose_page` | **Before building any full page** — returns an ordered plan of page sections, each filled with the best-matching premium blocks (top pick + alternates). Pass `surface: "frame"`. |
| `validate_usage` | Deterministically check planned component names + props against the indexed docs **before** writing code. A `notDocumented` prop is a strong signal you are about to invent an API. |
| `get_audit_checklist` | ReUI-specific production-quality checks after installing/adapting an item. |
| `list_block_categories` / `list_components` / `get_block` | Inventory: block categories with counts, the 22 free components, one block's full metadata. |
| `get_project_context` | The `components.json` registry config + license-key setup so `shadcn add @reui/...` works. |

---

# Design every page out of blocks — not just the shell

**The app shell is only the nav and the structure.** It gives you the rail, the
secondary nav, the toolbar — and nothing about what goes *inside* a page. Every
page is its own design problem, solved the same way: **go shopping across the
block catalog, then compose.**

- **All blocks:** `https://reui.io/blocks` — split by surface (application,
  data-grid, solutions, ecommerce, marketing).
- **Every block page walks its samples one at a time and then summarises all of
  them at the bottom, one line each.** Read that summary. It is the fastest way
  to see the whole shelf, and it is why "I looked at the first preview" is not
  looking.

Counts and contents drift — re-read the pages, never trust a number written here:

| Group | What it covers |
|---|---|
| **Application** | app shell, dashboard, settings, sheet, list, profile, navbar, charts, chat, steps |
| **Data Grid** | admin tables, kanban, **grouping**, filtering, sorting, pagination |
| **Solutions** | analytics, CRM, AI ops, event calendar, gantt, ops workbenches |
| **eCommerce** | checkout, billing, product card/detail/grid |
| **Marketing** | heroes, pricing, onboarding, feature pages |

## The per-page workflow

For **each page the app needs**, in order:

1. **Start at the page-shaped block.** A dashboard page starts at the dashboard
   blocks — they are near-complete pages in themselves, with metrics, charts and
   tables already laid out.
2. **Then check every part of it against its own specialist page.** A dashboard
   block's charts are *that block's* charts; they are rarely the right charts for
   this app. Go to the **charts** blocks and pick the visualization that actually
   fits the data. Its table is *that block's* table; go to **Data Grid** and take
   a table that does grouping and filtering properly.
3. **Look across categories, not just the obvious one.** The best graph for a
   dashboard is often in **analytics**, **CRM**, or **AI ops** — those pages carry
   some of the strongest visualizations in the library, and nothing says a chart
   found under "CRM" cannot serve an ops dashboard.
4. **Retrofit and compose.** Take the layout from one, the chart from another,
   the table from a third; wire real data; keep the theme and the surface. The
   result is a block unique to this app, assembled entirely from ReUI parts.
5. **Name what you took** — which blocks, which parts, why — in the worklog or
   PR, so the next agent can follow the seams instead of re-deriving them.

**This is reuse, not deviation.** A page assembled from three blocks' components
is ReUI. A page hand-rolled because no single block matched is not — and "no
block fits" is a claim that needs the same evidence as any other: show what you
searched across which categories before writing anything custom.

## Justin's standing visualization preferences

These are decided. Do not re-litigate them per project, and do not let a block's
stock example override them:

- **No pie charts.** Not for share-of-total, not for status breakdowns, not as
  "just what the block came with." Swap them — a horizontal bar, a stacked bar,
  or a number with a trend almost always reads better.
- **Bar charts are horizontal** unless there is a specific reason otherwise
  (a genuine time series along the x-axis is the usual exception). Horizontal
  survives long category labels, which is what most of these charts carry.
- **Do grouping properly.** If a table groups, take the Data Grid block built for
  grouping rather than bolting group headers onto a plain table.

When a block's stock chart violates one of these, that is expected — retrofit it.
That is what the charts page is for.

## The obvious surfaces, as a starting point

Most apps need some of these. **Start** here, then keep shopping — the list is
where the search begins, not where it ends:

**app shell** (nav + structure only) · **dashboard** · **charts** · **data grid /
tables with grouping** · **chat** · **AI ops** · **agent ops** · **analytics** ·
**CRM** · **settings** · **steps**

Never assume a block exists and never invent one: verify against the page or the
ReUI MCP before installing.

---

# Lessons learned: file to colby-maestro, and consult them back

ReUI implementation knowledge compounds. **Every change the user requests to how
ReUI is implemented is a lesson learned** — file it, then consult past lessons the
next time you pick blocks.

## File it — every time Justin asks for a change to a ReUI page

**Any time Justin comes back and asks you to modify something you built out of
ReUI, that request is a lesson learned.** A different chart, a different block, a
layout that should have been grouped, a shell that buried the thing he actually
needed — he is telling you what this file should have said. File it, so the next
agent gets it as a rule instead of costing him the same correction again.

That makes it **two proposals at the end of such a session**, not one:

| Proposal | Carries |
|---|---|
| the ordinary `agents-md` lesson | anything about how agents work — traps, tooling, process |
| **a `reui` frontend lesson** | the block/chart/layout decision he corrected, so it becomes a rule in *this* file |

Both go to colby-maestro (the control plane; full rules in
`~/AGENTS-maestro.md`):

```bash
colby-maestro propose --kind agents-md \
  --title "ReUI: ops workbench wants a three-region resizable shell, not a mini rail" \
  --detail "The mini-rail shell buried the queue; the resizable three-region shell put queue, detail and log side by side. Hit on core-tail."
```

`--kind agents-md` files it for review under the `colby-ecosystem` project; tag
the frontend ones **`reui`** so they can be found as a set. Same thing over MCP:
`task_upsert_tool(project_key="colby-ecosystem", …, tags_csv="proposal,agents-md,reui")`.

The lesson names the change, why the original choice was wrong, and where it was
hit — never "we should be careful with ReUI". A correction Justin has made twice
is a rule this file is missing; say so in the proposal.

## Consult them back — before picking blocks

**When you consult the blocks pages and the ReUI MCP, also consult the accumulated
frontend ReUI lessons learned** (the `reui`-tagged proposals/lessons in
colby-maestro). A past session already paid for the mistake you are about to
repeat. Check the queue before you select a block, the same way you check before
filing (see `~/AGENTS-maestro.md` for the queue query).

---

# What every app ships

Carried forward — these are still non-negotiable on every UI:

- **Passcode** in front of it (see "Authentication" below)
- **Landing page** (`/`) — what this is, links to everything
- **`/health`** — real checks against live dependencies, polled. Never `{ok:true}`
- **`/openapi.json` + `/swagger` + `/scalar`** — generated, linked from the header
- **`/docs`** overview + `/docs/{page}` subpages
- **Settings** (`/settings`) — persisted to D1 or SQLite, never localStorage
- **Tags** (`/settings/tags`) — a real `tags` + `tag_mappings` vocabulary, never a
  comma-separated column: it cannot be indexed, coloured, or deduped
- **Favicon + logo that depict the project** — `node scripts/make-favicon.mjs
  --search "…"` then `--icon <lucide-name>`; never initials. Full rule in
  `~/AGENTS-cloudflare-workers.md`
- **A layout that works at 375px** — responsive is a requirement

**Selects show labels, never ids** — use `select-field.tsx`; `<SelectValue />`
takes no children; every select gets a placeholder.

Consult the **impeccable** skill before building anything visual, preloaded with
what is already decided (shell, surface, theme, pages above). Full detail:
`~/.colby-ecosystem/frontend/README.md` and
`~/.colby-ecosystem/reference/frontends.md`.

---

# Authentication (end users) — a passcode, by default

**Every app with a UI is behind a passcode unless the user says otherwise.** Not
Clerk, not Cloudflare Access, not "no auth". These are personal tools; a
passcode is the right weight for almost all of them, and it is the same
credential the MCP server and the API already accept.

## How it works

- **The page says "Passcode".** On the backend it is checked against
  **`WORKER_API_KEY`** — but nothing a user can see names it: not the label, not
  the placeholder, not an error message, not the `/docs` page, not a 401 body.
  Naming the secret tells a stranger which credential they are guessing.
- **Validate with a constant-time compare** against
  `await requireSecret(env, "WORKER_API_KEY")` (Secret Store binding, via
  `utils/secrets.ts`). Never `===` on a secret, and never `=== env.WORKER_API_KEY`
  — the binding is an object, so that is always false (see "Secrets &
  credentials" in `~/AGENTS.md`).
- **On success, set a session cookie that lasts as long as a browser allows:
  400 days.** `Max-Age=34560000; HttpOnly; Secure; SameSite=Lax; Path=/`. 400
  days is the ceiling (RFC 6265bis; Chrome clamps anything longer), so asking
  for more buys nothing. The user signs in once per device and effectively
  never again.
- **The cookie holds a signed token, never the key.** An HMAC over its own
  expiry, keyed by `WORKER_API_KEY`. Stateless — no session table — and rotating
  the key signs everyone out at once, which is exactly what a rotation should do.
- **Never log the submitted passcode**, not even on failure.

**Do not write this.** Copy the template, which already does all of the above
and is covered by a 19-assertion check:

```bash
cp ~/.colby-ecosystem/workers/utils/auth.ts   src/backend/auth.ts
cp ~/.colby-ecosystem/workers/routes/oauth.ts src/backend/routes/oauth.ts
bash ~/.colby-ecosystem/workers/devOps/auth-check/run.sh   # after any edit to either
```

`/login` renders the passcode page; `POST /auth/login` sets the cookie;
`requireAuth` accepts the cookie, `Bearer <WORKER_API_KEY>`, or an OAuth token,
so the dashboard, scripts, and MCP clients share one gate. Exempt `/login`, the
icons, `/.well-known/*`, and `/oauth/*` from it. The same files give an MCP
server its OAuth — see "MCP servers" in `~/AGENTS-cloudflare-workers.md`.

## Tests and local scripts use the same key

`WORKER_API_KEY` lives in the tokens CLI under the same name as the Secret Store
binding. A unit test, a smoke test against the deployed URL, or a local script
calling the Worker gets it from the tokens SDK — never a hardcoded string, never
a `.env`:

```bash
tokens agent-onboarding --scaffold-mjs    scripts/tokens.mjs    # Node
tokens agent-onboarding --scaffold-python utils/secrets.py      # Python
```

```js
import { requireSecret } from "./tokens.mjs";
const key = requireSecret("WORKER_API_KEY");
await fetch(`${BASE}/api/whatever`, { headers: { Authorization: `Bearer ${key}` } });
```

`tokens agent-onboarding --print-rule` shows the rest of the SDK.

## When something stronger is warranted

Use Clerk (or Cloudflare Access) only when **the user asks for it**, or when **you
judge a shared passcode genuinely too weak for the data** — several distinct
people who need separate access or revocation, regulated or third-party personal
data, anything where one leaked passcode is a real incident.

If you think that, **say so once**, with the specific reason, and let the user
decide. If they say keep the passcode, keep the passcode. Do not re-raise it,
do not quietly add Clerk "as well", and do not weaken the passcode build to make
a point.

### If Clerk it is

No hand-rolled sessions, no bespoke JWT layer. **Restrict logins to the GitHub
user `jmbish04` unless told otherwise** — an open sign-up page on a personal tool
is a bug. Use the tooling, not hand-written config:

- **`clerk` CLI** — installed (`clerk --version` → 3.2.0). Login, app and
  instance setup, keys, feature toggles, user and org management, local webhook
  testing, arbitrary Clerk API calls.
- **Clerk MCP tools** — if configured in the session.
- **Clerk skills** — `clerk` (router, start here), `clerk-setup`, `clerk-cli`,
  `clerk-astro-patterns` (the default stack), `clerk-react-patterns`,
  `clerk-custom-ui`, `clerk-orgs`, `clerk-webhooks`, `clerk-testing`,
  `clerk-backend-api`.

`CLERK_SECRET_KEY` and `CLERK_PUBLIC_KEY` are in the tokens CLI (`tokens find
clerk`). Secret Store binding in a Worker, tokens SDK in a script.

Service-to-service auth is a separate question and is always `WORKER_API_KEY`.
