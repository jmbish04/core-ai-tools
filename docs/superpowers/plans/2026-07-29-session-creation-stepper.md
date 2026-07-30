# Folder-tree Image Picker + Stepped Session Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users browse the library by a nested folder tree, multi-select images (selection held across folders), designate a primary, and create a session via a stepper modal where the primary is the origin and the rest persist as the session's reference pool.

**Architecture:** Backend gains two optional inputs on `createSession` (`references`, `modelOverrides`) and surfaces the session's reference pool in `getSessionView`; no schema migration (the `session_images` table + helpers already exist). Frontend adds three reusable pieces — a nested `FolderTree`, an `ImagePickerPanel` (tree + grid + selection tray), and a 3-step `SessionStepper` — wired into both the sessions page and the library page.

**Tech Stack:** Astro + React (islands), Hono + zod-openapi API, Drizzle ORM on Cloudflare D1, Vitest via `@cloudflare/vitest-pool-workers`, shadcn/ui (lucide icons), reui registry components (`@reui/c-tree-5`, `@reui/c-stepper-7`).

## Global Constraints

- **Session has exactly ONE origin image** — `sessions.origin_library_image_id`. Multi-image = one primary origin + N references. Never write a second origin.
- **No new table, no migration.** Reference persistence uses the existing `session_images` join (roles `base | object | style`, unique per `(session_uuid, library_image_id)`).
- **Session name (title) is required** on every surface — `createSession` throws `"A session name (title) is required."` when blank.
- **Reference caps are validated at edit time**, not creation. Creation only fills the pool.
- Path alias: `@/*` → `src/frontend/*` then `src/backend/*`. Frontend UI components live under `src/frontend/components/`, primitives under `src/frontend/components/ui/`.
- Icon library is **lucide** (`components.json` `iconLibrary: "lucide"`). Prefer lucide over adding hugeicons where a reui snippet used hugeicons.
- Backend tests run in workerd: `import { env } from "cloudflare:test"`, helpers `ctx()` and `seedImage()` from `test/helpers.ts`. Run a file with `npx vitest run test/<file>.test.ts`.
- **No React/DOM test tooling exists** in this repo (the vitest pool is workerd-only). Frontend tasks are verified by `pnpm build` + `pnpm lint` and explicit manual dev-server steps — do NOT introduce jsdom/RTL/a new framework.
- Delivery-URL variants: swap the trailing path segment, never append — `deliveryUrl.replace(/\/[^/]+$/, `/${name}`)`.

---

## Task 1: `createSession` accepts references + modelOverrides (validate-before-batch)

**Files:**
- Modify: `src/backend/core/sessions/create.ts`
- Test: `test/create.test.ts` (create)

**Interfaces:**
- Consumes: `upsertSessionReferences(ctx, sessionUuid, refs)` and `ReferenceInput` (`{ imageId: string; role: "base"|"object"|"style" }`) from `src/backend/core/sessions/references.ts`; `requireImage(ctx, id)` from `src/backend/core/library/images.ts`; `ValidationError`/`NotFoundError` from `../errors`.
- Produces: extended `CreateSessionInput`:
  ```ts
  references?: { imageId: string; role: "object" | "style" }[];
  modelOverrides?: Record<string, string>;
  ```
  Behaviour: primary is never added to the pool; refs equal to the primary are dropped; a missing/soft-deleted primary or ref rejects the whole create with no orphan session row.

- [ ] **Step 1: Write the failing test**

Create `test/create.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { createSession, getSessionView } from "@/backend/core";
import { ctx, seedImage } from "./helpers";

describe("createSession with references + overrides", () => {
  it("persists non-primary selections as the session reference pool", async () => {
    const c = ctx();
    const primary = await seedImage(c);
    const refA = await seedImage(c);
    const refB = await seedImage(c);

    const { session } = await createSession(c, {
      originLibraryImageId: primary.id,
      title: "Multi ref session",
      references: [
        { imageId: refA.id, role: "object" },
        { imageId: refB.id, role: "style" },
      ],
      modelOverrides: { image_edit: "gemini-3-pro-image" },
    });

    expect(session.modelOverrides).toEqual({ image_edit: "gemini-3-pro-image" });

    const view = await getSessionView(c, session.sessionUuid);
    const pool = (view.references ?? []).map((r) => ({ id: r.image.id, role: r.role })).sort((a, b) => a.id.localeCompare(b.id));
    const expected = [
      { id: refA.id, role: "object" },
      { id: refB.id, role: "style" },
    ].sort((a, b) => a.id.localeCompare(b.id));
    expect(pool).toEqual(expected);
    // Primary is the origin, never in the pool.
    expect((view.references ?? []).some((r) => r.image.id === primary.id)).toBe(false);
  });

  it("rejects the whole create when a reference id is bad (no orphan session)", async () => {
    const c = ctx();
    const primary = await seedImage(c);

    await expect(
      createSession(c, {
        originLibraryImageId: primary.id,
        title: "Bad ref",
        references: [{ imageId: "does-not-exist", role: "object" }],
      }),
    ).rejects.toThrow();

    // No session should have been created for this primary.
    const { listSessionsForImage } = await import("@/backend/core");
    const spawned = await listSessionsForImage(c, primary.id);
    expect(spawned.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/create.test.ts`
Expected: FAIL — `view.references` is undefined and `session.modelOverrides` is not set (references not persisted / not returned yet).

- [ ] **Step 3: Implement — extend input, validate up front, persist**

In `src/backend/core/sessions/create.ts`:

Add imports at top (alongside existing):
```ts
import { upsertSessionReferences } from "./references";
import type { ReferenceInput } from "./references";
```

Extend `CreateSessionInput`:
```ts
export interface CreateSessionInput {
  /** The library image this session edits. Must exist and be live. */
  originLibraryImageId: string;
  title?: string | null;
  approvalPolicy?: ApprovalPolicy;
  createdVia?: CreatedVia;
  /** Non-primary selections to seed the session's reference pool. */
  references?: { imageId: string; role: "object" | "style" }[];
  /** Per-session model overrides by task_key, e.g. { image_edit: "gemini-3-pro-image" }. */
  modelOverrides?: Record<string, string>;
}
```

Inside `createSession`, after the existing `await requireImage(ctx, input.originLibraryImageId);` and the title check, and BEFORE building `sessionRow`, normalize + validate refs:
```ts
  // Drop refs that duplicate the primary or each other; validate every id up
  // front so a bad ref rejects the whole create (no orphan session row).
  const seen = new Set<string>([input.originLibraryImageId]);
  const refs: ReferenceInput[] = [];
  for (const r of input.references ?? []) {
    if (seen.has(r.imageId)) continue;
    seen.add(r.imageId);
    await requireImage(ctx, r.imageId); // throws NotFound → whole create fails before any write
    refs.push({ imageId: r.imageId, role: r.role });
  }
```

Add `modelOverrides` to `sessionRow`:
```ts
  const sessionRow = {
    sessionUuid,
    title,
    originLibraryImageId: input.originLibraryImageId,
    status: "active" as const,
    approvalPolicy: input.approvalPolicy ?? "masked_only",
    rootRevisionId: seedRevisionId,
    createdVia,
    ...(input.modelOverrides ? { modelOverrides: input.modelOverrides } : {}),
  };
```

After the `await ctx.db.batch([...])` (session + seed committed) and before the event append, persist the pool:
```ts
  // ponytail: refs already validated above; upsertSessionReferences re-checks
  // existence (one extra read each) — acceptable for the create path.
  if (refs.length) await upsertSessionReferences(ctx, sessionUuid, refs);
```

- [ ] **Step 4: (depends on Task 2 for `view.references`) — run after Task 2 lands**

`getSessionView` returning `references` is Task 2. Run the full file at the end of Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/backend/core/sessions/create.ts test/create.test.ts
git commit -m "feat(sessions): create with reference pool + model overrides"
```

---

## Task 2: `getSessionView` returns the session reference pool

**Files:**
- Modify: `src/backend/core/sessions/query.ts`
- Test: `test/create.test.ts` (reuse — full run now passes)

**Interfaces:**
- Consumes: `listSessionReferences(ctx, sessionUuid)` → `SessionReference[]` (`{ role: "base"|"object"|"style"; image: LibraryImage }`) from `./references`.
- Produces: `SessionView.references?: { role: "base"|"object"|"style"; image: { id: string; deliveryUrl: string; originalFilename: string | null } }[]`.

- [ ] **Step 1: Extend the `SessionView` interface**

In `src/backend/core/sessions/query.ts`, add to `interface SessionView`:
```ts
  references?: {
    role: "base" | "object" | "style";
    image: { id: string; deliveryUrl: string; originalFilename: string | null };
  }[];
```

- [ ] **Step 2: Populate it in `getSessionView`**

Add the import near the top:
```ts
import { listSessionReferences } from "./references";
```
Inside `getSessionView`, after the origin/revision image lookups and before building the return object, fetch the pool and map it:
```ts
  const pool = await listSessionReferences(ctx, sessionUuid);
  const references = pool.map((r) => ({
    role: r.role,
    image: {
      id: r.image.id,
      deliveryUrl: r.image.deliveryUrl,
      originalFilename: r.image.originalFilename,
    },
  }));
```
Add `references,` to the returned `SessionView` object literal.

- [ ] **Step 3: Run the full create test**

Run: `npx vitest run test/create.test.ts`
Expected: PASS (both cases).

- [ ] **Step 4: Regression — run the existing suite**

Run: `npx vitest run`
Expected: PASS (no existing test asserts the exact `SessionView` keys; adding an optional field is additive).

- [ ] **Step 5: Commit**

```bash
git add src/backend/core/sessions/query.ts
git commit -m "feat(sessions): expose session reference pool in getSessionView"
```

---

## Task 3: `POST /api/sessions` accepts references + modelOverrides

**Files:**
- Modify: `src/backend/api/routes/sessions.ts:30-45` (the POST body schema)

**Interfaces:**
- Consumes: extended `CreateSessionInput` from Task 1.
- Produces: HTTP contract — POST body may include `references: {imageId,role}[]` and `modelOverrides: Record<string,string>`.

- [ ] **Step 1: Extend the zod body schema**

In the POST `/api/sessions` `createRoute`, replace the body `schema` object with:
```ts
schema: z.object({
  originLibraryImageId: z.string(),
  title: z.string().nullish(),
  approvalPolicy: z.enum(["auto", "masked_only", "always"]).optional(),
  createdVia: z.enum(["ui", "api", "mcp"]).optional(),
  references: z
    .array(z.object({ imageId: z.string(), role: z.enum(["object", "style"]) }))
    .optional(),
  modelOverrides: z.record(z.string(), z.string()).optional(),
}),
```
The handler body is unchanged — `createSession(createCoreContext(c.env), c.req.valid("json"))` already forwards the new fields.

- [ ] **Step 2: Typecheck via build**

Run: `pnpm build`
Expected: build succeeds (no TS errors in the route).

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend/api/routes/sessions.ts
git commit -m "feat(api): accept references + modelOverrides on POST /api/sessions"
```

---

## Task 4: Install reui Tree + Stepper primitives

**Files:**
- Create (via registry): `src/frontend/components/ui/tree.tsx`, `src/frontend/components/ui/stepper.tsx` (+ any deps the registry adds)
- Modify: `package.json` / lockfile

**Interfaces:**
- Produces: `Tree`, `TreeItem`, `TreeItemLabel` exported from `@/components/ui/tree`; `Stepper`, `StepperNav`, `StepperItem`, `StepperTrigger`, `StepperIndicator`, `StepperSeparator`, `StepperTitle`, `StepperPanel`, `StepperContent` exported from `@/components/ui/stepper`.

- [ ] **Step 1: Run the registry installs the user specified**

```bash
pnpm dlx shadcn@latest add @reui/c-tree-5
pnpm dlx shadcn@latest add @reui/c-stepper-7
```
Accept prompts to write into `src/frontend/components/ui/`.

- [ ] **Step 2: Verify files + runtime deps landed**

Run:
```bash
ls src/frontend/components/ui/tree.tsx src/frontend/components/ui/stepper.tsx
node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies}).filter(k=>k.includes('headless-tree')||k.includes('hugeicons')))"
```
Expected: both files exist. If `@headless-tree/core`/`@headless-tree/react` are NOT listed, install them: `pnpm add @headless-tree/core @headless-tree/react`.

- [ ] **Step 3: Fallback if the registry install fails**

If either `pnpm dlx` command errors (registry unreachable / no `@reui` alias), vendor the primitives from the snippets in the session request instead: create the two files with the reui `Tree`/`Stepper` component code, and run `pnpm add @headless-tree/core @headless-tree/react`. Do NOT add hugeicons — Task 5 uses lucide icons.

- [ ] **Step 4: Build to confirm the primitives compile**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/frontend/components/ui/tree.tsx src/frontend/components/ui/stepper.tsx
git commit -m "chore(ui): add reui tree + stepper primitives"
```

---

## Task 5: `FolderTree` component + nested library sidebar

**Files:**
- Create: `src/frontend/components/library/FolderTree.tsx`
- Modify: `src/frontend/components/library/LibraryGrid.tsx` (replace the flat sidebar block, lines ~416-483)

**Interfaces:**
- Consumes: `Tree`, `TreeItem`, `TreeItemLabel` from `@/components/ui/tree`.
- Produces:
  ```ts
  export interface FolderTreeFolder { id: string; name: string; parentFolderId: string | null }
  export interface FolderTreeProps {
    folders: FolderTreeFolder[];
    counts: Record<string, number>;   // folderId -> image count; "__all__" -> total
    activeFolderId: string | null;     // null === All images
    onSelectFolder: (id: string | null) => void;
  }
  export function FolderTree(props: FolderTreeProps): JSX.Element
  ```

- [ ] **Step 1: Write `FolderTree.tsx`**

```tsx
/**
 * @fileoverview Nested folder tree for the library. Builds a headless-tree data
 * record from the flat folder list via parentFolderId. Selecting a node calls
 * onSelectFolder; the synthetic "__all__" root means "All images".
 */
import { useMemo } from "react";
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { Folder, FolderOpen, Images } from "lucide-react";

import { Tree, TreeItem, TreeItemLabel } from "@/components/ui/tree";

export interface FolderTreeFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
}
export interface FolderTreeProps {
  folders: FolderTreeFolder[];
  counts: Record<string, number>;
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
}

const ROOT = "__all__";
const indent = 20;

interface Node {
  name: string;
  children?: string[];
}

export function FolderTree({ folders, counts, activeFolderId, onSelectFolder }: FolderTreeProps) {
  const items = useMemo<Record<string, Node>>(() => {
    const childrenOf = (parent: string | null) =>
      folders.filter((f) => f.parentFolderId === parent).map((f) => f.id);
    const rec: Record<string, Node> = {
      [ROOT]: { name: "All images", children: childrenOf(null) },
    };
    for (const f of folders) rec[f.id] = { name: f.name, children: childrenOf(f.id) };
    return rec;
  }, [folders]);

  const tree = useTree<Node>({
    rootItemId: ROOT,
    indent,
    initialState: { expandedItems: [ROOT] },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (id) => items[id],
      getChildren: (id) => items[id]?.children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });

  // Rebuild view when the data record identity changes.
  void items;

  return (
    <Tree indent={indent} tree={tree}>
      {tree.getItems().map((item) => {
        const id = item.getId();
        const selectedId = activeFolderId ?? ROOT;
        const isActive = id === selectedId;
        const count = counts[id] ?? 0;
        const isRoot = id === ROOT;
        return (
          <TreeItem key={id} item={item}>
            <TreeItemLabel
              onClick={() => onSelectFolder(isRoot ? null : id)}
              className={`relative flex items-center justify-between ${
                isActive ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                {isRoot ? (
                  <Images className="size-4 text-primary" />
                ) : item.isExpanded() ? (
                  <FolderOpen className="size-4 text-amber-500" />
                ) : (
                  <Folder className="size-4 text-amber-500" />
                )}
                <span className="truncate">{item.getItemName()}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{count}</span>
            </TreeItemLabel>
          </TreeItem>
        );
      })}
    </Tree>
  );
}
```

> Note for implementer: the exact reui `Tree`/`TreeItem`/`TreeItemLabel` prop surface comes from the file installed in Task 4. The snippet mirrors the reui usage the user provided (same `useTree` config); if `TreeItemLabel` forwards `onClick`, the handler above works. If reui exposes folder selection via a `selectionFeature` callback instead, wire `onSelectFolder` there and keep the same visual markup.

- [ ] **Step 2: Swap the flat sidebar in `LibraryGrid.tsx`**

Replace the sidebar `<div className="flex flex-col gap-2 rounded-xl bg-card p-4 ...">` block (the "All images" button + `folders.map(...)` list, ~lines 417-483) with:
```tsx
        <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-border/40">
          <div className="flex items-center justify-between pb-2">
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Folders
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setNewFolderOpen(true)}
              title="Create Folder"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>
          <FolderTree
            folders={folders}
            counts={folderCounts}
            activeFolderId={activeFolderId}
            onSelectFolder={setActiveFolderId}
          />
        </div>
```
Add the import: `import { FolderTree } from "./FolderTree";`
Add a memoized counts map above the return (near `filteredTiles`):
```tsx
  const doneTiles = tiles.filter((t) => t.status === "done");
  const folderCounts: Record<string, number> = { __all__: doneTiles.length };
  for (const f of folders) folderCounts[f.id] = doneTiles.filter((t) => t.folderId === f.id).length;
```

- [ ] **Step 3: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: succeeds, no new lint errors.

- [ ] **Step 4: Manual verify (dev server)**

Run: `pnpm dev` → open `/library`. Create nested folders (a folder, then a subfolder under it via the existing New Folder dialog while that folder is active). Confirm the sidebar renders them **nested**, counts show, clicking a node filters the grid, expand/collapse works.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/components/library/FolderTree.tsx src/frontend/components/library/LibraryGrid.tsx
git commit -m "feat(library): nested folder tree sidebar"
```

---

## Task 6: `ImagePickerPanel` — tree + grid + selection tray

**Files:**
- Create: `src/frontend/components/library/ImagePickerPanel.tsx`

**Interfaces:**
- Consumes: `FolderTree` (Task 5); `apiGet` from `@/lib/api`.
- Produces:
  ```ts
  export interface PickerImage { id: string; deliveryUrl: string; originalFilename: string | null; folderId: string | null; flaggedBadAt?: number | null }
  export interface ImagePickerPanelProps {
    value: string[];                         // selected image ids, order preserved
    onChange: (ids: string[]) => void;
    maxSelectable?: number;                  // optional cap
  }
  export function ImagePickerPanel(props: ImagePickerPanelProps): JSX.Element
  ```
  Loads its own `library/images` + `library/folders`. Selection is by image id and **persists across folder navigation**. Selected tiles show a truncated, click-to-copy library-id badge.

- [ ] **Step 1: Write `ImagePickerPanel.tsx`**

```tsx
/**
 * @fileoverview Library image chooser: nested folder tree + image grid + a
 * selection tray. Selection is a set of image ids that survives folder
 * navigation (the grid filters by active folder; selection does not). Used by
 * the session-creation stepper.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { apiGet } from "@/lib/api";
import { FolderTree } from "./FolderTree";

export interface PickerImage {
  id: string;
  deliveryUrl: string;
  originalFilename: string | null;
  folderId: string | null;
  flaggedBadAt?: number | null;
}
interface Folder {
  id: string;
  name: string;
  parentFolderId: string | null;
}
export interface ImagePickerPanelProps {
  value: string[];
  onChange: (ids: string[]) => void;
  maxSelectable?: number;
}

function variant(url: string, name: string): string {
  return url ? url.replace(/\/[^/]+$/, `/${name}`) : "";
}

export function ImagePickerPanel({ value, onChange, maxSelectable }: ImagePickerPanelProps) {
  const [images, setImages] = useState<PickerImage[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<{ images: PickerImage[] }>("library/images"),
      apiGet<{ folders: Folder[] }>("library/folders"),
    ])
      .then(([i, f]) => {
        setImages(i.images ?? []);
        setFolders(f.folders ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { __all__: images.length };
    for (const f of folders) c[f.id] = images.filter((im) => im.folderId === f.id).length;
    return c;
  }, [images, folders]);

  const shown = useMemo(
    () => (activeFolderId === null ? images : images.filter((im) => im.folderId === activeFolderId)),
    [images, activeFolderId],
  );
  const selectedSet = useMemo(() => new Set(value), [value]);
  const byId = useMemo(() => new Map(images.map((im) => [im.id, im])), [images]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      if (maxSelectable && value.length >= maxSelectable) return;
      onChange([...value, id]);
    }
  };

  const copyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(id).catch(() => {});
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4">
      <div className="rounded-xl bg-card p-3 ring-1 ring-border/40">
        <FolderTree
          folders={folders}
          counts={counts}
          activeFolderId={activeFolderId}
          onSelectFolder={setActiveFolderId}
        />
      </div>

      <div className="flex flex-col gap-3">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-2 rounded-lg bg-primary/10 p-2 ring-1 ring-primary/30">
            {value.map((id) => {
              const im = byId.get(id);
              return (
                <span
                  key={id}
                  className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs ring-1 ring-border/40"
                >
                  {im && (
                    <img src={variant(im.deliveryUrl, "thumb")} alt="" className="h-5 w-5 rounded object-cover" />
                  )}
                  <button
                    onClick={(e) => copyId(id, e)}
                    className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                    title="Click to copy library id"
                  >
                    {id.slice(0, 8)}
                  </button>
                  <button onClick={() => toggle(id)} className="text-muted-foreground hover:text-destructive">
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        <div className="grid max-h-[360px] grid-cols-3 gap-3 overflow-y-auto p-1 sm:grid-cols-4">
          {shown.map((im) => {
            const isSel = selectedSet.has(im.id);
            return (
              <button
                key={im.id}
                onClick={() => toggle(im.id)}
                className={`relative aspect-square overflow-hidden rounded-xl bg-background transition-all ${
                  isSel ? "ring-2 ring-primary" : "ring-1 ring-border/40 hover:ring-primary/40"
                }`}
              >
                <img
                  src={variant(im.deliveryUrl, "thumb")}
                  alt={im.originalFilename ?? ""}
                  className={`h-full w-full object-cover ${im.flaggedBadAt ? "opacity-35 grayscale" : ""}`}
                />
                {isSel && (
                  <span
                    onClick={(e) => copyId(im.id, e)}
                    className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] font-semibold text-primary-foreground"
                    title="Click to copy library id"
                  >
                    {im.id.slice(0, 8)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: succeeds.

- [ ] **Step 3: Commit** (verified interactively as part of Task 7's stepper)

```bash
git add src/frontend/components/library/ImagePickerPanel.tsx
git commit -m "feat(library): cross-folder image picker panel with id badges"
```

---

## Task 7: `SessionStepper` — 3-step create modal

**Files:**
- Create: `src/frontend/components/sessions/SessionStepper.tsx`

**Interfaces:**
- Consumes: `ImagePickerPanel` (Task 6); `Stepper`, `StepperNav`, `StepperItem`, `StepperTrigger`, `StepperIndicator`, `StepperSeparator`, `StepperTitle`, `StepperPanel`, `StepperContent` from `@/components/ui/stepper`; `apiGet`, `apiSend` from `@/lib/api`; `Dialog*`, `Button`, `Input` from ui.
- Produces:
  ```ts
  export interface SessionStepperProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialImageIds?: string[];   // pre-seeded selection; when non-empty, start at step 2
  }
  export function SessionStepper(props: SessionStepperProps): JSX.Element
  ```
  On successful create: `window.location.href = "/sessions/<uuid>"`.

- [ ] **Step 1: Write `SessionStepper.tsx`**

```tsx
/**
 * @fileoverview New-session wizard. Step 1 picks images (skipped when opened
 * from an existing selection), step 2 collects the required name + primary +
 * per-image object/style role, step 3 is optional advanced (approval policy +
 * model override). Primary → session origin; the rest persist as the reference
 * pool.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Images, Loader2, Settings2, Sparkles } from "lucide-react";

import { apiGet, apiSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { ImagePickerPanel } from "@/components/library/ImagePickerPanel";

type Role = "object" | "style";
interface ModelEntry {
  id: string;
  capabilities?: { image_out?: boolean };
}

const STEPS = [
  { title: "Select images", icon: <Images className="size-4" /> },
  { title: "Details", icon: <Sparkles className="size-4" /> },
  { title: "Advanced", icon: <Settings2 className="size-4" /> },
];

export interface SessionStepperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImageIds?: string[];
}

export function SessionStepper({ open, onOpenChange, initialImageIds = [] }: SessionStepperProps) {
  const [step, setStep] = useState(1);
  const [ids, setIds] = useState<string[]>(initialImageIds);
  const [primary, setPrimary] = useState<string | null>(initialImageIds[0] ?? null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [title, setTitle] = useState("");
  const [approvalPolicy, setApprovalPolicy] = useState<"auto" | "masked_only" | "always">("masked_only");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset + choose starting step whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setIds(initialImageIds);
    setPrimary(initialImageIds[0] ?? null);
    setRoles({});
    setTitle("");
    setApprovalPolicy("masked_only");
    setModelOverride("");
    setError(null);
    setStep(initialImageIds.length > 0 ? 2 : 1);
  }, [open, initialImageIds]);

  useEffect(() => {
    if (!open) return;
    apiGet<{ models: ModelEntry[] }>("models")
      .then((r) => setModels((r.models ?? []).filter((m) => m.capabilities?.image_out)))
      .catch(() => setModels([]));
  }, [open]);

  // Keep primary valid as the selection changes.
  useEffect(() => {
    if (primary && !ids.includes(primary)) setPrimary(ids[0] ?? null);
    if (!primary && ids.length) setPrimary(ids[0]);
  }, [ids, primary]);

  const canNextFrom1 = ids.length > 0;
  const canCreate = title.trim().length > 0 && ids.length > 0 && !!primary;

  const references = useMemo(
    () => ids.filter((id) => id !== primary).map((id) => ({ imageId: id, role: roles[id] ?? "object" })),
    [ids, primary, roles],
  );

  const create = async () => {
    if (!canCreate || !primary) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        originLibraryImageId: primary,
        title: title.trim(),
        approvalPolicy,
        createdVia: "ui",
      };
      if (references.length) body.references = references;
      if (modelOverride) body.modelOverrides = { image_edit: modelOverride };
      const res = await apiSend<{ session: { sessionUuid: string } } | { sessionUuid: string }>(
        "POST",
        "sessions",
        body,
      );
      const uuid = "session" in res ? res.session.sessionUuid : res.sessionUuid;
      window.location.href = `/sessions/${uuid}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-card text-foreground ring-1 ring-border/40">
        <DialogHeader>
          <DialogTitle>New editing session</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-destructive/15 p-3 text-xs text-destructive">{error}</div>
        )}

        <Stepper
          value={step}
          onValueChange={setStep}
          indicators={{ completed: <Check className="size-3.5" />, loading: <Loader2 className="size-3.5 animate-spin" /> }}
          className="w-full space-y-6"
        >
          <StepperNav className="gap-3">
            {STEPS.map((s, i) => (
              <StepperItem key={s.title} step={i + 1} className="relative flex-1 items-start">
                <StepperTrigger className="flex grow flex-col items-start gap-2">
                  <StepperIndicator className="size-8 border-2">{s.icon}</StepperIndicator>
                  <StepperTitle className="text-sm font-semibold">{s.title}</StepperTitle>
                </StepperTrigger>
                {i < STEPS.length - 1 && (
                  <StepperSeparator className="absolute inset-x-0 start-9 top-4 m-0" />
                )}
              </StepperItem>
            ))}
          </StepperNav>

          <StepperPanel>
            <StepperContent value={1}>
              <ImagePickerPanel value={ids} onChange={setIds} />
            </StepperContent>

            <StepperContent value={2} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">
                  Session name <span className="text-destructive">*</span>
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Primary bath — spa remodel"
                  className="bg-background ring-1 ring-border/40"
                />
              </div>
              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Primary image (session origin) &amp; reference roles
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {ids.map((id) => {
                    const isPrimary = id === primary;
                    return (
                      <div
                        key={id}
                        className={`flex flex-col gap-1 rounded-lg p-1.5 ring-1 ${
                          isPrimary ? "ring-primary" : "ring-border/40"
                        }`}
                      >
                        <button
                          onClick={() => setPrimary(id)}
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          title="Set as primary"
                        >
                          {isPrimary ? "★ primary" : `${id.slice(0, 8)}`}
                        </button>
                        {!isPrimary && (
                          <select
                            value={roles[id] ?? "object"}
                            onChange={(e) => setRoles((r) => ({ ...r, [id]: e.target.value as Role }))}
                            className="rounded bg-background px-1 py-0.5 text-[10px] ring-1 ring-border/40"
                          >
                            <option value="object">object</option>
                            <option value="style">style</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </StepperContent>

            <StepperContent value={3} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">Approval policy</label>
                <select
                  value={approvalPolicy}
                  onChange={(e) => setApprovalPolicy(e.target.value as typeof approvalPolicy)}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border/40"
                >
                  <option value="masked_only">masked_only (default)</option>
                  <option value="auto">auto</option>
                  <option value="always">always</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">
                  Image-edit model override (optional)
                </label>
                <select
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border/40"
                >
                  <option value="">Inherit defaults</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>
            </StepperContent>
          </StepperPanel>
        </Stepper>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step === 1 && (
              <Button disabled={!canNextFrom1} onClick={() => setStep(2)}>
                Next
              </Button>
            )}
            {step === 2 && (
              <>
                <Button variant="outline" onClick={() => setStep(3)}>
                  Advanced
                </Button>
                <Button disabled={!canCreate || creating} onClick={create} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Create session
                </Button>
              </>
            )}
            {step === 3 && (
              <Button disabled={!canCreate || creating} onClick={create} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Create session
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Note for implementer: the `models` filter uses `capabilities.image_out`. Confirm the shape from `GET /api/models` (`listModels()` entries) once running; if the flag differs (e.g. `image_edit`/`multi_reference_image`), adjust the filter predicate. Falling back to showing all models is acceptable.

- [ ] **Step 2: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/sessions/SessionStepper.tsx
git commit -m "feat(sessions): 3-step new-session wizard"
```

---

## Task 8: Wire the stepper into Sessions + Library pages

**Files:**
- Modify: `src/frontend/components/sessions/SessionsList.tsx` (replace the New Session modal + `handleCreateSession`)
- Modify: `src/frontend/components/library/LibraryGrid.tsx` (multi-select "Create session" + route single Start Session through the stepper + id badge on selected grid tiles)

**Interfaces:**
- Consumes: `SessionStepper` (Task 7).

- [ ] **Step 1: SessionsList — swap in the stepper**

In `SessionsList.tsx`: remove the `libraryImages`/`selectedImageId`/`creating`/`createError` state, the `useEffect` that loads library images, `handleCreateSession`, and the entire `<Dialog open={newModalOpen}>...</Dialog>` block. Add:
```tsx
import { SessionStepper } from "./SessionStepper";
```
Keep `newModalOpen` state. Render at the end of the component (before the closing `</div>`):
```tsx
      <SessionStepper open={newModalOpen} onOpenChange={setNewModalOpen} />
```
The two existing `onClick={() => setNewModalOpen(true)}` buttons ("New session" header + empty-state "Start a session") now open the stepper at step 1.

- [ ] **Step 2: LibraryGrid — multi-select "Create session"**

In `LibraryGrid.tsx` add:
```tsx
import { SessionStepper } from "@/components/sessions/SessionStepper";
```
Add state near the other modal state:
```tsx
  const [stepperOpen, setStepperOpen] = useState(false);
  const [stepperSeed, setStepperSeed] = useState<string[]>([]);
  const openStepper = (imageIds: string[]) => {
    setStepperSeed(imageIds);
    setStepperOpen(true);
  };
```
In the multi-select toolbar (the `selected.length > 0` bar), replace the single-only `{selected.length === 1 && (...Start Session...)}` button with an always-shown:
```tsx
                <Button
                  size="sm"
                  onClick={() => openStepper(selected)}
                  className="h-8 gap-1.5 bg-primary text-primary-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Create session
                </Button>
```
Render the stepper once, near the other dialogs at the end of the component:
```tsx
      <SessionStepper open={stepperOpen} onOpenChange={setStepperOpen} initialImageIds={stepperSeed} />
```

- [ ] **Step 3: LibraryGrid — route the drawer's single Start Session through the stepper**

Replace the detail-drawer "Start New Session From Photo" block (the `sessionName` input + `handleStartSession` button, ~lines 701-725) with a single button:
```tsx
              {detailTile.id && (
                <Button
                  onClick={() => openStepper([detailTile.id!])}
                  className="w-full gap-2 bg-primary text-primary-foreground font-medium py-5"
                >
                  <Sparkles className="h-4 w-4" /> Start new session from photo
                </Button>
              )}
```
Delete the now-unused `handleStartSession`, `sessionName`/`setSessionName`, `starting`/`setStarting`, `startError`/`setStartError` state and the `startError` banner near the top (the stepper owns creation + errors now).

- [ ] **Step 4: LibraryGrid — id badge on selected grid tiles**

In the grid tile render, inside the `tile.status === "done"` branch where `isSel` is known, add after the selection checkbox button:
```tsx
                          {isSel && tile.id && (
                            <span
                              onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(tile.id!).catch(() => {}); }}
                              className="absolute right-2.5 top-2.5 rounded bg-primary px-1.5 py-0.5 font-mono text-[9px] font-semibold text-primary-foreground"
                              title="Click to copy library id"
                            >
                              {tile.id.slice(0, 8)}
                            </span>
                          )}
```
(If a "Bad" badge already occupies top-right for this tile, place the id badge at `right-2.5 top-8` so they don't overlap.)

- [ ] **Step 5: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: succeeds; no unused-var lint errors from the deletions.

- [ ] **Step 6: Manual verify (dev server)**

Run: `pnpm dev`.
- `/sessions` → "New session" → step through: pick 2+ images across two folders, Next, set name + pick primary + set one ref to "style", Create → lands on the new session.
- `/library` → select 3 images across folders → "Create session" → opens at step 2 with all 3 seeded, id badges visible → Create.
- `/library` → open a photo drawer → "Start new session from photo" → opens at step 2 seeded with that one image.
- Confirm creating with a blank name keeps Create disabled.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/components/sessions/SessionsList.tsx src/frontend/components/library/LibraryGrid.tsx
git commit -m "feat(sessions): wire stepper into sessions + library pages"
```

---

## Task 9: ComposePane hydrates the session reference pool

**Files:**
- Modify: `src/frontend/components/sessions/ComposePane.tsx`

**Interfaces:**
- Consumes: `SessionView.references` (Task 2) delivered through whatever the session page already fetches (`getSessionView` via `/api/sessions/{uuid}` → `SessionDetail`).

- [ ] **Step 1: Find how ComposePane receives session data**

Run: `grep -n "references\|props\|SessionView\|origin" src/frontend/components/sessions/ComposePane.tsx | head -40` and inspect how `SessionDetail` passes data to `ComposePane`. Identify the prop carrying the session view (it already knows the model list + base image).

- [ ] **Step 2: Seed initial references from the pool**

Where `const [references, setReferences] = useState<ReferenceItem[]>([]);` is declared, seed it from the session view's `references` (excluding role `base`), mapping to the `ReferenceItem` shape the picker uses (`{ imageId, role, thumbUrl, label? }`, `thumbUrl` = `variant(image.deliveryUrl, "thumb")`, role narrowed to `object|style`). If the view isn't available at first render, hydrate in a `useEffect` keyed on the session id — guard so it only seeds once (don't clobber user edits):
```tsx
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const pool = (sessionView?.references ?? []).filter((r) => r.role !== "base");
    if (pool.length) {
      setReferences(
        pool.map((r) => ({
          imageId: r.image.id,
          role: r.role as "object" | "style",
          thumbUrl: r.image.deliveryUrl.replace(/\/[^/]+$/, "/thumb"),
          label: r.image.originalFilename,
        })),
      );
      seededRef.current = true;
    }
  }, [sessionView]);
```
Adjust `sessionView` to the actual prop/state name found in Step 1. Add `useRef` to the React import if missing.

- [ ] **Step 3: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: succeeds.

- [ ] **Step 4: Manual verify**

Run: `pnpm dev`. Create a session from the library with 1 primary + 2 extra images (Task 8 flow), land on the session. Confirm the compose pane's reference picker is **pre-filled** with the 2 extras (respecting object/style) for a multi-reference-capable model.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/components/sessions/ComposePane.tsx
git commit -m "feat(sessions): pre-fill compose references from the session pool"
```

---

## Self-Review

**Spec coverage:**
- Nested folder tree in picker + library sidebar → Tasks 5, 6. ✓
- Cross-folder held multi-select → Task 6 (selection by id, independent of active folder). ✓
- Library multi-select → create session → Task 8 Step 2. ✓
- Stepper: skip to step 2 from library, step 1 from sessions page → Task 7 (`initialImageIds` gate). ✓
- Required session name (was blocking creation) → Task 7 (`canCreate`) + Global Constraint. ✓
- Primary pick when multiple → Task 7 Step 1 (step-2 UI). ✓
- Extra inputs: approval policy + model override (advanced) → Task 7 step 3. ✓
- Persist non-primary as references → Tasks 1, 2, 3; visible in compose → Task 9. ✓
- Show library ids across instances → picker tray + selected tiles (Task 6), library grid selected tiles (Task 8 Step 4). ✓

**Placeholder scan:** No TBD/TODO. reui-API and models-flag uncertainties are called out with explicit fallback instructions, not left blank.

**Type consistency:** `references: {imageId, role}[]` (role `object|style`) consistent across Tasks 1/3/7; `SessionView.references` role includes `base` (Tasks 2/9 filter it out); `FolderTreeProps`/`ImagePickerPanelProps`/`SessionStepperProps` signatures match their call sites in Tasks 5/7/8.
