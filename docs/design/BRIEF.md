# Frontend Design Brief — core-ai-tools

For **Claude Design**. Five new pages against the existing template (Astro SSR + React islands +
shadcn **dark** theme, 30 existing pages). Derive the design system from this codebase — reuse its
colors, typography, shadcn primitives, and the `MainNav`/`MobileNav`/`Footer`/`BaseLayout` shell.
Extend the system; do not invent a parallel one. The API contract is live at
`/openapi.json` (base `https://core-ai-tools.hacolby.workers.dev`); build the designs against it.

**Product**: a session-based AI image (and video) editor. A user picks a source photo, issues edits
in natural language or structured JSON, and **every attempt is a node in a revision tree** — editing
is never destructive and never linear (fork from any node; retry the same edit repeatedly). The same
core is exposed over REST, MCP, and this frontend, live over WebSocket.

Global conventions (already in the codebase): dark theme, no 1px borders (rings/dividers), `<MainNav>`
on every page, mobile-responsive with a collapsible sidebar, every table sortable + filterable, all
errors through the global `ErrorLogger`, never `window.alert` (use shadcn `Dialog`/`AlertDialog`).

Realtime: connect a reconnecting WebSocket to `/ws/session/:uuid`; on connect send
`{sessionUuid, lastSeq}`; the server replays missed events then streams new ones
(`revision_created`, `revision_status_changed`, `approval_requested`, …). Connection state must be
visible; falling back to polling is acceptable, silently stale data is not.

---

## 1. `/library` — the image/asset library

**Purpose**: browse, organise, upload source photos; the entry point to starting sessions.

**Data**
- `GET /api/library/folders` → `{ folders: [{ id, name, parentFolderId, ... }] }` (arbitrary nesting).
- `GET /api/library/images?folderId=&limit=` → `{ images: [{ id, cfImageId, deliveryUrl, folderId,
  originalFilename, contentType, width, height, bytes, kind, mediaType('image'|'video'),
  createdAt, deletedAt }] }`. Thumbnails: `deliveryUrl` is the full variant; a thumb variant exists
  (`.../thumb`). Video rows have `mediaType='video'`, delivery via `/api/video/:id`, and may show a
  TTL/expiry badge (`expiresAt`, `bytesPurgedAt`).
- Upload: `POST /api/library/upload-intent` → `{ uploadURL, cfImageId }`; the browser PUTs the file
  **directly** to `uploadURL` (never through our server) with per-file progress, then
  `POST /api/library/complete-upload { cfImageId, ... }` registers the row.
- `POST /api/library/images/:id/move { folderId }`; `DELETE /api/library/images/:id` (soft delete).

**Layout**: folder-tree sidebar (left) + image grid (main). Drag-drop upload with per-file progress.
Multi-select → move to folder / soft delete. Clicking an image opens a **detail panel** showing its
metadata **and every session spawned from it** (`GET /api/sessions?forImage=:id`), with a
"Start new session" action (`POST /api/sessions { originLibraryImageId }`).

**States**: empty (no images → prominent drag-drop dropzone), loading (skeleton grid), error, mobile
(sidebar collapses to a drawer; grid → single column). Video assets: show a play affordance + an
"expires in N days" badge; a **purged** video (`bytesPurgedAt` set) renders "expired on <date>" with a
regenerate action, never a broken player.

## 2. `/sessions` — the sessions table

**Purpose**: find and resume sessions.

**Data**: `GET /api/sessions?status=&limit=&offset=` → `{ sessions: [{ sessionUuid, title,
originLibraryImageId, status('active'|'archived'), approvalPolicy, createdVia, createdAt,
lastActivityAt }] }`. Show a thumbnail of the origin image, title, revision count, last activity,
status, originating surface (ui/api/mcp).

**Layout**: sortable + filterable table (reuse the template's data-table pattern from `/tasks`).
Row → `/sessions/[uuid]`. Archive action (`POST /api/sessions/:uuid/archive`).

**States**: empty (link to `/library` to start one), loading (skeleton rows), error, mobile (table →
stacked cards).

## 3. `/sessions/[uuid]` — the centerpiece (three panes)

**Purpose**: work a session — see the revision tree, inspect a revision, compose the next edit. Live
over WebSocket.

**Data**: `GET /api/sessions/:uuid` → `{ session, tree }`. The `tree` is
`{ sessionUuid, root, nodes: [{ key, parentRevisionId, editFingerprint, attempts: [Revision...],
latest: Revision, children: [node...] }] }`. A `Revision` carries: `id, parentRevisionId,
attemptNumber, status('queued'|'awaiting_approval'|'running'|'succeeded'|'failed'|'rejected'|
'expired'|'cancelled'), promptText, editPayload, blueprint, maskId, maskMode, requestedModel,
servedModel, provider, fallbackReason, inputImageId, outputImageId, errorCode, errorMessage,
latencyMs, costEstimate, isPinned, approvalRequired, approvalExpiresAt, servedVia,
groundingSearchSuggestions, ...`.

### Pane A — Tree canvas (the hard part)
Revision tree as a node graph, **root at left, branches flowing right**. Each node = a thumbnail with
a **status ring** (colour by status). **Retry attempts are grouped into ONE node** as a
stacked/carousel group with an attempt counter — NEVER as sprawling sibling branches (the data already
groups them: `node.attempts[]`, `node.latest`). The **seed node** (root) renders as the original
image, not an edit. Pan, zoom, click-to-select, keyboard nav. Nodes **animate in live** as WebSocket
events arrive (a `running` node pulses; `succeeded` fills the thumb). A fallback-served node
(`fallbackReason` set / `servedModel` ≠ `requestedModel`) shows a visible provider badge.
Use a lightweight client-side tree/DAG layout lib — do not hand-roll graph layout, do not pull a heavy
viz framework.

### Pane B — Detail pane
Selected revision: full `promptText`, `editPayload` JSON, `blueprint`, provider/model, latency, cost,
error detail on failure. Actions: **Fork** (`POST /api/revisions/fork`), **Retry**
(`POST /api/revisions/:id/retry`), **Pin** (`POST /api/revisions/:id/pin`).
- **Diff / comparison view** (critical): default shows only the new image. A toggle switches to compare
  against `parent.outputImageId` (uniform — the seed's output IS the original, no first-edit special
  case). Three modes: **Slider** (draggable split, default), **Side-by-side** (synchronized pan+zoom),
  **Onion skin** (opacity blend). **Hard requirement: both images render at identical dimensions and
  zoom** — any letterboxing or independent scaling defeats the purpose (the primary use case is
  room-visualisation; detecting perspective/dimension drift is the whole point). Add a **"perspective
  drift" quick-check**: onion-skin + edge detection on both images. Deep-linkable via `?compare=1`. If a
  mask was used, overlay its outline in both panes. Use a shadcn-compatible comparison component (reui
  ships one — verify its current API before wiring).
- If `status='awaiting_approval'`: show the **approval card** (see below).

### Pane C — Compose pane
Natural-language OR structured-JSON edit entry + **model picker** + submit
(`POST /api/revisions { sessionUuid, parentRevisionId, editPayload|promptText, requestedModel, maskId?,
maskMode? }`, send an `Idempotency-Key` header). 
- **Model picker**: `GET /api/models` (registry: id, capabilities, cost). Show the session default and
  allow a per-session override. Capability-gate: if the picked model lacks a requested capability, the
  API returns 422 naming the models that do — surface that, don't silently downgrade.
- **Mask brush**: brush/rectangle/polygon tool over the source image → rasterises to PNG → creates a
  `masks` row (produces the same `mask_id` MCP consumes). Modes: `inpaint` (change inside) /
  `preserve` (change outside).

**Approval card** (HITL, §4.3): the WHOLE decision on one screen — mask overlaid on the source, the
full prompt, selected model, cost estimate. Approve (`POST /api/revisions/:id/approve`) → queues +
confirms the mask. Modify → opens the brush preloaded with the model's attempt (saving creates a NEW
mask linked by `derivedFromMaskId`). Reject (`POST /api/revisions/:id/reject { reason }`) → stays in
the tree. Appears **instantly** via WebSocket when an MCP-authored masked edit arrives.

**States**: empty (only the seed node), loading (skeleton tree + panes), error, in-flight (a node
mid-generation must render as a live node, not a frozen UI), disconnected (visible WS state + polling
fallback), mobile (three panes → tabbed or stacked; tree canvas gets a dedicated full-screen mode).

## 4. `/prompts` — prompt best-practices library

**Purpose**: browse/apply prompt templates; a live prompting aid.

**Data**: `GET /api/prompts?category=&q=` → `{ templates: [{ id, title, category, templateBody,
examplePrompt, recommendedModel, recommendedSettings, techniqueTags, source('seeded'|'promoted'|
'manual'), useCount, avgGrade }] }`. Categories: photorealistic, text-in-image, product-mockup,
inpainting, style-transfer, composition, detail-preservation, sketch-to-photo, character-consistency,
sequential-art, minimalist, grounding, video, room-visualisation, technique.

**Layout**: category filter + search + card grid. Each card: title, category chip, body preview,
recommended model/settings, avg grade, use count. **"Use this template"** (`POST /api/prompts/:id/use`)
populates the compose pane on the session page. Create (`POST /api/prompts`), soft delete. A
"promote from revision" flow exists (`POST /api/prompts/promote`) surfaced on the session detail pane.

**States**: empty (seeded techniques always present), loading, error, mobile (single-column cards).

## 5. `/models` — model registry + task defaults

**Purpose**: see available models + their capabilities; set the authoritative task→model mapping.

**Data**: `GET /api/models` → `{ models: [{ id, provider, display_name, capabilities{...flags,
max_reference_images, max_resolution, supported_aspect_ratios, cost_per_image}, deprecated,
default_for, notes }] }`. `GET /api/models/tasks` → `{ defaults: [{ taskKey, modelId, enabled }],
broken: [...] }`. Set: `PUT /api/models/tasks/:taskKey { modelId, enabled }`.

**Layout**: a capability matrix table (models × capability flags — checkmarks), a cost column, and
`is_new`/`deprecated` badges. A "task defaults" panel mapping each task_key (image_generate, image_edit,
video, understand, segment, decompose) to a model, editable inline. **Broken mappings** (a default
pointing at a missing/deprecated model) must alert loudly — a banner + red row.

**States**: empty (never — registry is code-seeded), loading, error, mobile (matrix → horizontal scroll
inside an `overflow-x:auto` container; never let the page body scroll sideways).

---

## Reuse checklist (extend, don't reinvent)
- Shell: `BaseLayout.astro`, `MainNav.tsx`, `MobileNav.tsx`, `Footer.tsx`, `ThemeToggle.tsx`.
- Data tables: the `/tasks` table pattern (sort/filter/paginate) for `/sessions` and `/models`.
- shadcn primitives already in the repo (Dialog, AlertDialog, Card, Table, Tabs, Badge, etc.).
- Charts (if any cost/grade viz): the shadcn `ChartContainer` + Recharts with the Monolith OKLCH palette.
- Error surfacing: the global `ErrorLogger`.

## Navbar + landing (LAST, strictly reorchestration)
Not part of the five pages. After they exist: regroup the Navbar so Library / Sessions are first-class
(existing links stay, `/openapi.json` `/scalar` `/swagger` links remain); reshape the landing hero to
present this product with real entry points into Library and Sessions.
