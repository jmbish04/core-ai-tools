# Build Prompt — `core-ai-tools` Image Editing Platform

> Paste this into your coding agent from inside the freshly-created `jmbish04/core-ai-tools` repo
> (scaffolded from `core-template-cfw-assets-astro-shadcn`).

---

## 0. Read this first

You are building a **multi-surface AI image editing platform** on Cloudflare Workers inside an existing
Astro SSR + Hono + D1 + shadcn template. Load and obey the `cloudflare-jedi` skill in full before writing
any code. Every golden rule in it applies here — modular schema folders, `wrangler types` after every
binding change, no raw SQL migrations, no `window.alert`, no mock data, shadcn dark theme, `<Navbar />` on
every page, sort + filter on every table, global `ErrorLogger`, mobile-responsive with collapsible sidebar.

### Non-negotiable scope constraint on the existing template

**Leave every existing page in place. Do not delete, rename, or gut any page that ships with the template.**

Your only permitted changes to existing frontend surface area are:

1. **Navbar** — reorchestrate it to accommodate the new sections. Existing links stay, but you may regroup
   them (e.g. under a dropdown) so the new Library / Sessions entries are first-class. `/openapi.json`,
   `/scalar`, and `/swagger` links remain present as always.
2. **Landing page (`src/pages/index.astro`)** — reorchestrate it to present this product. Replace the
   template's placeholder hero content with real entry points into the Library and Sessions.

Everything else you build is **additive**: new routes, new pages, new schemas, new components.

---

## 1. What we are building

A session-based image editor where a user picks a source photo, issues edits in natural language or as a
structured JSON payload, and every single attempt is persisted as a node in a **revision tree**. Editing is
never destructive and never linear — you can fork from any point, and you can retry the same edit repeatedly
until it comes out right.

The same capabilities are exposed three ways, over one shared core:

- **MCP server** — so the user can drive a session from Claude.ai or any MCP client
- **REST API** — Hono + `@hono/zod-openapi`, fully documented
- **Frontend** — Astro SSR + React islands, live over WebSocket

A user must be able to start a session in the browser, walk away, continue it from Claude.ai, and watch the
new revisions appear in the still-open browser tab in realtime. **This interoperability is the defining
requirement of the product — treat any design that compromises it as wrong.**

---

## 2. Architectural rules

### 2.1 One core, three thin surfaces

Create `backend/core/` containing the entire domain service layer. Every operation — create session, submit
edit, fork, retry, upload to library, move folder — is a function here.

- Hono route handlers are **thin**: parse → validate → call core → serialize.
- MCP tool handlers are **thin**: parse → validate → call core → serialize.
- The frontend calls the REST API. It never contains business logic.

If a behavior exists in one surface and not the others, it is a bug. Do not duplicate logic across surfaces
under any circumstances.

### 2.2 Realtime via a Durable Object per session

Create a `SessionDO` Durable Object, one instance per `session_uuid`, keyed by
`env.SESSION_DO.idFromName(sessionUuid)`.

- The DO owns all WebSocket connections for that session. Use **hibernatable WebSockets**
  (`acceptWebSocket` / `webSocketMessage`) so idle sessions cost nothing.
- **D1 is the source of truth. The DO is a fanout and progress channel, not a store.** Never let DO state
  drift into being authoritative.
- Every mutating core operation, regardless of which surface invoked it, must publish an event into the
  session's DO after the D1 write commits. This is what makes an MCP-driven edit appear live in the browser.
- Long-running generation streams progress events (`queued` → `running` → `succeeded` / `failed`) through
  the DO so the UI can render in-flight nodes rather than freezing.
- On WebSocket connect, the client sends its last known event sequence number; the DO replays anything
  missed from D1. Assume reconnects are routine.

### 2.3 Selectable model registry

This is **model selection**, not a single provider with a spare tyre. Gemini is the default, but the user
must be able to pick a specific model per edit, and adding a new model later must not require touching
anything outside `backend/ai/`.

Per `cloudflare-jedi`, providers live in `backend/ai/providers/` with a single `index.ts` entrypoint:

- `google.ts` — Gemini image models. **Default provider.**
- `openai.ts` — OpenAI image models.
- `workers-ai.ts` — any Workers AI image model worth exposing.
- `index.ts` — exports `createImageEditor()` and the model registry.

**Build a declarative model registry.** One entry per selectable model, each declaring:

```
id, provider, display_name, capabilities: {
  text_to_image, image_to_image, mask_inpainting, multi_reference_image, blueprint_json
},
max_resolution, supported_aspect_ratios, cost_per_image, default_for: []
```

The registry is the single source of truth. It drives the model picker in the UI, an
`list_available_models` MCP tool, and the `/api/models` endpoint — all three read the same registry, none
hardcode a list. Capability flags are enforced before dispatch: if a request asks for masked inpainting on a
model whose `mask_inpainting` is false, reject it with a clear error naming which models *do* support it.
**Do not silently downgrade a masked edit into an unmasked one.**

Route all calls through **AI Gateway**.

Fallback still exists, but it is now a secondary behavior layered on top of selection:

- Fall back only on transport failure, 5xx, timeout, or rate limit — and only to another model whose
  capability flags satisfy the original request.
- **Do not** fall back on a content-policy refusal or a validation error. Surface those; retrying elsewhere
  usually fails the same way and just burns money.
- Every revision records `requested_model` and `served_model` plus `fallback_reason` when they differ. Badge
  any fallback-served revision visibly in the UI.

### 2.4 Cloudflare Images, not R2

All image bytes live in Cloudflare Images. D1 stores the image ID, the delivery URL, and metadata — never
the bytes.

- Browser uploads use **direct creator upload URLs**, minted by the Worker. Image bytes must not be proxied
  through the Worker on upload.
- Define named variants for `thumb`, `preview`, and `full`; the tree view uses `thumb` exclusively, or it
  will be unusable on a large session.
- To feed a provider, the Worker fetches the `full` variant and base64-encodes it. Provider output is
  uploaded back to CF Images, and the returned ID is written to the revision row.
- Verify the current Cloudflare Images upload and variant APIs against live documentation before
  implementing — do not code from memory on this.

---

## 3. Data model (D1 + Drizzle)

Follow the modular schema convention: `backend/db/schemas/${category}/${subcategory}/${table}.ts`, with an
`index.ts` re-export at every level. Generate migrations with `pnpm run db:generate` — never hand-write SQL.

### `library/` domain

**`library_folders`**
`id`, `name`, `parent_folder_id` (self-FK, nullable = root), `created_at`, `updated_at`.
Arbitrary nesting. Enforce no-cycles on move.

**`library_images`**
`id`, `cf_image_id`, `delivery_url`, `folder_id` FK, `original_filename`, `content_type`, `width`, `height`,
`bytes`, `kind` (`stock` | `staged` | `generated`), `uploaded_via` (`ui` | `api` | `mcp`), `created_at`,
`deleted_at` (soft delete only — a hard delete would orphan revision history).

### `sessions/` domain

**`sessions`**
`session_uuid` (PK, UUIDv4), `title`, `origin_library_image_id` **FK → `library_images.id`**, `status`
(`active` | `archived`), `root_revision_id`, `created_via`, `created_at`, `updated_at`,
`last_activity_at`.

> The `origin_library_image_id` FK is a hard requirement: it must be possible to select any library photo and
> list every session ever spawned from it. Index it.

**`revisions`** — the tree
`id`, `session_uuid` FK, `parent_revision_id` (self-FK, **nullable only for the root node**),
`attempt_number`, `edit_fingerprint`, `status` (`queued` | `awaiting_approval` | `running` | `succeeded` |
`failed` | `rejected` | `expired` | `cancelled`),
`prompt_text` (**the full prompt, verbatim, always**), `edit_payload` (JSON), `blueprint` (JSON, nullable),
`mask_id` FK → `masks` (nullable), `mask_mode` (`none` | `inpaint` | `preserve`),
`requested_model`, `served_model`, `provider`, `fallback_reason`, `input_image_id` FK → `library_images`,
`output_image_id` FK → `library_images` (nullable until success), `error_code`, `error_message`,
`latency_ms`, `token_usage` (JSON), `cost_estimate`, `created_via` (`ui` | `api` | `mcp`), `is_pinned`,
`approval_required`, `approved_by_surface`, `approved_at`, `rejection_reason`, `approval_expires_at`,
`created_at`.

Tree semantics — implement exactly:

- **Fork** = a new revision whose `parent_revision_id` is any existing node. Any node is forkable, including
  failed ones. This yields the branching tree.
- **Retry** = a new revision sharing the *same* `parent_revision_id` **and** the same `edit_fingerprint`
  (a stable hash of the normalized edit payload) as an existing sibling, with `attempt_number` incremented.
  This is the "hammer the same edit until it's right" case and the UI must render these as a stacked
  attempt group on one node, not as N sprawling sibling branches.
- `is_pinned` marks the accepted result on a branch.
- Index `(session_uuid, parent_revision_id)` and `(session_uuid, edit_fingerprint)`.

**`masks`**
`id`, `session_uuid` FK (nullable — masks can be library-scoped and reused), `source_image_id` FK →
`library_images`, `kind` (`bbox` | `polygon` | `raster` | `semantic`), `geometry` (JSON — normalized 0–1
coordinates so a mask survives resolution changes), `cf_image_id` (nullable, for rasterized/uploaded mask
PNGs), `feather_px`, `label`, `state` (`proposed` | `confirmed` | `rejected`),
`derived_from_mask_id` (self-FK, nullable — set when a user corrects a proposed mask),
`coverage_ratio` (0–1, fraction of frame covered), `created_via`, `created_at`, `confirmed_at`.

Masks are **first-class, addressable, and reusable** — see §4.1 and §4.3.

**`revision_events`** — append-only
`id`, `session_uuid` FK, `revision_id` FK (nullable), `seq` (monotonic per session), `event_type`,
`payload` (JSON), `created_at`.
This is both the audit log and the WebSocket replay buffer.

---

## 4. Capability surface

Every capability below must exist in **all three** surfaces with identical semantics.

| Capability | Notes |
|---|---|
| `create_session` | From a `library_image_id`, or from an inline upload that is first written to the library. Returns `session_uuid`. |
| `resume_session` | By `session_uuid`. Returns full state + tree. |
| `list_sessions` | Filter, sort, paginate. |
| `list_sessions_for_image` | All sessions descending from one library image — the FK payoff. |
| `get_session_tree` | Full revision tree, attempts grouped, thumb URLs. |
| `submit_edit` | `session_uuid`, `parent_revision_id`, `instruction` **or** structured `changes`, optional `provider`. Creates a revision, returns immediately with `queued`, streams progress via DO. |
| `retry_revision` | New attempt, same parent + same fingerprint. |
| `fork_revision` | Explicit branch from any node. |
| `decompose_image` | Image → structured JSON blueprint, cached on the revision, enabling targeted field-level edits rather than prompt-nudging. |
| `pin_revision` | Mark accepted result. |
| `cancel_revision` | Cancel in-flight work. |
| `upload_library_image` | Mints direct upload URL; registers row on completion. |
| `list_library` / `create_folder` / `move_image` / `rename_folder` | Full folder CRUD. |
| `list_available_models` | Reads the registry; returns ids, capabilities, cost. |
| `create_mask` / `list_masks` / `describe_mask` | See §4.1. |
| `approve_revision` / `reject_revision` | HITL gate, see §4.3. Available from all three surfaces. |

### 4.1 Masking — the hard part over MCP

Fine-detail edits need masks, but an MCP client has no canvas. Solve this by making a mask a **stored,
addressable object** rather than a blob passed inline, and by supporting several ways to author one:

- **`bbox`** — `{x, y, w, h}` in normalized 0–1 coordinates. The workhorse for MCP; a model can reason about
  "the upper-left third of the wall" and emit numbers.
- **`polygon`** — array of normalized points, for non-rectangular regions.
- **`semantic`** — a natural-language region description (`"the kitchen island"`) that the server resolves
  into a raster mask via a segmentation pass, then persists. This is the most ergonomic MCP path: the model
  says what it means and gets back a `mask_id` it can inspect and reuse.
- **`raster`** — an uploaded PNG with alpha, which is what the UI's brush tool produces.

Every authoring path terminates in a row in `masks` with a `mask_id`. `submit_edit` then takes
`mask_id` + `mask_mode`, never inline mask data.

`describe_mask` must return a **preview URL of the mask composited over the source image** so the MCP client
can visually confirm the region before committing to an expensive edit. Blind masking is a bad experience.

`mask_mode` semantics: `inpaint` = change only inside the mask; `preserve` = change everything except inside
the mask. Both are useful and they are not the same operation.

> **Verify before building:** provider support for true mask-channel inpainting differs sharply — some image
> APIs accept a mask image directly, others only honour masks as prompt guidance. Check the current docs for
> each model you register and set the `mask_inpainting` capability flag honestly. Where a model lacks native
> mask support, the adapter may implement masked editing by compositing the model's output back over the
> original outside the mask region — but it must set a `mask_emulated: true` flag on the revision so the user
> knows the difference.

### 4.2 MCP return payload contract

**Do not return full image bytes as the default MCP response.** Inlining a base64 image on every edit floods
the client's context, and this app is built around sessions with dozens of revisions.

Every image-producing MCP tool returns a compact JSON payload:

```json
{
  "revision_id": "...",
  "session_uuid": "...",
  "status": "succeeded",
  "image_url": "<Cloudflare Images direct delivery URL, full variant>",
  "thumb_url": "<thumb variant>",
  "app_url": "https://<host>/sessions/<uuid>?revision=<revision_id>",
  "compare_url": "https://<host>/sessions/<uuid>?revision=<revision_id>&compare=1",
  "parent_revision_id": "...",
  "served_model": "...",
  "mask_id": null,
  "attempt_number": 1,
  "approval_url": "<present only when status is awaiting_approval>",
  "mask_preview_url": "<mask composited over source, when a mask is used>"
}
```

- `image_url` is the direct CF Images URL — pasteable, hotlinkable, renderable by any client that fetches
  URLs.
- `app_url` deep-links to that exact revision in the frontend, with the tree focused on that node, so the
  user can hop from Claude into the app mid-session.
- `compare_url` opens the same page with the diff view already toggled on (§5.1).
- Provide an **opt-in** `include_image: true` parameter that additionally attaches a small preview as a real
  MCP image content block. Off by default. Document in the tool description that it consumes significant
  context.

### 4.3 Human-in-the-loop approval for proposed masks

A mask authored from MCP is a blind estimate — the model is guessing normalized coordinates or trusting a
segmentation pass. Masked edits are therefore gated by default. **The gate must be non-blocking.**

Add `approval_policy` to `sessions`: `auto` | `masked_only` (**default**) | `always`.

Flow:

1. An MCP-authored mask is created in `state = 'proposed'`.
2. `submit_edit` referencing a proposed mask (or any edit, under `always`) creates the revision with
   `status = 'awaiting_approval'` and **returns immediately**. The MCP tool never blocks and never polls.
   The response carries `approval_url` deep-linking to the approval card, plus the mask preview URL.
3. The `SessionDO` pushes an approval event, so any open browser surfaces the card instantly.
4. The card shows **the whole decision on one screen**: mask overlaid on the source, the full prompt, the
   selected model, and the cost estimate. Gate the *edit*, not the mask alone — approving a mask and then
   discovering the prompt was wrong is two round trips.
5. Outcomes:
   - **Approve** → mask `confirmed`, revision → `queued`, executes normally.
   - **Modify** → opens the brush tool preloaded with the model's attempt. Saving writes a **new** mask row
     with `derived_from_mask_id` pointing at the proposal, and the revision repoints to it before running.
     Never mutate the proposed mask in place — the delta between proposed and corrected is the signal.
   - **Reject** → revision → `rejected` with `rejection_reason`. The node stays in the tree.
6. `approval_expires_at` defaults to 24h; a sweep marks lapsed revisions `expired` so they don't accumulate
   as zombie nodes.

Approval is available from **all three surfaces** — `approve_revision` / `reject_revision` MCP tools,
`POST /api/revisions/:id/approve`, and the UI card. A user who trusts a proposal can approve it from the
same Claude conversation that created it without opening a browser. That preserves the headless path while
still defaulting to a check.

**Heuristic auto-escalation** — force approval even when policy is `auto` if any of these hold:

- `coverage_ratio` > 0.6 (a mask covering most of the frame is usually a failed mask)
- `kind = 'semantic'` and the segmentation pass returned low confidence
- estimated cost exceeds a configurable per-edit ceiling

Record every approval decision in `revision_events`. The proposed-vs-corrected mask lineage is the metric
that tells the user whether the gate is still earning its keep — expose it as a simple accuracy stat on the
session view.

**MCP server**: mount at `/mcp` using the Agents SDK `McpAgent` pattern with Durable Object backing.
Streamable HTTP transport. Tool names snake_case, matching the table above. Every tool description must
state explicitly that the operation is session-scoped and that results are visible in the web UI in
realtime — the model needs to know it is participating in a shared session.

**REST API**: `/api/*` via `OpenAPIHono`. Every route registered with zod-openapi; use `drizzle-zod` to
derive schemas from the Drizzle tables so the spec can never drift from the database. `/openapi.json`,
`/scalar`, `/swagger` stay dynamic and Navbar-linked.

---

## 5. Frontend

Per `cloudflare-jedi`: generate Stitch mockups for every new page **first**, review them yourself for missing
states (empty, loading, error, mobile), fill the gaps with additional Stitch calls, then present a summary
and wait for sign-off before building. Delegate React island and Astro page implementation to Jules with a
maximally detailed prompt; keep schema, migrations, bindings, DO, and deployment for yourself. Update
`/AGENTS.md` before delegating.

### New pages

**`/library`** — folder tree sidebar + image grid. Upload via drag-drop to direct upload URL with per-file
progress. Multi-select, move to folder, soft delete. Clicking an image opens a detail panel showing its
metadata and **every session spawned from it**, with a "Start new session" action.

**`/sessions`** — sortable, filterable table of sessions: thumbnail of origin image, title, revision count,
last activity, status, originating surface.

**`/sessions/[uuid]`** — the centerpiece. Three panes:

- *Tree canvas* — the revision tree rendered as a node graph, root at left, branches flowing right. Each node
  is a thumbnail with a status ring. Retry attempts render as a stacked/carousel group inside a single node
  with an attempt counter, never as separate branches. Pan, zoom, click-to-select, keyboard navigation. Nodes
  animate in live as WebSocket events arrive. Fallback-served nodes carry a visible provider badge.
- *Detail pane* — selected revision: full prompt text, edit JSON payload, blueprint, provider/model,
  latency, cost, error detail on failure. Fork, retry, and pin actions.
- *Compose pane* — natural-language or JSON edit entry, provider override, submit.

Pick a lightweight client-side tree/DAG layout library; do not hand-roll graph layout, and do not pull in a
heavy visualization framework for this.

### 5.1 Image diff / comparison view

The detail pane shows **only the newly generated image by default.** A toggle button switches it into
comparison mode against `parent_revision.output_image` (or, at the root, the original library image).

Use a shadcn-compatible image comparison component — reui ships one; verify the current API before wiring it
in rather than assuming the prop shape. Offer at minimum:

- **Slider** — draggable split, the default mode
- **Side-by-side** — synchronized pan and zoom across both panes
- **Onion skin** — opacity blend, which is the mode that actually exposes geometry drift

Deep-linkable via `?compare=1` so `compare_url` from the MCP payload lands directly in this view. If a mask
was used, overlay its outline in both panes.

**Why this matters for the primary use case:** the first workload is home-remodel room visualization —
re-imagining an actual room from a photograph. Image models routinely drift on camera perspective, room
dimensions, and colour temperature while nominally only changing a countertop. The diff view is the
detection mechanism for exactly that failure, so treat it as core functionality, not a nicety. Two
consequences for the build:

- The comparison must align both images at identical dimensions and zoom. Any component that letterboxes or
  independently scales the two sides defeats the entire purpose.
- Add a **"perspective drift"** quick-check: onion-skin mode with edge detection toggled on both images,
  making a shifted wall line or changed focal length immediately visible. Small effort, very high value for
  this use case.

### 5.2 Mask authoring in the UI

The compose pane gets a brush/rectangle/polygon mask tool over the source image. It rasterizes to PNG,
uploads to CF Images, and creates a `masks` row — producing the same `mask_id` the MCP surface consumes.
A mask created in the browser must be reusable from Claude, and vice versa.

### WebSocket client

A single reconnecting client with exponential backoff, resuming from last `seq`. Connection state must be
visible in the UI. Falling back to polling when the socket is unavailable is acceptable; silently showing
stale data is not.

---

## 6. Bindings

Add to `wrangler.toml`, then immediately run `wrangler types`:

- `DB` — D1
- `SESSION_DO` — Durable Object namespace for `SessionDO`, with migration entry
- `AI` — Workers AI / AI Gateway binding
- `IMAGES` — Cloudflare Images binding, if available in the current runtime for transforms

Secrets (via `wrangler secret put`, never committed):
`GEMINI_API_KEY`, `OPENAI_API_KEY`, `CF_ACCOUNT_ID`, `CF_IMAGES_TOKEN`, `AI_GATEWAY_ID`

---

## 7. Build order

1. Bindings + `wrangler types` + schema + first migration
2. `backend/core/` service layer with unit tests, no surfaces attached
3. CF Images integration — upload URL minting, variants, fetch-for-provider
4. Model registry + provider modules + capability enforcement + fallback, behind the AI Gateway
5. Mask subsystem — all four authoring kinds, `describe_mask` preview compositing, HITL approval state machine
6. `SessionDO` + event log + WebSocket fanout
7. Hono routes + OpenAPI spec
8. MCP server over the same core, including the §4.2 return payload contract
9. Stitch mockups → sign-off → Jules for frontend, including the diff and mask-brush components
10. Navbar + landing page reorchestration **(last, and strictly limited to these two)**

## 8. Definition of done

- A session started in the UI can be continued from Claude.ai via MCP, and the browser shows the new
  revisions live without a refresh.
- Forking from a mid-tree node produces a correct branch; three retries of one edit render as one node with
  three attempts.
- Every revision row contains the complete prompt, edit payload, mask reference, and served model — enough
  to replay it exactly.
- A masked edit created in the browser can be re-run from Claude by `mask_id`, and a `semantic` mask created
  from Claude can be edited with the browser brush tool.
- An MCP edit returns a CF Images URL and a working deep link, with no image bytes in the response unless
  `include_image` was explicitly set.
- The model picker is driven entirely by the registry; requesting masked inpainting on a model that lacks it
  produces a clear error naming the models that do.
- Killing the Gemini key mid-session falls back cleanly to another capable model, visibly badged in the UI.
- The comparison view aligns both images identically and makes a deliberate perspective shift obvious.
- A masked edit submitted from MCP returns immediately as `awaiting_approval` with a working approval link,
  never blocking the tool call, and the approval card appears in an open browser without a refresh.
- Approving from Claude, from the API, and from the UI all produce identical results.
- Correcting a proposed mask in the brush tool creates a new mask row linked by `derived_from_mask_id`,
  leaving the original proposal intact.
- Selecting any library image lists every session descended from it.
- Every page that shipped with the template still exists and still works.
