# Multi-image reference support in `submit_edit` — design

**Date:** 2026-07-29
**Branch:** `claude/multi-image-reference-submit-edit-c0f884`

## Problem

Nano Banana / Gemini image models accept up to 14 reference images, but
`submit_edit` today only feeds the single parent/seed image to the provider.
A user cannot say "reproduce the veining of *this* Calacatta Viola slab" — they
can only describe it. We need to feed additional, role-tagged reference images
(a material slab, an object, a style board) into a generation.

## What already exists (from the code map)

The reference-image plumbing is ~80% present:

- `editPayload.reference_image_ids: string[]` is the established carrier for
  references (`create.ts` passes `editPayload` through opaquely;
  `execute.ts:54` already derives a `multi_reference_count` capability
  requirement from it).
- The Google provider's `buildInput` (`ai/providers/google-image.ts:40-50`)
  already appends `referenceImagesBase64` as image blocks **after** the base
  image, capped by `max_reference_images`.
- The MCP tree serializer (`mcp/serialize.ts:112-117`) already emits
  `referenceImageUrls: {imageId, thumbUrl, imageUrl}[]` per revision.
- The capability check (`ai/registry/index.ts:79`) already rejects a request
  whose ref count exceeds `max_reference_images`, naming capable models.

**The one dead wire:** `execute.ts` (around lines 110-118) never resolves
`reference_image_ids` → base64, so `providerRequest.referenceImagesBase64` is
always empty and references never reach the model.

## Decisions (confirmed)

1. **Role storage = session-scoped pool.** A new `session_images` join table
   tags each `(session, library_image)` with a role (`base|object|style`).
   Role lives here, not per-revision.
2. **`editPayload.reference_image_ids` stays `string[]`, stored pre-ordered
   base→object→style at submit time.** Array order *is* assembly order, so
   `execute.ts` and the edit fingerprint need no role-awareness. Role is looked
   up from `session_images` only for display and caps.
3. **Submit input shape:** `references?: Array<{ imageId, role }>` — explicit
   per-image roles, ordered. Upserts roles into the session pool and writes the
   ordered ids into `editPayload.reference_image_ids`.
4. **Ingest = separate `register_image` tool** accepting one of
   `cfImagesUrl` | `imageUrl` | `base64`, plus a `description`. Fetches any
   http(s) URL and re-hosts non-CF images to Cloudflare Images. Returns a
   library id.
5. **Caps enforced at submit time** (not dispatch): clear `ValidationError`,
   never a provider 400.

## Data model

### New table `session_images`

```
id                 text pk (uuid)
session_uuid       text NOT NULL  FK -> sessions.session_uuid  ON DELETE cascade
library_image_id   text NOT NULL  FK -> library_images.id       ON DELETE restrict
role               text NOT NULL  enum('base','object','style')
created_at         integer NOT NULL (unix ts)
UNIQUE (session_uuid, library_image_id)
```

Purpose: the session's reference palette + durable role. `ON DELETE restrict`
on `library_image_id` matches the codebase's replay-integrity convention
(images are soft-delete-only). Follows the existing per-session child-table
pattern (`revision_artifacts`, `masks`).

### `library_images` — add column

```
description  text NULL   -- alt text / provenance supplied at ingest
```

## Backend changes

### `core/library/images.ts` (or new `ingest.ts`) + route + MCP tool
`registerImageFromSource(ctx, source, { description, folderId? }) -> LibraryImage`
where `source` is one of:
- `{ cfImagesUrl }` — parse `cf_image_id` from
  `https://imagedelivery.net/<hash>/<id>/<variant>`; dedup on `cfImageId`
  (return the existing live row if present); call `registerImage`. No re-upload.
- `{ imageUrl }` — `fetch()` the URL, read bytes, `uploadImageBytes` → cfImageId,
  `registerImage`.
- `{ base64 }` — decode, `uploadImageBytes` → cfImageId, `registerImage`.

`deliveryUrl` is built via the existing `variantUrl(cfImageId, FULL)` helper so
the CF Images variant convention holds. `description` is persisted.

MCP tool `register_image` (server.ts) and `POST /api/library/register` wrap it.

### `core/revisions/create.ts` — `SubmitEditInput.references?: {imageId, role}[]`
In `createEditRevision`, after the model is known and before insert:
1. If `references` present: `requireImage` each id (validates existence, not
   soft-deleted).
2. **Caps** (from the static registry entry for `requestedModel`):
   - `object` count ≤ `max_object_refs`
   - `style` count ≤ `max_style_refs`
   - total `references.length` ≤ `max_reference_images`
   - model must have `multi_reference_image === true` when any ref is present
   Any breach → `ValidationError` naming the cap and the count.
3. Upsert each into `session_images (session_uuid, library_image_id, role)`
   (`onConflictDoUpdate` the role).
4. Order `references` base→object→style (stable within role), and set
   `editPayload.reference_image_ids = orderedIds`. Merge into the caller's
   `editPayload` object.

Retry/fork copy `editPayload` verbatim → refs carry forward automatically. The
fingerprint already hashes `editPayload` → a different ref set is a new node,
the same set stacks as a retry. No fingerprint change.

`ponytail:` note — role is read from the mutable session pool, not snapshotted
per-revision. If a role changes in the pool after submit, a later replay reorders.
Acceptable per the session-scoped choice; upgrade path is to snapshot
`[{imageId, role}]` into `editPayload` if strict replay is ever needed.

### `core/revisions/execute.ts` — the gap fix
Where `providerRequest` is built (~lines 110-118): resolve
`editPayload.reference_image_ids` (already ordered) → `requireImage` →
`fetchImageBase64(env, cfImageId)` (already imported), set
`providerRequest.referenceImagesBase64 = [...]`. Preserve order.

### `ai/registry/types.ts` + `catalog.ts` + `index.ts`
- Add `max_object_refs: number` and `max_style_refs: number` to
  `ModelCapabilities`.
- Set per model: Pro (`gemini-3-pro-image`) = 6 / 3; flash-image models that
  currently allow 14 total get sensible sub-caps (6 / 3); zero-ref models = 0/0.
- Add `object_ref_count?` / `style_ref_count?` to `CapabilityRequirement` and
  the corresponding checks in `modelSatisfies` (mirrors the existing
  `multi_reference_count` check). Submit-time enforcement in `create.ts` is the
  primary gate; this keeps dispatch honest as a backstop.

### `mcp/serialize.ts`
`referenceImageUrls` already emitted from `editPayload.reference_image_ids`. Add
`role` per entry by joining `session_images` for the session. Ensure the
`submit_edit` MCP response (not just `get_session_tree`) returns the resolved
references with `thumbUrl`/`imageUrl`/`role`.

## Frontend — `ComposePane.tsx`

Add a role-tagged multi-select reference picker:
- Pull the library (`/api/library`) and/or the session pool.
- Let the user select images and assign each a role (`object` / `style`).
- Write `references: [{imageId, role}]` into the `POST /api/revisions` body.

Today references can only be typed as raw JSON in `JsonPayloadEditor`; this
gives them a real control. `JsonPayloadEditor`'s documented
`reference_image_ids` hint stays valid (advanced path).

## Testing (self-checks, no framework churn)

- Caps: 7 object refs against Pro → `ValidationError`, 6 passes.
- Ingest: `imagedelivery.net/<hash>/<id>/public` parses to `<id>`; dedup returns
  the same row; an arbitrary URL and a base64 blob each yield a live library id.
- Ordering: a mixed object+style ref set is stored base→object→style in
  `reference_image_ids`.

## Acceptance

`submit_edit` with `references: [{imageId: <viola-slab-id>, role: 'object'}]`
produces a render whose feature wall matches the slab's veining, and the
reference appears in `get_session_tree` with a viewable URL and role.

## Out of scope

- Per-revision role snapshot (session pool is authoritative per decision 1).
- OpenAI-adapter reference parity (Google/Nano-Banana is the target).
- A session-reference management UI beyond the compose-pane picker.
