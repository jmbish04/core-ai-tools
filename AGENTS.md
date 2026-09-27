# AGENTS

- At the start of every turn, use the `cloudflare-docs` MCP server to verify Cloudflare assumptions, architecture, and deprecations before writing or changing code.
- Review and apply the best practices in `.agents/skills/` and `.github/skills/` before implementing changes.
- Build new views as React islands on top of the existing Astro + Shadcn foundation, using the dark/moody theme system and subtle contrast instead of heavy borders.
- Enforce Zod validation on backend endpoints, expose OpenAPI v3.1.0 at `/openapi.json`, `/swagger`, and `/scalar`, and keep endpoints strongly typed.
- Every new service or view must expose `/health` and emit structured logs/metrics into the mirrored D1 logging layer.
# Agent Workspace Overview

Welcome to the `core-template-cfw-assets-astro-shadcn` template. This is a unified full-stack template combining Cloudflare Workers (Backend & Assets) with Astro and React + Shadcn/ui (Frontend).

## Core Architecture

- **Backend:** Cloudflare Workers, Hono (Routing), D1 (Database with Drizzle ORM).
- **Frontend:** Astro (SSR/Static Hybrid), React (Interactive Islands), Tailwind CSS, Shadcn/ui.
- **Deployment:** Deployed using Cloudflare Workers Assets via `wrangler.jsonc`.

## Mandatory Agent Directives

This repository relies heavily on AI agents for rapid prototyping and feature generation. If you are an AI agent, you must strictly follow these directives:

1. **Read Startup Rules:** Immediately review `.agent/rules/startup.md` before writing any code. It contains critical instructions for your first steps.
2. **Clean State Execution:** The template's default UI has been deliberately wiped clean and replaced with a temporary template-routing warning. Build the user's requested frontend directly from `src/frontend/pages/index.astro` or the route structure you introduce, and keep the shared header available on every page.
3. **Environment Strictness:** We use `worker-configuration.d.ts` for Cloudflare types. Never manually define `interface Bindings`. Always use `Bindings: Env` on Hono applications.
4. **Runtime Baseline:** Use Node.js 22+ when working with Wrangler or regenerating `worker-configuration.d.ts`.
5. **Package Management:** Default to `pnpm` for package installation and script execution.
6. **Authentication Rule:** Use the Secrets Store binding `WORKER_API_KEY` for protected API authentication and session creation. Do not add a `users` table back into this template.
7. **Schema Layout:** Keep Drizzle tables under `db/schemas/${useCase}/${tableName}.ts` and use Drizzle-Zod for API typing where table schemas are involved.
8. **Modularization:** Keep new code modular. Split helpers, components, routes, and persistence code by concern instead of adding large multipurpose files.
9. **Template Replacement Prompt:** If the user gives you the landing-page replacement prompt, replace the starter frontend, preserve the shared header, and keep the dynamic docs pointers to `/openapi.json`, `/swagger`, and `/scaler`.
10. **Frontend Errors:** Never use Chrome/browser alerts. Route every frontend error through the centralized frontend error handling utility and keep the copy-to-clipboard success/error feedback within shadcn components.
11. **Dependency Hygiene:** Follow `.agent/rules/dependency-maintenance.md` whenever dependencies, Wrangler, or generated Cloudflare types may be stale.
12. **Architecture Rules:** Follow `.agent/rules/architecture.md` and `.agent/rules/frontend-error-handling.md` for auth, modularization, and frontend error UX conventions.
13. **CI Ownership:** If GitHub Actions or Cloudflare PR deployment checks fail because of frozen lockfiles, outdated dependencies, or stale Wrangler types, fix them in the same turn by refreshing pnpm dependencies and re-running validation before handing work back.
14. **Import Path Aliases:** ALWAYS use tsconfig path aliases (`@/backend/*`, `@/backend/db/*`, `@/backend/ai/*`, etc.) for all backend imports. Never use relative imports (`../../foo`). Run `node scripts/migrate-imports.mjs` to convert existing relative imports. See `.agent/rules/import-paths.md` for details.
15. **Comprehensive Documentation:** Every backend TypeScript file must have a file-level JSDoc comment explaining its purpose, key features, and usage. Every exported function/class must have JSDoc with `@param`, `@returns`, `@throws`, and `@example` tags where applicable. See `.agent/rules/docstrings.md` for standards.
16. **Agent Meta-Maintenance:** Update `AGENTS.md` and `.agent/rules` files when you add/modify features that future agents should know about. Keep rules concise (<12,000 chars per file), avoid duplication, and resolve conflicts. See `.agent/rules/meta-maintenance.md` for guidelines.
17. **Shared Data Toolkit:** This template ships an isomorphic data/array/object utility toolkit built on [Remeda](https://github.com/remeda/remeda). Reach for it before hand-rolling array/object plumbing. Import from `@/backend/utils/data` on the Worker side and `@/lib/data` on the frontend — both re-export the same isomorphic core at `@/shared/data-utils`. It exposes curated Remeda re-exports (`pipe`, `groupBy`, `unique`, `sortBy`, `pick`, `difference`, …), the full Remeda surface as `R`, and template helpers Remeda doesn't ship (`diffArrays`, `findWhere`, `toggleInArray`, `moveItem`, `keyBy`, `compact`, `ensureArray`, `deal`, `truncate`, `tryParseJson`). Add genuinely-shared helpers to the shared core (never duplicate per-surface). Live demo + docs at `/showcase/utilities`. See `.agent/rules/data-utilities.md`.

## Template App Surface (reference implementation)

This template ships a real, running app so new projects inherit working patterns
(extend or delete the pieces you don't need). All of it is wired to D1 via Hono;
no mock data.

- **CRITICAL — Agents SDK islands must mount `client:only="react"`, never `client:load`.**
  Any React island using `useAgent`/`useAgentChat`/assistant-ui (the
  agents/PartySocket stack) is browser-only. `client:load` server-renders it
  first, and `useAgent`'s `useMemo` hits a null React dispatcher in the SSR
  worker → `Cannot read properties of null (reading 'useMemo')`, which fails the
  whole route. This was the original "chat not working" bug. Plain fetch-based
  islands (inbox, dashboard, tasks) may use `client:load`. Note: the `ai` binding
  is remote-only, so `wrangler.jsonc` sets `"ai": { "binding": "AI", "remote": true }`.
- **Pages** (Astro SSR + React islands, Monolith dark theme):
  - `/dashboard` — admin dashboard: radial-gauge KPIs + grouped-bar, interactive
    donut, and polished time-series recharts (all OKLCH palette via `ui/chart.tsx`)
    with search + range + status filters. Components under `components/dashboard/`.
  - `/projects`, `/tasks/board` (kanban), `/tasks` (table with **faceted
    multi-select chip filters** — `components/tasks/FacetFilter.tsx`), `/tasks/[id]`.
    Task/kanban/project cards open preview modals. Components under `components/tasks/`.
  - `/notes` — **PlateJS** rich-text editor (`components/notes/`); bodies persist as
    a versioned `{v,format:"plate",value}` JSON envelope in the team-notes `body`
    column, with legacy plain-text fallback.
  - `/inbox` — two-pane inbox backed by Cloudflare **Email Routing**: the Worker
    `email()` handler (`backend/email/inbound.ts`) stores inbound mail in the
    `email_messages` D1 table; UI under `components/inbox/`, API at `/api/inbox`.
  - `/chat` + `/showcase/{code-mode,browser-hitl,multi-agent,workflows,artifacts,
    mcp,thinking,skills,features}` — every Agents page mounts a LIVE interactive
    island (`components/showcase/`) wired to its Durable Object, not a static doc.
  - `/docs` (docs home, bound to `/api/docs/*`) + `/playbook` — documentation using
    the Shiki-backed `ui/code-block.tsx` (kibo-ui-style, base-ui, copy + tabs).
  - `/settings/{preferences,notifications,webhooks,activity,advanced}` (shared
    sub-nav) and `/notifications` (realtime). Components under `components/settings/`.
- **Schemas** live in `db/schemas/{projects,tasks,stats,settings,notifications}/`
  (drizzle-zod + `*_TABLE_DESCRIPTION`/`*_COLUMN_DESCRIPTIONS` for `/docs`).
- **APIs**: `/api/{projects,tasks,team-notes,settings,webhooks,activity,
  notifications,dashboard}` — CRUD + `?q=` search + filters + pagination. The
  dashboard exposes `/stats`, `/charts`, `/insights` (Workers AI via
  `ai/providers/ai-sdk.ts#getChatModel`).
- **Agents (Durable Objects, all bound + functional)**: `ChatBroker` (assistant-ui
  chat), `OrchestratorAgent` + `ResearcherAgent` + `CoderAgent` (real `getAgentByName`
  RPC delegation), `CodeModeAgent` (executes via `WORKER_LOADERS`), `WorkflowsAgent`
  (live progress via `setState`), `BrowserHitlAgent` (`MYBROWSER`; HITL approval gate),
  `McpAgent` (tool catalog + `callTool`), `ThinkingAgent` (streams reasoning then text),
  `SkillsAgent` (skills registry), `ArtifactAgent` (SQLite versioning), `NotificationsAgent`.
  Invoke via RPC (`getAgentByName`) or `@callable` + client `agent.call` — NEVER
  `stub.fetch`. Migrations are additive (v1→v3); never rewrite a shipped tag.
- **Realtime**: the `NotificationsAgent` Durable Object (`NOTIFICATIONS_AGENT`,
  instance `"global"`) syncs notification state over WebSocket. The client island
  is `components/NotificationsFeed.tsx` (`useAgent` + `onStateUpdate`); REST
  mutations proxy to it via `getAgentByName` (never `stub.fetch`).
- **Shared frontend helpers**: `lib/api.ts` (`apiGet`/`apiSend`/`ApiError`) and
  `lib/format.ts` (`relativeTime`/`shortDate`/`compactNumber`). Charts use the
  shadcn `ui/chart.tsx` wrapper + the OKLCH `--chart-1..5` palette in `global.css`.
- **Shared data toolkit** (isomorphic, Remeda-backed): one core at
  `shared/data-utils.ts`, re-exported by `lib/data.ts` (frontend, `@/lib/data`)
  and `backend/utils/data.ts` (`@/backend/utils/data`). Curated Remeda re-exports
  + full `R` namespace + template helpers (`diffArrays`, `findWhere`,
  `toggleInArray`, `moveItem`, `keyBy`, `compact`, `ensureArray`, `deal`,
  `truncate`, `tryParseJson`). Live demo: `/showcase/utilities`.
- **Seed demo data**: `POST /api/seed` (idempotent). Locally:
  `pnpm run migrate:local` then `curl -X POST http://localhost:8787/api/seed`.
- **SSR note**: `src/_worker.ts` exports `start(manifest)` + `createExports()`;
  page requests are rendered via `@astrojs/cloudflare/handler#handle`. Do NOT
  revert this to a bare `env.ASSETS.fetch()` fallback — that 404s every SSR page.
- **Auth**: signed session cookie only (no `users`/`sessions` table). Auth gates
  `/api/admin/*`; the feature APIs are intentionally open so the template runs
  out of the box. Tighten before production.

# core-ai-tools (this build — session-based AI image editor)

Spec (source of truth): `docs/plans/0001_init/IMPLEMENTATION_PLAN.md`. Built additively
on top of the template — **no existing page/route/schema is deleted**; only the Navbar
and landing page are reshaped, and only in Phase 10.

- **Dedicated Cloudflare resources (this project owns these):** Worker `core-ai-tools`;
  D1 `core-ai-tools` (`98b592ba-c5a3-47f4-950d-77a108b8d613`, bound as `DB`); R2
  `core-ai-tools-audio` / `core-ai-tools-files`; Vectorize `core-ai-tools-career-memory`
  (1024-dim, cosine — matches `@cf/baai/bge-large-en-v1.5`). All 6 migrations applied
  remote. **The template's `core-template-cfw-assets-astro-shadcn` Worker, D1, R2 buckets,
  and Vectorize index are OFF-LIMITS — never deploy or migrate against them.** The
  Secrets Store bindings + `vars` block are account-level and left as-is (revisit in
  Phase 4 per the secrets decision).
- **Phase 1 (done): D1 schema.** Two new Drizzle domains, both re-exported from
  `db/schema.ts`, migration `0005_naive_wendell_vaughn.sql` (additive; applied local +
  remote against the dedicated D1):
  - `db/schemas/library/` — `library_folders` (self-nesting, cycle check in service
    layer), `library_images` (CF Images metadata only, **soft-delete via `deleted_at`**,
    never hard-deleted — would orphan revisions).
  - `db/schemas/sessions/` — `sessions` (PK `session_uuid` keys the future `SessionDO`;
    indexed FK `origin_library_image_id`; `approval_policy` default `masked_only`;
    `root_revision_id` is a **soft ref, no DB FK**, to avoid a sessions↔revisions cycle),
    `masks` (first-class/addressable; **soft-delete via `deleted_at`** — reusable across
    sessions, so `session_uuid` FK is `SET NULL` not cascade; `derived_from_mask_id`
    lineage — corrections make a NEW row), `revisions` (the tree — fork = new parent,
    retry = same parent+`edit_fingerprint` with `attempt_number++`; stores full
    `prompt_text` verbatim; `requested_model` vs `served_model` for fallback badging),
    `revision_events` (append-only; `seq` monotonic per session via unique index — the
    WebSocket replay buffer).
  - **Root = synthetic seed node (not an edit).** Created in the same txn as the session:
    `parent_revision_id = NULL`, `prompt_text = ''`, `edit_payload = null`,
    `edit_fingerprint = 'seed'`, `attempt_number = 0`, `status = 'succeeded'`,
    `requested_model`/`served_model` null, `input_image_id = output_image_id =
    session.origin_library_image_id`; `sessions.root_revision_id` points at it. Because of
    this, `edit_payload` and `requested_model` are **nullable at the DB but service-layer
    non-null for every real edit**. UI renders the seed as the original image, not an edit.
    **Diff/compare is now uniform — always `parent.output_image_id`, no first-edit special
    case** (supersedes the §5.1 assumption that the root compares against the library image;
    the seed node's output IS that image). Exactly-one-null-parent-per-session is enforced
    by the partial unique index `uniq_revisions_root_per_session` AND a mirror service-layer
    invariant check (so violations give a useful error, not a raw constraint message).
  - **Replay integrity via FKs**: everything a revision needs to replay lives in
    soft-delete-only tables, and the FKs into them fail loud: `revisions.input_image_id`,
    `output_image_id`, `mask_id`, and `sessions.origin_library_image_id`, `masks.source_image_id`
    are all `ON DELETE RESTRICT`. `revisions.session_uuid` and `revision_events.session_uuid`
    are `CASCADE` (a session owns its own tree). Service layer must NEVER hard-delete
    library_images, masks, sessions, or revisions — archive / soft-delete only.
  - **`seq` + `attempt_number` are contended counters — never `MAX()+1` from a handler.**
    `revision_events.seq` is allocated by the **`SessionDO`** (single-threaded per session);
    Phase 2 core writes events through an `EventEmitter` interface (`appendEvent`), with a
    temporary direct-D1 impl that is a **Phase 6 casualty**. `attempt_number` is guarded by
    UNIQUE `(session_uuid, parent_revision_id, edit_fingerprint, attempt_number)`; the
    service layer allocates it in a txn and retries on constraint violation. Both: a
    collision is retried, never swallowed — gaps in the replay buffer are unacceptable.
  - Indexes: `idx_sessions_origin_image`, **`uniq_revisions_retry`** (unique, 4-col — its
    prefixes also serve children-of-node + retry-sibling reads, so the earlier standalone
    parent/fingerprint indexes were dropped as redundant), **`uniq_revisions_root_per_session`**
    (partial unique `WHERE parent_revision_id IS NULL` — one seed node per session),
    `idx_revisions_expiry` `(status, approval_expires_at)` for the expiry cron,
    `idx_masks_derived_from`, `idx_masks_session`, `idx_revision_events_session_seq` (unique).
- **Deferred to later phases** (not yet in `wrangler.jsonc`): `SESSION_DO` binding + DO
  migration (Phase 6, when the class exists), `IMAGES` binding + provider secrets
  (`GEMINI_API_KEY`/`OPENAI_API_KEY`/`CF_IMAGES_TOKEN`, Phases 3–4), `[triggers] crons`
  for the 24h approval-expiry sweep. Bindings are added in the phase that ships the code
  using them, so `deploy --dry-run` stays green.
- **Session archive/delete**: deleting a session cascades its revisions but leaves its
  masks with `session_uuid = NULL` (they may be reused elsewhere). The archive path must
  reap or reassign orphaned masks — fold into Phase 2.
- **Cross-DO event path**: `SessionDO` and `McpAgent` are separate Durable Objects, so MCP
  tool calls reach `SessionDO` by stub to emit events. The Phase 2 `SessionEventEmitter`
  makes this explicit (DO-backed impl uses `getByName(sessionUuid)`, never `stub.fetch`).
- **`0006` (done): CHECK `ck_revisions_real_edit_has_model`** — `parent_revision_id IS NULL
  OR (edit_payload IS NOT NULL AND requested_model IS NOT NULL)`. Seed node may have both
  null; every real edit must carry both. Applied local + remote; verified it rejects a
  real edit missing the model and permits the seed shape. `prompt_text` stays `NOT NULL`
  but is deliberately NOT constrained non-empty — a structured-only edit (payload, no NL
  instruction) can legitimately be `''`; the service layer normalises it. Service-layer
  mirror check still required for a readable error.
- **⛔ MIGRATION DISCIPLINE (survives context loss): `0005`, `0006`, and `0007` are applied
  to the dedicated remote D1. The delete-and-regenerate procedure is NO LONGER AVAILABLE.**
  Every schema change from here stacks as a new migration (`0008`, `0009`, …). Never rewrite
  or delete a migration that has shipped remote. `pnpm run db:generate` → `migrate:local` →
  `migrate:remote`, always additive.
- **Phase 1 validation (empty-DB repoint sanity):** all 30 template pages return 200 under
  `wrangler dev` against the empty dedicated D1 (`/settings` 302 = its normal redirect;
  `/tasks/<id>` degrades to 200 on a missing task; attachments on a missing task → 404, not
  500). Binding audit for the R2/Vectorize swap: `R2_FILES_BUCKET` is used only by
  `api/routes/task-detail.ts` (task attachments, `/tasks/[id]`) — verified graceful on an
  empty bucket. **`R2_AUDIO_BUCKET` and `VECTORIZE_CAREER_MEMORY` have ZERO live code usage**
  (only a commented-out `env.VECTORIZE.insert` in `WorkflowsAgent` + a showcase string), so
  the swap could not have broken a page through them.
- **🚧 GATE BEFORE PHASE 9 — React island SSR hook crash (template-native, pre-existing).**
  Repro: `GET /notifications` → the `NotificationsFeed` island (`components/NotificationsFeed.tsx`)
  calls `useAgent` (`agents@0.12.4` `src/react.tsx:320`) → `useMemo` on a null React
  dispatcher during **workerd SSR** → `Invalid hook call` / `Cannot read properties of null
  (reading 'useMemo')`. Page still returns 200 (Astro catches the island error and hydrates
  client-side), but SSR of that island is broken. Confirmed template-native: `git diff
  3bc8198 -- src/frontend` is empty — every frontend file is byte-identical to the fork, and
  Phase 1 touched zero frontend files; React is a single deduped copy (`react@19.2.6`), so
  it is NOT a duplicate-React issue — it is `useAgent` being run in SSR. **Every UI surface
  in this build is a React island using `useAgent`/`useAgentChat` (tree canvas WS, diff
  viewer, mask brush), so this must be fixed before Phase 9** (likely `client:only="react"`
  on `useAgent` islands, or guarding the hook off SSR). Do NOT chase it before then; it is
  filed, not open.
  - **MAY NOT APPLY TO US.** The crash is specific to the Agents SDK `useAgent` hook. Our
    `SessionDO` is a PLAIN Durable Object and §5 calls for a hand-rolled reconnecting
    WebSocket client, not the SDK's React hooks. If we never call `useAgent`/`useAgentChat`
    in our own islands, we never hit this. Re-evaluate at Phase 9: if our WS client is
    hand-rolled as specified, this gate is likely moot — do not re-litigate, just confirm we
    don't import `useAgent`.

## Wave 1 schema (W1.4–W1.6) — migration `0015_condemned_magma.sql` (local only so far)

**⛔ `0015` is NOT yet applied remote.** It is purely additive (2 new tables, 10
`ALTER TABLE ADD COLUMN`, 1 unique index) — apply it, never rewrite it.

- **W1.4 nested folders + inheritable settings.** `library_folders` gained
  `default_prompt`, `context_text`, `use_case`, `preferred_models` (JSON array),
  `approval_policy`. **All nullable; NULL means "inherit from the nearest ancestor
  that sets it", never "off".** Nesting itself was already unlimited-depth, and
  `core/library/folders.ts#moveFolder` already carries the ONE cycle check — do not
  add a second. `core/folders/settings.ts` adds `resolveSettings(ctx, folderId)`
  (one `WITH RECURSIVE` query, depth-capped at 64, returns `{value, fromFolderId,
  inherited}` per setting plus `ancestorPath`) and `updateFolderSettings` (passing
  `null` CLEARS a setting, which is the only way to re-enable inheritance).
  `preferredModels` is **advisory** — `task_model_defaults` stays authoritative.
- **W1.5 rich image metadata.** `library_images` gained `public_id` (unique),
  `title`, `usage_instructions`, `context_text`, `role` (`base|reference|inject`).
  `folder_id` already existed. **`public_id` = `img_` + 10 base-32 chars (no i/l/o/u)**
  — the short handle a user copies and pastes into a prompt. Minted by the column
  `$defaultFn` (`shortPublicId()` in the schema file), so no call site has to
  remember it; rows predating the column are NULL (SQLite allows many NULLs in a
  unique index) and `backfillPublicIds(ctx)` fills them. Lookup:
  `findImageByPublicId` / `requireImageByPublicId` (case-insensitive, trims).
  Writes: `updateImageMetadata` (whitespace-only clears to NULL).
  `library_images.role` is the library-level DEFAULT; `session_images.role`
  (`base|object|style`) still overrides per session — different enums on purpose.
- **W1.6 assets + lineage.** New `assets/` domain: `assets` (one row per curated
  reusable source image, backed by exactly one `library_images` row, `archived_at`
  only — never hard-deleted) and `asset_lineage`. **Promotion COPIES the image row**
  (same `cf_image_id`, new row id, fresh `public_id`) and `promoted_from_image_id`
  is the trace back — that separation is what keeps iterations produced from the
  ASSET distinct from iterations produced from the original image elsewhere.
  `asset_lineage` is stored **transitively closed** (asset → every descendant
  image), so the asset page is one indexed read, not a tree walk.
  **The whole lineage mechanism is ONE rule, in `markSucceeded`:** the output image
  inherits every asset its INPUT image descends from. Because
  `revisions.input_image_id = parent.output_image_id ?? parent.input_image_id`,
  that covers forks (the fork's input IS the forked-from node's output) and retries
  (same parent → same input) with no tree-shape awareness. Do not replace it with a
  tree walk. Functions: `propagateLineage`, `assetIdsForImage`, `recordLineage`
  (idempotent via `uniq_asset_lineage`), `listAssetIterations` (oldest-first, carries
  `folderId`/`sessionUuid` so the SURFACE groups — core returns flat rows).
- **Not yet exposed**: no REST route and no MCP tool touches any of this. See the
  handback notes for the endpoint/tool surface it needs.
- Tests: `test/folders-assets.test.ts` (20). Suite total 96.

## Secrets (Secrets Store) — access convention

- **All secret reads go through `src/backend/utils/secrets.ts`.** Never `env.X.get()` at a call
  site, never at module scope. The generic `getSecret(env, key)` already handles the Secrets
  Store async `.get()` vs plain-string asymmetry (`typeof v.get === 'function' ? await v.get()
  : v`); typed helpers wrap each secret (`getWorkerApiKey`, `getCloudflareApiToken`,
  `getCloudflareAccountId`). Established consumption pattern: `auth.ts` → `await
  getWorkerApiKey(c.env)` inside a handler. The helper does NOT cache (correct — bindings
  resolve per-request, rotation without redeploy) and does NOT redact (redaction is the shared
  dispatch wrapper's job). Extend the helper for new secrets (`getGeminiApiKey`,
  `getOpenAiApiKey`); Images ops reuse `getCloudflareApiToken` (the wrangler token carries
  Images scope — `CF_IMAGES_TOKEN` was dropped as redundant).
- **Secret list**: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WRANGLER_API_TOKEN`, `WORKER_API_KEY`
  (all three already bound) + **`GEMINI_API_KEY`, `OPENAI_API_KEY` (new — bindings to add,
  values set by Justin)**. Store id `8c42fa70938644e0a8a109744467375f`.
- **Keys go in headers, never query strings**: `x-goog-api-key` for Gemini, `Authorization:
  Bearer` for OpenAI + core-guardian. (Gemini docs' `?key=` form is banned.)
- **CLI to create a secret** (Justin): `npx wrangler secrets-store secret create
  8c42fa70938644e0a8a109744467375f --name GEMINI_API_KEY --scopes workers --remote` (omit
  `--value` → secure prompt). `--remote` = production store; **omit `--remote` = LOCAL store**.
- **Local dev**: Secrets Store has a local mode. `secret create` WITHOUT `--remote` writes to
  the local store (`.wrangler/state`); `env.X.get()` then resolves locally — SAME code path as
  production, no `.dev.vars` needed and none to be added for these keys. (`remote: true` on the
  binding is the alternative dev-against-prod path.) Run `wrangler types` after adding any binding.

## ⛔ BLOCKER — core-guardian usage-ingestion endpoint does not exist (yet)

The addendum §3 references `POST /api/guardian/usage/register` (bearer `WORKER_API_KEY`) for
per-inference usage emission. **It is NOT in the deployed guardian's OpenAPI** at
`http://core-guardian.hacolby.workers.dev/openapi.json` (which is itself the "CFW Astro shadcn
Agents Template" v1.0.0). That spec exposes only GET monitoring endpoints (`/api/guardian/usage`
= GET readings, `/attribution`, `/events`, `/history`, …) plus admin POSTs (`/evaluate`,
`/archive/*`, `/hotfix`, `/action-items/{id}/approve`, `/alerts/{id}/action`, `/pricing/scrape`,
PUT `/plan`). No POST accepts a model/token/cost/session/revision payload. **Cannot build the
guardian usage emitter until Justin ships/publishes the ingestion endpoint or hands over the
exact path + payload contract.** Do NOT invent a schema.

## Model selection — the config table is authoritative (no auto-promotion)

`task_model_defaults` is the ONLY thing dispatch reads. No heuristics, no lineage inference, no
`succeeds_model_id`, no automatic swaps — "newest and best" happens only when someone updates the
table (`/models` page, `set_task_default` MCP tool, `PUT /api/models/tasks/:task_key`).
`model_catalog` sync is purely informational (surfaces `is_new` banners). Resolution order:
explicit request → `sessions.model_overrides[task_key]` → `task_model_defaults[task_key]` →
**error** (never a silent default). Exception where silence is banned: a `deprecated_at` catalog
row that an ENABLED task default points at must alert loudly (banner + `revision_events` row);
startup/health validation asserts every enabled default resolves to a live, non-deprecated row.
Pin explicit model ids; **quarterly review task** — re-check pinned ids + deprecations each quarter.

## Phases 9–11 (built: understanding seam, routes, MCP contract). Migrations to 0011. 48 tests.

- **Phase 9 — understanding.** `understanding/` domain (0011): `understanding_results`.
  `core/understanding/understand.ts` (caption/vqa/classify/detect via `understand` task model;
  persists results). Segmentation goes through `createSemanticMask` (Phase 5), not here. Model
  call deferred-live.
- **Phase 10 — Hono routes.** `api/routes/{sessions,revisions,library,models,prompts,video}.ts`
  mounted in `api/index.ts`. Thin: parse → `createCoreContext(c.env)` → core → serialize;
  errors via `api/lib/errors.ts#toHttpError` (maps CoreError.status). Video delivery
  `GET /api/video/:id` implements Range + **410 on purge**. **NOTE (follow-up)**: these use
  plain Hono + `zValidator`, not strict `.openapi(createRoute)` — the strict return-type
  contract fought dynamic error statuses; routes work + validate but aren't yet in
  `openapi.json`. Re-register with zod-openapi + declared error responses later.
- **Phase 11 — MCP contract.** `backend/mcp/payload.ts` = the §4.2 compact payload builder
  (`image_url`/`thumb_url`/`app_url`/`compare_url`/`approval_url`/`mask_preview_url`, no inline
  bytes). `backend/mcp/tools.ts` = the snake_case tool catalog mapping to core fns, each
  description stating session-scoped + realtime-visible. **TRANSPORT follow-up**: mount `/mcp`
  via Agents SDK `McpAgent` + Streamable HTTP, using a class DISTINCT from the template's
  showcase `McpAgent` (e.g. `ImageToolsMcp`).

## 🔐 MCP AUTH — bearer live, OAuth 2.1 pending

- **`/mcp` is now gated.** `backend/mcp/server.ts#handleMcp` rejects EVERY unauthenticated
  request (incl. `initialize` + `tools/list`) with 401 before any dispatch. Bearer =
  `WORKER_API_KEY` (Secrets Store, via `getWorkerApiKey`), length-checked constant-time compare.
  Verified in prod: unauth `tools/list`/`initialize`/`tools/call` all 401; bad bearer 401.
  (An earlier deploy shipped it OPEN — see memory `never-deploy-unauthenticated`. Never again.)
- **OAuth 2.1 BUILT + deployed + verified** (`@cloudflare/workers-oauth-provider` v0.8.2).
  `backend/mcp/oauth.ts#buildOAuthHandler` wraps the base Worker handler (Astro+Hono+email) and
  is the deploy default export (wired in `_worker.ts#createExports`; email preserved on the
  export). It owns `/mcp` (protected `apiHandler` = `handleMcp`, auth already done), `/authorize`
  (our consent page — single-owner gate: enter WORKER_API_KEY to approve), `/token`, `/register`
  (DCR), `/.well-known/oauth-authorization-server` + `/.well-known/oauth-protected-resource`.
  **Dual auth**: `resolveExternalToken` accepts a raw `Bearer <WORKER_API_KEY>` for our
  scripts/tests alongside OAuth tokens; everything else 401s. Needs the **`OAUTH_KV`** binding
  (id `859ea6b96deb4140831a1d09a70ffcd4`). Verified in prod: discovery issuer = server URL, DCR
  returns a client_id, `/authorize` renders, `/mcp` unauth → 401, all SSR pages still 200.
  `handleMcp` no longer self-gates (OAuth layer does auth); the direct `/mcp` routes were removed
  from `_worker.ts`.
  - **Full flow VERIFIED end-to-end** (with the real WORKER_API_KEY via `tokens show
    WORKER_API_KEY --value-only`, piped, never printed): DCR → `/authorize` (key) → `/token` →
    `/mcp` with the OAuth token → 23 tools. Bearer path also verified.
  - **Claude fix — the `resource` mismatch**: the protected-resource metadata advertised the
    ORIGIN (`…/`), but Claude treats the MCP URL (`…/mcp`) as the resource and requires an exact
    match. Set `resourceMetadata.resource` = `https://core-ai-tools.hacolby.workers.dev/mcp`
    (hardcoded to the deploy host); both the root and path-based
    (`/.well-known/oauth-protected-resource/mcp`) well-known now return it.
  - **Diagnostics added**: `[mcp]`/`[oauth]` console logs (method, key-match bool, complete-auth
    result, provider `onError`) so a Claude "connection error" maps to a real cause in `wrangler
    tail`. `initialize` echoes the client's `protocolVersion` (2024-11-05 / 2025-03-26 /
    2025-06-18) + `Mcp-Session-Id`; `ping` handled. Consent + bearer compares `.trim()` both sides
    (Secrets Store values can carry a trailing newline).

## Gemini mask finding (from the contract doc — doc itself NOT in repo)

Gemini image models have **no mask-channel parameter** — inpainting is semantic (prompt /
composite). Applied: all Gemini image models `mask_inpainting: false` + new
`mask_emulated_only: true`; capability enforcement (`modelSatisfies`) allows a masked edit when
`mask_inpainting || mask_emulated_only`, and the revision is flagged `mask_emulated`. OpenAI
`gpt-image-1` keeps a native mask channel. **`docs/reference/gemini-image-api-contract.md` is
NOT in the repo** (not tracked/untracked/anywhere) — the full provider body (Interactions
endpoint, request shapes, `steps`, `response_format`, uppercase-K `image_size`, grounding,
thinking, model table, prompting-guide seeds) stays blocked until it's committed.

## AI Gateway

`AI_GATEWAY_ID` var changed `default-gateway` → **`core-ai-tools`**. No `wrangler ai-gateway`
command exists — the named gateway must be created via dashboard/API before the empirical
Interactions proxy test can run. Test still owed (provider route / universal `/ai/run` / direct
control, real req+resp).

## Frontend (this run — nav reorchestrated, product pages added)

Nav rebuilt from `siteConfig` to the product: Home/Library/Sessions/Chat + Editor/Developer/
System groups (`/openapi.json` `/scalar` `/swagger` kept). New pages (thin Astro shell + a
`client:load` island using `apiGet`, empty/loading/error states): `/` (reshaped landing),
`/mcp-setup`, `/sessions` + `/sessions/[uuid]` (tree with grouped attempts), `/library`,
`/models` (capability matrix), `/prompts`. Chat kept via `ChatBroker` (`/chat` + landing
AssistantModal). **DATA/PRESENTATION SPLIT is loose here** — Claude Design restyle should
replace presentation; if it needs rewiring, tighten the hook/loader split first. Still owed
(Part 2): a `/docs` onboarding page (MCP connect steps + tool catalog generated from the
registry + session/revision model), a library "sessions spawned from this image" panel, the
mask brush, prompt create/use, model per-task-default editing. Template showcase pages remain
on disk but are unlinked (their DO agents were removed — see below).

## DO trim (v2)

Removed the 10 template showcase agents; kept **ChatBroker + NotificationsAgent + SessionDO**.
wrangler bindings = `_worker.ts` exports = `astro.config` namedExports = those 3 (verified).
Migration **v2 `deleted_classes`** for the 10; deployed cleanly (no instance-state conflict).
`health.ts` AGENT_BINDINGS trimmed. OrchestratorAgent (dead code) refs to removed bindings cast
to keep tsc green.

## DEPLOYED + MCP live (https://core-ai-tools.hacolby.workers.dev)

- **Deployed** via `pnpm run deploy`. DO migration history collapsed to a single clean **v1**
  (this worker never shipped; the template's v1→v4 churn incl. GoogleDocsAgent didn't match our
  exports) — once shipped under v1, add v2+ additively, never rewrite v1.
- **OpenAPI restored**: all `/api/{sessions,revisions,library,models,prompts,assets}` routes are
  zod-openapi-registered (in `/openapi.json`). Pattern that works: `.openapi(createRoute({...,
  responses: 200-only, request body schema INLINE or via a GENERIC `jsonBody<T>()` helper}),
  handler)`; handlers **throw** on error → the root `app.onError`/`errorHandler` maps CoreError →
  status + code. A non-generic `jsonBody` helper erases the type (valid() → unknown) — keep it generic.
- **MCP server LIVE at `/mcp`** (`backend/mcp/server.ts`): JSON-RPC 2.0 Streamable HTTP, no SDK —
  `initialize` / `tools/list` / `tools/call`, 21 tools over the core, §4.2 compact payload for
  image-producing tools, snake_case names. Uses zod v4 native `z.toJSONSchema` (NOT zod-to-json-schema,
  which targets zod v3). Mounted in `_worker.ts` (`url.pathname === "/mcp"`, both handlers). Point an
  MCP client at `https://core-ai-tools.hacolby.workers.dev/mcp`. Read tools work fully; `submit_edit`
  resolves a model then fails at the stubbed provider (expected until live provider bodies land).
- **Registry seeded on remote**: `model_catalog` + `task_model_defaults` (6 task defaults). Config,
  not demo data — needed for model resolution. `/api/models/tasks` returns them live.
- Frontend pages (`/library`, `/sessions`, …) 404 as expected — coming via **Claude Design** (see
  `docs/design/BRIEF.md`, and the memory `frontend-via-claude-design`). Deploy propagation takes ~30s;
  a fresh deploy's first requests may 404/1042 transiently.

## ⛔ Remaining work (needs user action / deploy — cannot proceed autonomously)

- **Frontend (Phases 12–13)**: NOT built. The spec mandates Stitch mockups → user sign-off →
  Jules delegation, and "reshape Navbar + landing LAST". I cannot self-approve mockups. The
  backend is fully ready for the frontend to consume (`/api/*` live, `/ws/session/:uuid` for
  realtime). Template pages remain untouched.
- **Live provider calls**: `providers/{google-image,openai-image}.ts` + understand/segment adapter
  bodies need the attached Gemini/OpenAI docs + the empirical AI Gateway Interactions test
  (blocked on a deploy so `GEMINI_API_KEY` resolves at runtime) + OpenAI model-id verification.
- **Guardian live emission** + the outbox drain cron; the async-video Workflow (>4MB polling);
  `describe_mask` compositing (Images transform). All coded around, calls stubbed.
- **Cron triggers**: `expireStaleApprovals`, `sweepExpiredVideos`, `drainUsageOutbox` need a
  `[triggers] crons` entry + a scheduled handler.

## Phases 4–8 (built: capability layers). Migrations 0008–0010 applied local+remote. 48 tests.

- **Phase 4 — registry + dispatch.** `backend/ai/registry/` = declarative pinned catalog
  (`catalog.ts`, capability flags per addendum §4/§6, NO dynamic "latest", quarterly-review
  note) + queries/enforcement/resolution/seeding (`index.ts`). Resolution order: explicit →
  `sessions.model_overrides` → `task_model_defaults` (D1, authoritative) → **error**.
  `assertCapability` rejects naming capable models (never downgrades). `backend/ai/dispatch/`
  = the single choke point: `dispatch()` runs the provider adapter + emits guardian usage
  (unbypassable), records `served_via`. `guardian.ts` = verified `POST /api/guardian/usage/
  register`, non-blocking `waitUntil`, buffered to `usage_outbox` (0009) + `drainUsageOutbox`
  cron drain, `tokensThinking` separate. `core/revisions/execute.ts` = the orchestrator
  (resolve→enforce→fetch→dispatch→transport-fallback→upload→markSucceeded w/ provenance).
  **DEFERRED-LIVE**: the provider HTTP call bodies (`providers/google-image.ts`,
  `openai-image.ts`) — need the Gemini Interactions docs + the empirical gateway test +
  OpenAI model-id verification. Everything around them is real. `DEFAULT_SERVED_VIA="direct"`
  until the gateway test passes.
- **Phase 5 — semantic masks.** `core/masks/geometry.ts` (Gemini 0–1000 → our 0–1 conversion
  + shoelace coverage — the factor-of-1000 boundary, tested), `semantic.ts` (createSemanticMask:
  resolve segment model → dispatch(segment) → convert → persist proposed + coverage +
  alternatives). The segmentation CALL is deferred-live (understand adapter); conversion +
  persistence are real. `describeMask` compositing still returns `previewUrl:null` (needs
  Images-transform wiring).
- **Phase 6 — SessionDO.** `backend/realtime/session-do.ts` = plain hibernatable-WS DO, sole
  per-session seq allocator (D1 = source of truth). Bound `SESSION_DO` + DO migration **v4** +
  re-exported (`_worker.ts` both blocks + `astro.config.ts` namedExports) + WS route
  `/ws/session/:uuid` (sanctioned raw stub.fetch proxy). `SessionDoEmitter` completed
  (`getByName().appendEvent` RPC, never stub.fetch for dispatch). `factory.ts` uses it when
  SESSION_DO present, else DirectD1Emitter (tests). Live WS needs deploy.
- **Phase 7 — prompts + grading.** `prompts/` domain (0010): `prompt_templates`,
  `prompt_grades`. `core/prompts/` = CRUD + `promoteFromRevision` + `gradeRevision` w/ avg
  rollup + `seedPromptTechniques` (6 technique entries; full guide templates need the attached
  prompting guide). Surfaces land in Phases 10–12.
- **Phase 8 — video + TTL.** DECISION: generalised `library_images` IN PLACE (added
  `media_type`/`storage`/`r2_key`/`duration_ms` + TTL cols `expires_at`/`ttl_days`/
  `ttl_set_by_surface`/`ttl_updated_at`/`bytes_purged_at` + partial expiry index) rather than
  renaming to `library_assets` — avoids the FK blast radius mid-build, reversible to a rename
  (flag for review). Dedicated `R2_VIDEO_BUCKET` (`core-ai-tools-video`). `core/library/video.ts`
  = uploadVideoAsset (R2 + `/api/video/:id` route), setAssetTtl (absolute, null=never),
  sweepExpiredVideos (purge R2 + `bytes_purged_at`, NEVER `deleted_at`, audit event),
  videosExpiringSoon (7-day warn), pin-protects-video (pinRevision clears expiry). **DEFERRED**:
  async >4MB delivery (recommend a **Workflow** that publishes progress via SessionDO — needs a
  Workflow binding + the Omni Flash live call); the `/api/video/:id` Range+410 route (Phase 10).
- **New schema additions on revisions (0008)**: `provider_interaction_id`,
  `provider_conversation_lost`, `grounding_search_suggestions`, `grounding_citations`,
  `served_via`; on sessions: `model_overrides`; new `revision_artifacts` (thinking images).

## Phase 3 (built: CF Images + Secrets) — done apart from two deploy-coupled items

- **Secrets Store bindings added** (`wrangler.jsonc`, `wrangler types`, dry-run validated):
  `CLOUDFLARE_IMAGES_ACCOUNT_HASH`, `CLOUDFLARE_IMAGES_STREAM_TOKEN`, `GEMINI_API_KEY`,
  `OPENAI_API_KEY` (names confirmed by Justin). All access goes through `utils/secrets.ts`
  helpers (`getImagesAccountHash`, `getImagesApiToken`, `getGeminiApiKey`, `getOpenAiApiKey`)
  — never `env.X.get()` at a call site. Keys go in headers only (`x-goog-api-key` /
  `Authorization: Bearer`).
- **`core/images/` module**: `variants.ts` (THUMB/PREVIEW/FULL + `buildVariantUrl` pure /
  `variantUrl`/`variantUrls` env-resolving — **fail loud via `ConfigError` if the account hash
  is unresolved**, never emits `imagedelivery.net/undefined/…`), `direct-upload.ts`
  (`mintDirectUploadUrl` REST `POST /images/v2/direct_upload`; prefers the stream token, falls
  back to the wrangler token on 401/403 and logs a note; secrets never logged), `hosted.ts`
  (`fetchImageBytes`/`fetchImageBase64` via `env.IMAGES.hosted.image(id).bytes()`,
  `uploadImageBytes` via `.hosted.upload()`), `health.ts` (`imagesHealth` — booleans only).
- **Upload wiring** (`core/library/upload.ts`): `createUploadIntent` (mint URL, bytes go
  browser→CF Images), `completeUpload` (register the row post-upload with a full-variant
  delivery URL), `uploadGeneratedImage` (provider output → row, kind='generated', for Phase 4).
- **`CoreContext` gained `env`** (image/provider ops need bindings + secrets); set by `factory.ts`.
- **Tests**: `test/images.test.ts` (5) — variant URL building + the fail-loud paths. Total 28.
- **Deferred (both need a deploy or the secret mirrored to the local store — runtime secret
  resolution can't be faked locally; DOs block `wrangler dev --remote`)**:
  - **AI Gateway Interactions empirical test** — the 3-part test (provider route / universal
    `/ai/run` / direct control) runs the moment `GEMINI_API_KEY` resolves at runtime. Doc
    signal so far: AI Gateway's unified REST API (`/ai/run`, `/ai/v1/chat/completions|responses|
    messages`, Google as `google-ai-studio/<model>`) exposes NO `/v1beta/interactions` route —
    strong prior that the provider route won't proxy it, universal unproven. Not proof.
  - **core-guardian usage client** — contract now known (`POST /api/guardian/usage/register`,
    required `worker`/`provider`/`model`, optional `tokensIn/tokensOut/tokensThinking/costUsd/
    gateway/at/…`, bearer `WORKER_API_KEY`, response `priced: explicit|scraped|unmatched`). Send
    thinking tokens in `tokensThinking` (never fold into `tokensOut`); omit `costUsd` to let
    guardian auto-price; log `priced: "unmatched"` (model-id drift signal). Belongs in the
    shared dispatch wrapper (Phase 4) with non-blocking `waitUntil` + a buffered outbox so an
    outage never drops a usage record.

## Phase 3 (orig notes): Cloudflare Images — API verified against live docs

Binding `IMAGES` added to `wrangler.jsonc` + `wrangler types` (runtime confirms
`ImagesBinding.hosted` exists on compat date 2026-05-25). **The API moved since the spec was
written** — verified facts:
- `env.IMAGES.hosted.*` (token-free, June 2026): `.upload(ArrayBuffer|ReadableStream, opts)`
  → `ImageMetadata {id, filename, uploaded, variants[], requireSignedURLs, draft, ...}`;
  `.image(id).bytes()` → `ReadableStream` of the ORIGINAL bytes; `.image(id).details()`;
  `.list()`; `.image(id).delete()`. `env.IMAGES.input(stream).transform().output().response()`
  for transforms.
- **Direct Creator Upload is NOT in the binding** — still REST
  `POST /accounts/{id}/images/v2/direct_upload` (needs an Images-scoped token), returns
  `{uploadURL, id}`; the browser POSTs bytes straight to `uploadURL` so they never proxy
  through the Worker. This is the only path that satisfies §2.4's no-proxy rule for uploads.
- Delivery URL: `https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>`. **Account
  hash ≠ account id** (public value, dashboard → Images → Developer Resources) — a `var`,
  not a secret. Named variants (thumb/preview/full) are created out-of-band per account.
- **Deviation from spec §2.4 (better)**: fetch-for-provider uses `hosted.image(id).bytes()`
  (original bytes, token-free) instead of fetching the `full` variant URL. Provider output
  uploads back via `hosted.upload()` (server-side proxy is fine there).
- **Out-of-band setup gates** (cannot run live until done): paid Images plan; an Images API
  token in Secrets Store; the account hash var; the thumb/preview/full variants created.
  Collides with the Phase-4 secrets-mechanism deferral — surfaced to the user before building
  the service layer.

## Phase 2 (done): `src/backend/core/` service layer — one core, no surfaces

The entire domain service layer lives under `src/backend/core/`, imported from the barrel
`@/backend/core`. Surfaces (Hono Phase 7, MCP Phase 8, frontend-via-REST) are thin:
parse → validate → call core → serialize. No business logic outside core.

- **Layout**: `errors.ts` (typed CoreError taxonomy + `isUniqueViolation` that walks the
  drizzle cause chain), `fingerprint.ts` (canonical-JSON SHA-256 `edit_fingerprint`),
  `context.ts` (`CoreContext = { db, events }`), `factory.ts` (`createCoreContext(env)` —
  the ONE composition root; swaps the emitter in Phase 6), `invariants.ts` (mirror checks),
  `events/` (emitter interface + `DirectD1Emitter` + `SessionDoEmitter` stub),
  `library/` (folders + images), `sessions/` (create/query/archive), `revisions/`
  (seed/create/lifecycle/tree/query), `masks/`.
- **D1 has no interactive transactions over the binding** — `db.batch()` is the atomic unit.
  Session + seed node are one `batch()`; the seed id is generated up front so
  `root_revision_id` is set in the same insert (no read-back).
- **Contended counters use optimistic retry** (read max → insert → retry on
  `isUniqueViolation`): `attempt_number` (guarded by `uniq_revisions_retry`) in
  `revisions/create.ts`, and event `seq` in `DirectD1Emitter`. A concurrent-collision test
  genuinely triggers real UNIQUE violations in workerd and the loop recovers — never drops.
- **`SessionEventEmitter`**: `DirectD1Emitter` (temporary, **Phase 6 casualty** — delete it)
  is wired by `factory.ts` today. `SessionDoEmitter` is the real cross-DO path, stubbed with
  the exact `env.SESSION_DO.getByName(sessionUuid)` RPC call documented in its header,
  throwing `NotImplementedError` until Phase 6. Flip one line in `factory.ts` to switch.
- **Approval gating** (`decideApproval` in `revisions/create.ts`): gates on policy
  (`always`; `masked_only` + mask) plus heuristic auto-escalation (proposed mask; coverage
  > 0.6) even under `auto`. Cost-ceiling + low-confidence-semantic escalation are Phase 4/5
  seams. `approveRevision` confirms a proposed mask; `expireStaleApprovals(now)` backs the
  (Phase-later) cron via `idx_revisions_expiry`.
- **Seams left for later phases**: CF Images upload/variants (Phase 3 — `registerImage`
  takes already-uploaded ids), model dispatch + registry + fallback (Phase 4 — core creates
  the `queued` revision; a separate `executeRevision`/`markSucceeded`/`markFailed` hook runs
  it), semantic-mask resolution + `describeMask` preview compositing (Phase 5 — `previewUrl`
  is null for now), `SessionDO` + WS fanout (Phase 6).
- **`decompose_image` seam**: `revisions/decompose.ts` — the core landing spot for the §4
  capability. Needs a model call, so it's a **Phase 4** stub (throws `NotImplementedError`
  with the exact update-blueprint body documented inline). Confirmed present, not dropped.
- **Idempotency (`0007`, done)**: `revisions.idempotency_key` (nullable) + partial unique
  index `uniq_revisions_idempotency (session_uuid, idempotency_key) WHERE idempotency_key IS
  NOT NULL`. Applied local + remote. `submitEdit`/`forkRevision`/`retryRevision` accept an
  optional `idempotencyKey`. **Same key = "not sure you got that" → returns the existing
  revision unchanged** (pre-check + a race guard that fetches-and-returns on the unique
  violation). **New key (or none) = "do it again" → a real new attempt.** `retryRevision`
  uses its OWN key, never the original's. Surfaces: MCP tool descriptions should instruct the
  model to supply one; REST accepts it as a header/body field.
- **Tests**: `test/core.test.ts`, 23 tests, `pnpm run test`. Runs in real workerd via
  `@cloudflare/vitest-pool-workers` v4 (`cloudflareTest()` plugin) against a migrated test
  D1 — real `batch()`, `crypto.subtle`, and every SQLite constraint. **Config MUST be
  `vitest.config.mts`** (the pool is ESM-only; a `.ts` config loads as CJS and fails).
  **Per-test isolation**: v4 dropped auto-isolated storage; `test/apply-migrations.ts` calls
  `reset()` (wipes all bindings) + `applyD1Migrations` in a `beforeEach`, so every test gets
  a clean migrated DB — tests may assert global counts freely. Covers: fingerprint stability,
  atomic seed creation, FK-payoff listing, submit/retry/fork + tree attempt-grouping,
  idempotency replay-vs-new-attempt, all approval policies + escalation, cancel/pin, expiry
  sweep, folder no-cycle, image soft-delete, concurrent seq allocation, and archive
  mask-reaping.

## Text-to-image + provider error classification (nanobanana-derived)

- **`generate_image` MCP tool → `core/generate/generateImages`.** Prompt-only generation into the
  library (`kind='generated'`, prompt stored as `description`); returned ids seed `create_session`.
  `expandPrompts` (pure, `core/generate/prompts.ts`) handles count (1–8, always exact), styles ×
  variations cross product, and icon/pattern/diagram/story presets. Non-story renders fan out in
  parallel; story frames run sequentially chaining `previousInteractionId` for consistency. Partial
  failures are returned per prompt; it throws only if nothing rendered.
- **Every adapter error goes through `classifyProviderError` (`core/errors.ts`).** It sets
  `ProviderError.retryable` for 429/5xx/network only — that flag is what lets `executeRevision` fall
  back to another model. Before this, nothing set it and fallback never ran. Never throw a bare
  `ProviderError` from an SDK catch.
- **`CapabilityRequirement` has `text_to_image` / `image_to_image`.** Edits require `image_to_image`,
  so fallback can't pick an understanding-only model (e.g. `gemini-3.6-flash`).

## MCP is CODE MODE now (3 advertised tools, not 30) — measured 91% cheaper

- **`tools/list` advertises `search` / `get_schema` / `execute` only.** Measured
  2026-09-26 against production: named surface 16,185 bytes ≈ **4,046 tokens** per
  session; code mode 1,460 bytes ≈ **365 tokens**. Every tool definition is re-sent on
  every request of every session, so this is a per-turn saving. Rules: `~/AGENTS-mcp.md`.
- **All 30 named tools stay dispatchable.** `tools/call` accepts any name (a client
  with a cached list keeps working), and `GET/POST /mcp?mode=named` restores the full
  advertised surface. Keep descriptions LEAN — a fat `execute` description re-spends
  what code mode saved.
- **`execute` runs the snippet in a real isolate** (`WORKER_LOADERS`), NOT in this
  worker. The isolate gets no bindings and `globalOutbound: null`, so its ONLY channel
  is `env.PARENT` → the **`SELF` service binding** → `POST /internal/mcp-tool`, gated by
  a per-execution nonce stored in `OAUTH_KV` (TTL 600s, revoked when the call returns).
  **The real `WORKER_API_KEY` is never passed into a sandbox.** A Worker fetching its own
  public hostname is error 1042 — that is why this is a service binding, not a fetch.
  Convention the model must follow lives in `EXECUTE_CONVENTION` (`mcp/codemode.ts`):
  an async function body, `await call_tool(name, args)`, `return` a value.
- **Verified live**: one `execute` chaining `list_library` → `create_session` →
  `submit_edit` returned a finished revision. Note `list_library` returns an ARRAY,
  not `{images:[…]}`.

## OAuth: a 1-year grant needs THREE TTLs, not one

`accessTokenTTL` alone is a trap — the grant dies at whichever TTL expires first, and
two default short: `refreshTokenTTL` 30 days and `clientRegistrationTTL` **90 days**.
Claude connects via DCR, so the connector silently broke at 90 days with a "1-year"
config. All three are now `ONE_YEAR_S` in `mcp/oauth.ts`. Never set only one.

## AI routing through core-guardian (Gemini routed; OpenAI images CANNOT be)

- **`GUARDIAN` is bound to the `GuardianRpc` entrypoint** — a service binding IS the
  trust boundary there, so the RPC door needs **no token** (the HTTP
  `/api/ai-router/run` route wants `CLOUDFLARE_AI_GATEWAY_TOKEN`; the RPC door does
  not). `GUARDIAN_HTTP` is a second, plain binding kept for guardian's REST surface
  (`POST /api/guardian/usage/register`) — naming an entrypoint changes what `.fetch()`
  on a binding resolves to, so one binding cannot serve both.
- **`google-image.ts` routes through `env.GUARDIAN.run({ project, importance, provider,
  model, mode: "gateway", input })`.** `importance` is REQUIRED by guardian's `runBody`
  and has no default — omitting it fails validation and the call silently takes the
  fallback. Guardian's gateway mode maps google → `v1beta/interactions`, which is the
  API this adapter uses, so params pass through unchanged apart from `model` (guardian
  merges that itself).
- **422 "not priceable" ≠ 429 breaker.** Guardian fails closed on any google call whose
  model it cannot price, and it cannot price our pinned ids (its pricing rows are keyed
  by display name). A 422-unpriceable therefore falls back to the direct SDK call, loudly,
  still emitting `usage/register`; anything else is surfaced. **Never bypass a spend
  control, and never invent a price to silence the guard.** Open decision:
  `docs/decisions/2026-09-26-guardian-pricing-blocks-gemini-routing.md`.
- **OpenAI image calls cannot route through guardian at all**: guardian hardcodes
  `chat/completions` per provider (no caller-supplied path) and `JSON.stringify`s every
  body, while `images.edit` is multipart. They still traverse **AI Gateway** via the
  SDK `baseURL` and emit `usage/register`. Routing them needs a guardian-side images
  surface — do not fake it here.
- **The `core-ai-tools` AI Gateway now exists.** It was referenced by the `AI_GATEWAY_ID`
  var but never created, so every OpenAI call failed `2001 Please configure AI Gateway`.
  Created 2026-09-26 with `authentication: true`; the `AI_GATEWAY_TOKEN` binding
  (→ `CLOUDFLARE_AI_GATEWAY_TOKEN`) already existed.

## Model catalog: `POST /api/models/sync` (code catalog → D1)

`seedRegistry` had **no caller anywhere in `src/`**, so adding a model to
`registry/catalog.ts` left D1 unaware of it — and `task_model_defaults.model_id` has an
FK onto `model_catalog`, so setting a default for a new model failed as an opaque 500.
There is now an admin-gated `POST /api/models/sync`, and the task-default PUT checks
both catalogs and says which fix is needed. Adding a model = catalog entry → deploy →
`POST /api/models/sync` → `PUT /api/models/tasks/{taskKey}`.

## OpenAI Images 2.5 is the `image_edit` default (native mask channel)

`gpt-image-2.5-flare` (default) and `gpt-image-2.5-sunburst` (premium, tighter control
across edits) registered; ids verified live against `GET /v1/models` 2026-09-26.
Gemini keeps `image_generate`. Rationale: Gemini image models have NO mask channel
(`mask_emulated_only`), OpenAI does — so masked/precision edits are native rather than
emulated. The authoritative switch is D1, not `default_for`:
`PUT /api/models/tasks/image_edit {"modelId":"…"}`.

# The folder/asset/agent platform (Waves 1–4, 2026-09-26)

The product this repo is now: a folder-organised image workspace. Images live in nested
folders, an agent works beside the tree and edits it through the same tools an MCP client
uses, and every image made from an asset traces back to it.

## Folders are the project

There is no `projects` table and there should not be one. **A project IS a folder with
settings.** The onboarding wizard (`/projects/new`) ends by creating a folder; the project
hero shows that folder's settings. Anything that wants "a project" wants a folder.

## Settings inherit, and provenance is part of the answer

Five per-folder settings (default prompt, context, use case, preferred models, approval
policy) resolve up the tree to the nearest ancestor that sets one. `resolveSettings`
returns `{ value, fromFolderId, inherited }` per setting in ONE recursive CTE — the
provenance is not decoration: a prompt inherited from three folders up looks identical to
a local one, and a user who cannot tell will edit the wrong folder.

**`null` means "clear this and inherit again"; absent means "leave it alone".** Every
settings schema is `.nullable().optional()`, never `.partial()`, and only `undefined` is
stripped before core decides with `"key" in input`. Get this wrong and a caller who
mentions one field silently clears the other four.

## Events are emitted from CORE, never from route handlers

`core/library/notify.ts` wraps the FolderDO emit. Folders are mutated from REST, from MCP
and from the agent; emitting per surface is three places that drift, and the agent-driven
path is the one a user is watching live. Emission NEVER fails a mutation — the D1 write
has already committed, so a fan-out failure costs a refresh while a throw would undo work
the caller was told succeeded.

`moveFolder` and `moveImage` read the row BEFORE the write: the updated row carries only
the destination, so the source folder would otherwise never hear it lost a child.

## The agent is routed through core-guardian, and refuses to be otherwise

`ai/agent/folder-agent.ts` points the OpenAI Agents SDK at guardian's
`/v1/chat/completions` over the `GUARDIAN_HTTP` service binding. If `AI_GATEWAY_TOKEN` is
unresolvable it THROWS rather than falling back to a direct provider call — a fallback
would work, cost money, and escape budget and breaker checks. Model ids sent to it are
guardian's routing aliases (`auto`/`best`/`budget`/`cheapest`), not pinned models.

**Its tools are `ALL_TOOLS` from the MCP server**, a deliberate subset (15 of 49). Never
give the agent a private tool set — an agent that edits folders differently from the MCP
surface is two products.

**Tool outcomes are recorded where they are known**, inside the tool wrapper, because
`callToolByName` returns a tool error as CONTENT rather than throwing. A trace derived
from the SDK's item stream marks every call successful — a flag structurally incapable of
being false.

## Multi-model runs rewrite the prompt per model

`core/runs/prompt.ts#buildPromptFor` is pure and tested and branches on CAPABILITY FLAGS,
never a model-id list. Each result row stores `prompt_sent` — the exact text that model
received — which is what makes a comparison readable. A run has NO status column: it
derives from its results, so there is no second copy to drift.

**Gemini image models are `mask_inpainting: false, mask_emulated_only: true`.** The
Interactions API has no mask parameter; the adapter sends the mask as an image part plus a
convention instruction, and the revision is flagged `mask_emulated`. The catalog used to
claim a native channel while its own notes said otherwise — do not "fix" it back.

## Routing traps that have already cost time

- **`apiRoute: "/mcp"` in the OAuth provider is a PREFIX match.** A page at `/mcp-setup`
  answered "MCP endpoint — POST JSON-RPC" to browsers. The setup page is now `/connect`.
  Never add a page under `/mcp` that is not the protocol.
- **The shadcn CLI writes outside the configured alias** (`src/components`, `src/hooks`)
  on nearly every install, and ships `from "cn"` imports this repo cannot resolve.
  Consolidate into `src/frontend/**` and rewrite those imports after every `add`.
- **A 404 immediately after adding a route is usually a stale deploy.** Re-deploy and
  re-check before debugging the route.
- **TypeScript 7 removed `baseUrl`.** `tsc --noEmit` was failing at the CONFIG level, so
  it was not a gate at all. Paths are now relative; keep them that way.

## Frontend shape

`ShellLayout` (ReUI `app-shell-22`, dark-first) wraps every product route. Screens:
`/folders` (tree + contents + settings + docked agent + project hero), `/assets` and
`/assets/[id]` (asset hero + per-folder evolution timelines), `/compare`, `/projects/new`,
`/connect`.

Evolution history is derived from `revLabel`'s dotted notation, keyed by **session AND
label** (labels are minted per session, so `rev1` in two sessions is two nodes), with
missing intermediates INFERRED rather than collapsed — cousins promoted to siblings is the
flattening bug that derivation exists to avoid.
