# Design: Folder-tree image picker + stepped session creation

Date: 2026-07-29
Status: Approved (pending spec review)

## Problem

Two rough spots in session creation today:

1. **Sessions page "New session" modal** shows a flat grid of *all* library
   images with single-select and no folder navigation. Session name is required
   by the backend (`createSession` throws `"A session name (title) is
   required."`) but the modal never collects a name — so creating a session
   from that modal always fails.
2. **Library page** supports multi-select (Move / Delete) and a single-image
   "Start Session", but cannot start a session *from a multi-selection*, and its
   folder sidebar is **flat** — it renders `folders.map(...)` and ignores
   `parentFolderId`, so nested folders don't nest.

We want one coherent flow: browse the library by a **nested folder tree**,
multi-select images **with the selection held across folder navigation**,
designate a **primary**, and create a session where the primary is the origin
and the rest are the session's reference pool.

## Key existing constraints (do not fight these)

- **A session has exactly ONE origin image** — `sessions.origin_library_image_id`
  (hard FK, indexed, "one editing session per source photo"). The seed revision
  anchors on it. Multi-image therefore means: one primary origin + N references.
- **Reference persistence already exists.** `session_images` (join table, roles
  `base | object | style`, unique per session+image) plus helpers
  `upsertSessionReferences`, `listSessionReferences`, `resolveReferenceRoles`,
  `assertReferenceCaps` all landed with the multi-image-reference work. **No new
  table, no migration.**
- Per-model reference caps are enforced at **edit** time (`assertReferenceCaps`
  in the submit_edit path), not at session creation. Creation just fills the
  pool.
- `GET /api/models` returns `listModels()` — the source for the model-override
  dropdown. `modelOverrides` is an existing JSON column on `sessions`
  (`{ "image_edit": "<modelId>" }`), resolved as: explicit request → session
  override → task defaults.

## User decisions (captured during brainstorming)

- Multi-select → **one session**, primary + references. User picks the primary.
- Non-primary selections → **persist to the session** (via existing
  `session_images`), default role **`object`**, with a per-image object/style
  toggle in the review step.
- Stepper inputs: **name + primary required**; **approval policy** and **model
  override** available in an optional/collapsed **Advanced** step (defaults
  preserved).
- Nested folder **tree** used in **both** the new-session picker and the library
  page sidebar.
- **Show the library image id** on selected images across all library instances
  (grid, picker, tray).
- Existing single-image "Start Session" buttons **route through the stepper**,
  pre-seeded with that one image (one consistent creation path).

## Components (frontend)

New files under `src/frontend/components/`:

### `ui/tree.tsx` + `ui/stepper.tsx`
Installed via the reui registry the user specified:
`pnpm dlx shadcn@latest add @reui/c-tree-5` and `@reui/c-stepper-7`.
These pull in `@headless-tree/core`, `@headless-tree/react`, and Hugeicons.
Verify those deps land in `package.json`; if the registry install is not viable
in this repo's setup, vendor the two primitives directly from the snippets the
user provided (they are self-contained).

### `library/FolderTree.tsx`
- Builds a nested tree from the flat `LibraryFolder[]` (`{ id, name,
  parentFolderId }`) using `parentFolderId`.
- Synthetic root node "All images" (id sentinel, e.g. `"__all__"` / `null`).
- Per-folder image count (reuse the existing count logic from `LibraryGrid`).
- `activeFolderId` + `onSelectFolder` props — pure navigation, no rename/move in
  this pass.
- Used by both `LibraryGrid` (replacing the flat sidebar) and `ImagePickerPanel`.

### `library/ImagePickerPanel.tsx`
- Left: `FolderTree`. Right: image grid for the active folder + a **selection
  tray** (chips listing every selected image with thumbnail + truncated library
  id).
- **Selection persists across folders**: selection state is a `Set<imageId>` (or
  ordered `string[]` to preserve pick order), independent of `activeFolderId`.
- Bad-flagged images dimmed/grayscaled (match `LibraryGrid`).
- Each **selected** tile shows a **library-id badge** (truncated, click-to-copy).
- Controlled: `value: string[]`, `onChange`, optional `maxSelectable`.

### `sessions/SessionStepper.tsx`
reui `Stepper`, 3 steps:
1. **Select images** — embeds `ImagePickerPanel`. Skipped (start at step 2) when
   opened from a library multi-selection / single "Start Session"; still
   reachable via Back.
2. **Details (required)** — `title` text input (required; Create disabled until
   non-empty) + **primary picker** over the current selection (radio over
   thumbnails; default = first selected). Per-image **object/style** role toggle
   for the non-primary images.
3. **Advanced (optional, collapsed)** — approval policy (`auto | masked_only |
   always`, default `masked_only`) + model override dropdown (`GET /api/models`,
   filtered to image-edit-capable; empty = inherit).

Validation before Create: `title` non-empty, ≥1 image selected, exactly one
primary. On success `window.location.href = /sessions/<uuid>`.

### Wiring
- `SessionsList.tsx`: replace the current single-select modal with
  `SessionStepper` (opens at step 1).
- `LibraryGrid.tsx`: (a) swap the flat sidebar for `FolderTree`; (b) add a
  **"Create session"** action to the multi-select toolbar → `SessionStepper`
  pre-seeded with `selected`, opening at step 2; (c) route the existing single
  "Start Session" (toolbar + detail drawer) through `SessionStepper` pre-seeded
  with the one image, opening at step 2; (d) show the library-id badge on
  selected grid tiles.

## Backend changes (small)

### `src/backend/core/sessions/create.ts`
- Extend `CreateSessionInput` with optional:
  - `references?: { imageId: string; role: "object" | "style" }[]`
  - `modelOverrides?: Record<string, string>`
- After the atomic `db.batch([insert session, insert seed])`:
  - if `modelOverrides` provided, include it in the session insert values (same
    batch — it's a column on `sessions`, no extra round-trip).
  - if `references?.length`, call `upsertSessionReferences(ctx, sessionUuid,
    references)`. `requireImage` inside it validates each; a missing/soft-deleted
    ref throws `NotFoundError` (surface as a clear error — creation already
    succeeded, so either (a) fold ref-upsert into validation *before* the batch,
    or (b) accept that refs are added post-commit and a bad ref id 4xxs after
    the session exists). **Chosen: validate refs before the batch** (call
    `requireImage` for the primary and every ref up front) so a bad id fails the
    whole create atomically and no orphan session is left.
- Do **not** add the primary to `session_images` — it is the origin, role `base`
  is implicit via `revisions.input_image_id`.

### `src/backend/api/routes/sessions.ts`
POST `/api/sessions` body schema gains (both optional):
```ts
references: z.array(z.object({
  imageId: z.string(),
  role: z.enum(["object", "style"]),
})).optional(),
modelOverrides: z.record(z.string(), z.string()).optional(),
```
MCP `create_session` is left unchanged (new fields optional → back-compat).

## Data flow (create)

```
ImagePickerPanel selection: [id1, id2, id3]  (primary = id2)
  → POST /api/sessions {
      originLibraryImageId: id2,
      title: "...",                 // required
      approvalPolicy?: ...,         // step 3
      modelOverrides?: {...},       // step 3
      references: [                 // non-primary, step-2 roles
        { imageId: id1, role: "object" },
        { imageId: id3, role: "object" },
      ],
      createdVia: "ui",
    }
  → createSession: validate primary + all refs exist
                   → batch(insert session[+modelOverrides], insert seed)
                   → upsertSessionReferences(refs)
                   → SessionCreated event
  → redirect /sessions/<uuid>  (compose pane's ReferencePicker already reads the
                                session pool via listSessionReferences)
```

## Testing

- **Backend unit** (`create.ts`): create with references persists rows in
  `session_images` with the given roles; primary is NOT added to the pool; a bad
  ref id rejects the whole create (no orphan session row); `modelOverrides`
  round-trips onto the session.
- **API**: POST with `references` + `modelOverrides` returns the session and the
  pool is listable via the session view.
- **Frontend**: minimal — a render/interaction check that selection survives a
  folder switch in `ImagePickerPanel`, and that Create is disabled with an empty
  title. (Match whatever test tooling the repo already uses; no new framework.)

## Non-goals (this pass)

- No upload inside the stepper (upload stays on the library page).
- No reference **reordering** beyond object/style tagging (assembly order is
  fixed backend-side: base → object → style).
- No folder rename / move-folder from the tree — navigation + select only.
- No change to MCP `create_session` surface.
