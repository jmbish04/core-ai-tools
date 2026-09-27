import { type ReactNode } from "react"
import { FolderIcon, FileTextIcon, ImageIcon, VideoIcon, ArchiveIcon, CodeIcon, FileIcon } from "lucide-react"

// ── Types ──

/**
 * Glyph family, not file format. The icon catalog has no zip/pdf/audio glyph,
 * so the exact format travels separately in `typeLabel`.
 */
export type FileKind =
  | "folder"
  | "document"
  | "image"
  | "video"
  | "archive"
  | "code"
  | "file"

export interface DriveOwner {
  name: string
  avatar?: string
}

export interface DriveNode {
  id: string
  name: string
  kind: FileKind
  /** Exact format shown in the Type column: PDF, PNG, ProRes, ZIP. */
  typeLabel: string
  /** Bytes on disk. Always 0 on a folder: folder size derives from children. */
  sizeBytes: number
  owner: DriveOwner
  /** Real timestamp, the sortable field. */
  modifiedAt: string
  /** Pre-baked relative label, read against DRIVE_SNAPSHOT. */
  modifiedLabel: string
  starred: boolean
  /** Set when the item reached this workspace through a share. */
  sharedBy?: string
  children?: DriveNode[]
}

/** One node with every tree-derived measure resolved. */
export interface DriveRow {
  id: string
  node: DriveNode
  /** Own size on a file, summed descendant size on a folder. */
  sizeBytes: number
  /** Nodes anywhere below this one. Zero on a file. */
  itemCount: number
  children?: DriveRow[]
}

// ── Constants ──

/** Demo time is fixed so every relative label stays stable. */
export const DRIVE_SNAPSHOT = "2026-08-04T09:00:00Z"
export const DRIVE_NAME = "Rivermark Drive"
export const DRIVE_ROOT_ID = "my-drive"

/** Workspace plan ceiling. Used bytes always derive from the tree. */
export const STORAGE_PLAN_BYTES = 2 * 1024 ** 4

const KB = 1024
const MB = 1024 ** 2
const GB = 1024 ** 3

// Static icon nodes per glyph family. Icon names must stay literal, so the
// whole element lives in data; prettier-ignore keeps the table one row deep.
// prettier-ignore
export const FILE_KIND_ICONS: Record<FileKind, ReactNode> = {
  folder: <FolderIcon aria-hidden="true" />,
  document: <FileTextIcon aria-hidden="true" />,
  image: <ImageIcon aria-hidden="true" />,
  video: <VideoIcon aria-hidden="true" />,
  archive: <ArchiveIcon aria-hidden="true" />,
  code: <CodeIcon aria-hidden="true" />,
  file: <FileIcon aria-hidden="true" />,
}

/** Filterable glyph families, in the order the Type filter lists them. */
export const FILE_KIND_OPTIONS: { value: FileKind; label: string }[] = [
  { value: "folder", label: "Folders" },
  { value: "document", label: "Documents" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "archive", label: "Archives" },
  { value: "code", label: "Code" },
  { value: "file", label: "Other" },
]

// ── Cast ──

// Roster is pinned to the solutions/files world pack. Mira Stone carries no
// portrait on purpose, so the AvatarFallback state is visible in the demo.
const OWNERS = {
  nora: {
    name: "Nora Vale",
    avatar:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=96&h=96&dpr=2&q=80",
  },
  theo: {
    name: "Theo Park",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&dpr=2&q=80",
  },
  sana: {
    name: "Sana Qureshi",
    avatar:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=96&h=96&dpr=2&q=80",
  },
  leo: {
    name: "Leo Grant",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80",
  },
  priya: {
    name: "Priya Patel",
    avatar:
      "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=96&h=96&dpr=2&q=80",
  },
  kenji: {
    name: "Kenji Tan",
    avatar:
      "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=96&h=96&dpr=2&q=80",
  },
  elijah: {
    name: "Elijah Morgan",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=96&h=96&dpr=2&q=80",
  },
  mira: { name: "Mira Stone" },
} satisfies Record<string, DriveOwner>

// ── Tree ──

function folder(
  id: string,
  name: string,
  owner: DriveOwner,
  modifiedAt: string,
  modifiedLabel: string,
  children: DriveNode[],
  starred = false
): DriveNode {
  return {
    id,
    name,
    kind: "folder",
    typeLabel: "Folder",
    sizeBytes: 0,
    owner,
    modifiedAt,
    modifiedLabel,
    starred,
    children,
  }
}

// Demo tree. `// prettier-ignore` keeps each file on one line so the data reads
// as a table instead of 11 lines per entry; the shape is checked by the types.
// prettier-ignore
const f = (id: string, name: string, kind: FileKind, typeLabel: string, sizeBytes: number, owner: DriveOwner, modifiedAt: string, modifiedLabel: string, starred = false, sharedBy?: string): DriveNode =>
  ({ id, name, kind, typeLabel, sizeBytes, owner, modifiedAt, modifiedLabel, starred, sharedBy })

const O = OWNERS

// prettier-ignore
export const DRIVE_TREE: DriveNode[] = [
  folder("fld-client", "Client Deliverables", O.priya, "2026-08-03T16:20:00Z", "Yesterday", [
    folder("fld-northwind", "Northwind Rebrand", O.theo, "2026-08-03T16:20:00Z", "Yesterday", [
      f("fil-northwind-deck", "Northwind Rebrand Deck.key", "document", "Keynote", 486 * MB, O.theo, "2026-08-03T16:20:00Z", "Yesterday", true),
      f("fil-northwind-guidelines", "Brand Guidelines v4.pdf", "document", "PDF", 74 * MB, O.sana, "2026-08-01T11:05:00Z", "3 days ago"),
      f("fil-northwind-mark", "Primary Mark Lockup.svg", "image", "SVG", 318 * KB, O.theo, "2026-07-29T09:40:00Z", "Last week"),
      f("fil-northwind-film", "Launch Film Master.mov", "video", "ProRes", 468 * GB, O.leo, "2026-07-28T18:15:00Z", "Last week", true),
      f("fil-northwind-handoff", "Client Handoff.zip", "archive", "ZIP", 12 * GB, O.priya, "2026-07-24T14:00:00Z", "2 weeks ago"),
    ], true),
    folder("fld-harbor", "Harbor Coffee", O.sana, "2026-07-30T10:10:00Z", "Last week", [
      f("fil-harbor-packaging", "Packaging Explorations.psd", "image", "PSD", 1420 * MB, O.sana, "2026-07-30T10:10:00Z", "Last week"),
      f("fil-harbor-menu", "Seasonal Menu Board.ai", "image", "AI", 226 * MB, O.mira, "2026-07-22T13:30:00Z", "2 weeks ago"),
      f("fil-harbor-scope", "Statement Of Work.pdf", "document", "PDF", 2 * MB, O.priya, "2026-07-18T08:45:00Z", "3 weeks ago"),
    ]),
    f("fil-client-tracker", "Deliverable Tracker.xlsx", "document", "Sheet", 4 * MB, O.priya, "2026-08-02T09:15:00Z", "2 days ago"),
  ], true),
  folder("fld-brand", "Brand Library", O.theo, "2026-07-31T15:00:00Z", "Last week", [
    folder("fld-logos", "Logos", O.theo, "2026-07-31T15:00:00Z", "Last week", [
      f("fil-logo-master", "Rivermark Master Logo.svg", "image", "SVG", 142 * KB, O.theo, "2026-07-31T15:00:00Z", "Last week", true),
      f("fil-logo-mono", "Monochrome Set.zip", "archive", "ZIP", 38 * MB, O.mira, "2026-07-16T12:00:00Z", "3 weeks ago"),
      f("fil-logo-usage", "Logo Usage Rules.pdf", "document", "PDF", 18 * MB, O.sana, "2026-07-10T09:00:00Z", "Last month"),
    ]),
    folder("fld-typography", "Typography", O.sana, "2026-07-14T11:20:00Z", "3 weeks ago", [
      f("fil-type-specimen", "Typeface Specimen.pdf", "document", "PDF", 46 * MB, O.sana, "2026-07-14T11:20:00Z", "3 weeks ago"),
      f("fil-type-tokens", "type-tokens.json", "code", "JSON", 86 * KB, O.kenji, "2026-07-12T16:40:00Z", "Last month"),
    ]),
    folder("fld-archive-2025", "Archive 2025", O.elijah, "2026-01-08T10:00:00Z", "Last year", []),
  ]),
  folder("fld-spring", "Spring Campaign", O.leo, "2026-08-04T07:30:00Z", "Today", [
    folder("fld-footage", "Raw Footage", O.leo, "2026-08-04T07:30:00Z", "Today", [
      f("fil-footage-a", "Coastline A Cam.mov", "video", "ProRes", 402 * GB, O.leo, "2026-08-04T07:30:00Z", "Today"),
      f("fil-footage-b", "Coastline B Cam.mov", "video", "ProRes", 362 * GB, O.leo, "2026-08-04T07:30:00Z", "Today"),
      f("fil-footage-drone", "Drone Pickups.mp4", "video", "MP4", 84 * GB, O.kenji, "2026-08-02T19:05:00Z", "2 days ago"),
    ]),
    folder("fld-stills", "Stills", O.kenji, "2026-08-01T14:25:00Z", "3 days ago", [
      f("fil-stills-hero", "Spring Campaign Hero.psd", "image", "PSD", 2140 * MB, O.kenji, "2026-08-01T14:25:00Z", "3 days ago", true),
      f("fil-stills-press", "Press Kit Photos.zip", "archive", "ZIP", 46 * GB, O.mira, "2026-07-27T10:50:00Z", "Last week"),
      f("fil-stills-contact", "Contact Sheet.pdf", "document", "PDF", 128 * MB, O.kenji, "2026-07-26T09:10:00Z", "Last week"),
    ]),
    f("fil-spring-edit", "Hero Cut v12.mp4", "video", "MP4", 92 * GB, O.leo, "2026-08-03T21:40:00Z", "Yesterday", true),
    f("fil-spring-brief", "Campaign Brief.docx", "document", "Doc", 6 * MB, O.priya, "2026-07-20T08:00:00Z", "2 weeks ago"),
  ], true),
  folder("fld-ops", "Studio Operations", O.nora, "2026-08-02T11:45:00Z", "2 days ago", [
    f("fil-ops-roster", "Crew Roster.xlsx", "document", "Sheet", 3 * MB, O.nora, "2026-08-02T11:45:00Z", "2 days ago"),
    f("fil-ops-retainer", "Retainer Agreement.pdf", "document", "PDF", 9 * MB, O.priya, "2026-07-25T15:20:00Z", "Last week"),
    f("fil-ops-backup", "Studio Backup 07.zip", "archive", "ZIP", 246 * GB, O.elijah, "2026-07-31T23:00:00Z", "Last week"),
    f("fil-ops-pipeline", "render-pipeline.py", "code", "Python", 42 * KB, O.kenji, "2026-07-19T13:15:00Z", "2 weeks ago"),
  ]),
  f("fil-root-plan", "Q3 Studio Plan.pdf", "document", "PDF", 11 * MB, O.nora, "2026-08-04T08:05:00Z", "Today", true),
  f("fil-root-reel", "Studio Reel 2026.mp4", "video", "MP4", 64 * GB, O.leo, "2026-08-04T06:10:00Z", "Today"),
  f("fil-root-tokens", "brand-tokens.json", "code", "JSON", 64 * KB, O.kenji, "2026-07-30T09:20:00Z", "Last week"),
  f("fil-root-onboarding", "New Hire Onboarding.pdf", "document", "PDF", 16 * MB, O.mira, "2026-07-15T10:30:00Z", "3 weeks ago", false, "Elijah Morgan"),
  f("fil-root-partner", "Partner Media Kit.zip", "archive", "ZIP", 28 * GB, O.elijah, "2026-07-23T17:00:00Z", "2 weeks ago", false, "Harbor Coffee"),
]

// ── Derivation ──

/**
 * Resolves size and item count for every node in one pass. A file reports its
 * own bytes and no children; a folder sums whatever is under it, so a folder
 * total is never hand-typed and can never disagree with its rows.
 */
export function buildDriveRows(nodes: DriveNode[]): DriveRow[] {
  return nodes.map((node) => {
    if (!node.children) {
      return { id: node.id, node, sizeBytes: node.sizeBytes, itemCount: 0 }
    }

    const children = buildDriveRows(node.children)

    return {
      id: node.id,
      node,
      sizeBytes: children.reduce((sum, child) => sum + child.sizeBytes, 0),
      itemCount: children.reduce(
        (count, child) => count + 1 + child.itemCount,
        0
      ),
      children,
    }
  })
}

export const DRIVE_ROWS = buildDriveRows(DRIVE_TREE)

/** Every node under these rows, folders included. */
export function totalItems(rows: DriveRow[]) {
  return rows.reduce((count, row) => count + 1 + row.itemCount, 0)
}

export function totalSize(rows: DriveRow[]) {
  return rows.reduce((sum, row) => sum + row.sizeBytes, 0)
}

/** Immediate children of a folder id, or the drive root when it is the root. */
export function listFolder(rows: DriveRow[], folderId: string): DriveRow[] {
  if (folderId === DRIVE_ROOT_ID) return rows

  const match = findRow(rows, folderId)
  return match?.children ?? []
}

export function findRow(rows: DriveRow[], id: string): DriveRow | undefined {
  for (const row of rows) {
    if (row.id === id) return row
    const nested = row.children ? findRow(row.children, id) : undefined
    if (nested) return nested
  }
  return undefined
}

/** Folder ids from the drive root down to `folderId`, inclusive. */
export function getFolderPath(rows: DriveRow[], folderId: string): string[] {
  if (folderId === DRIVE_ROOT_ID) return [DRIVE_ROOT_ID]

  function walk(current: DriveRow[], trail: string[]): string[] | undefined {
    for (const row of current) {
      const next = [...trail, row.id]
      if (row.id === folderId) return next
      if (row.children) {
        const found = walk(row.children, next)
        if (found) return found
      }
    }
    return undefined
  }

  return walk(rows, [DRIVE_ROOT_ID]) ?? [DRIVE_ROOT_ID]
}

/** Flattens every file below `rows`, skipping folders. */
export function collectFiles(rows: DriveRow[]): DriveRow[] {
  return rows.flatMap((row) =>
    row.children ? collectFiles(row.children) : [row]
  )
}

/** Flattens every row below `rows`, folders included. */
export function collectAllRows(rows: DriveRow[]): DriveRow[] {
  return rows.flatMap((row) =>
    row.children ? [row, ...collectAllRows(row.children)] : [row]
  )
}

// ── Formatting ──

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"]

/**
 * Local on purpose: the shared upload hook's formatter would drag a hook into
 * this block's registry dependencies. Presentation only, sorting reads the raw
 * `sizeBytes` field.
 */
export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B"

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1
  )
  const value = bytes / 1024 ** exponent
  const fractionDigits = exponent === 0 ? 0 : value >= 10 ? 1 : 2

  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[exponent]}`
}

export function formatCount(value: number) {
  return value.toLocaleString("en-US")
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
}

// ── Mutations ──

// Ids only need to be unique within the session; a counter avoids Math.random,
// which is banned in this corpus because it breaks render determinism.
let nextId = 0

export function makeFolder(name: string, owner: DriveOwner): DriveNode {
  nextId += 1

  return {
    id: `fld-new-${nextId}`,
    name,
    kind: "folder",
    typeLabel: "Folder",
    sizeBytes: 0,
    owner,
    modifiedAt: DRIVE_SNAPSHOT,
    modifiedLabel: "Just now",
    starred: false,
    children: [],
  }
}

export function makeFile(name: string, owner: DriveOwner): DriveNode {
  nextId += 1
  const extension = name.split(".").pop()?.toUpperCase() ?? "FILE"

  return {
    id: `fil-new-${nextId}`,
    name,
    kind: "document",
    typeLabel: extension,
    sizeBytes: 12 * MB,
    owner,
    modifiedAt: DRIVE_SNAPSHOT,
    modifiedLabel: "Just now",
    starred: false,
  }
}

/** MIME type to the drive's own file kind, which drives the row icon. */
function kindFromMimeType(mimeType: string): FileKind {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "file"
  if (/zip|compressed|tar|rar|7z/.test(mimeType)) return "archive"
  if (/json|javascript|typescript|xml|x-sh|x-python/.test(mimeType))
    return "code"
  if (/pdf|word|document|spreadsheet|presentation|text\//.test(mimeType))
    return "document"
  return "file"
}

/**
 * Builds a drive node from a real dropped or picked `File`, so an upload keeps
 * the browser's own name, byte size and type rather than the placeholder
 * `makeFile` uses for the demo action.
 */
export function makeUploadedFile(file: File, owner: DriveOwner): DriveNode {
  nextId += 1
  const extension = file.name.split(".").pop()?.toUpperCase() ?? "FILE"

  return {
    id: `fil-upl-${nextId}`,
    name: file.name,
    kind: kindFromMimeType(file.type),
    typeLabel: extension,
    sizeBytes: file.size,
    owner,
    modifiedAt: DRIVE_SNAPSHOT,
    modifiedLabel: "Just now",
    starred: false,
  }
}

/** Immutably adds `child` under `parentId`, or at the drive root. */
export function insertChild(
  nodes: DriveNode[],
  parentId: string,
  child: DriveNode
): DriveNode[] {
  if (parentId === DRIVE_ROOT_ID) return [child, ...nodes]

  return nodes.map((node) => {
    if (node.id === parentId) {
      return { ...node, children: [child, ...(node.children ?? [])] }
    }
    if (!node.children) return node
    return { ...node, children: insertChild(node.children, parentId, child) }
  })
}

export function toggleStarred(nodes: DriveNode[], id: string): DriveNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, starred: !node.starred }
    if (!node.children) return node
    return { ...node, children: toggleStarred(node.children, id) }
  })
}

export function renameNode(
  nodes: DriveNode[],
  id: string,
  name: string
): DriveNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, name }
    if (!node.children) return node
    return { ...node, children: renameNode(node.children, id, name) }
  })
}

/** Drops every named node and everything beneath it. */
export function removeNodes(
  nodes: DriveNode[],
  ids: ReadonlySet<string>
): DriveNode[] {
  return nodes
    .filter((node) => !ids.has(node.id))
    .map((node) =>
      node.children
        ? { ...node, children: removeNodes(node.children, ids) }
        : node
    )
}

/** The owner every locally created node is attributed to. */
export const CURRENT_USER: DriveOwner = OWNERS.nora

// ── Move ──

export function findNode(
  nodes: DriveNode[],
  id: string
): DriveNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = node.children ? findNode(node.children, id) : undefined
    if (nested) return nested
  }
  return undefined
}

/** True when `id` sits anywhere beneath `ancestorId`. */
export function isDescendant(
  nodes: DriveNode[],
  ancestorId: string,
  id: string
): boolean {
  const ancestor = findNode(nodes, ancestorId)
  return ancestor?.children ? Boolean(findNode(ancestor.children, id)) : false
}

/** Detach then re-insert, so a move can never duplicate a subtree. */
export function moveNode(
  nodes: DriveNode[],
  id: string,
  parentId: string
): DriveNode[] {
  const node = findNode(nodes, id)
  if (!node) return nodes
  return insertChild(removeNodes(nodes, new Set([id])), parentId, node)
}

// ── Sharing ──

export type ShareRole = "viewer" | "commenter" | "editor"
export type LinkAccess = "restricted" | "anyone"

/** Every option list in the sheet: a label plus one muted line under it. */
export interface ShareOption<T extends string> {
  value: T
  label: string
  description: string
}

export interface SharePrincipal {
  id: string
  name: string
  email: string
  avatar?: string
  role: ShareRole
  /** The owner row is never editable or removable. */
  owner?: boolean
}

/** Labels read as the grant itself ("Can view"), so a role reads the same in a
 *  row, in the menu, and in the footer sentence without a second wording. */
export const SHARE_ROLES: ShareOption<ShareRole>[] = [
  { value: "viewer", label: "Can view", description: "Cannot edit or share" },
  {
    value: "commenter",
    label: "Can comment",
    description: "Can comment, not edit",
  },
  { value: "editor", label: "Can edit", description: "Can edit and share" },
]

export const LINK_ACCESS: ShareOption<LinkAccess>[] = [
  {
    value: "restricted",
    label: "Restricted",
    description: "Only invited people",
  },
  {
    value: "anyone",
    label: "Anyone with the link",
    description: "No sign-in needed",
  },
]

// ── Team access ──

export interface ShareTeam {
  id: string
  name: string
  /** Reach of the grant, read under the name. */
  memberLabel: string
  role: ShareRole
  /** The faces shown in the row's stack; memberLabel carries the real size. */
  members: DriveOwner[]
}

export const SHARE_TEAMS: ShareTeam[] = [
  {
    id: "team-design",
    name: "Design",
    memberLabel: "12 members",
    role: "editor",
    members: [OWNERS.theo, OWNERS.kenji, OWNERS.nora],
  },
  {
    id: "team-post",
    name: "Post Production",
    memberLabel: "8 members",
    role: "commenter",
    members: [OWNERS.leo, OWNERS.sana, OWNERS.kenji],
  },
  {
    id: "team-client",
    name: "Client Services",
    memberLabel: "6 members",
    role: "viewer",
    members: [OWNERS.priya, OWNERS.elijah, OWNERS.mira],
  },
]

const handle = (name: string) =>
  `${(name ?? "guest").toLowerCase().replace(/\s+/g, ".")}@rivermark.studio`

const principal = (o: DriveOwner, role: ShareRole, owner = false) => ({
  id: o.name,
  name: o.name,
  email: handle(o.name),
  avatar: o.avatar,
  role,
  owner,
})

/** Seeds an access list: the node owner plus two standing collaborators. */
export function defaultPrincipals(nodeOwner: DriveOwner): SharePrincipal[] {
  const rest = [OWNERS.nora, OWNERS.theo, OWNERS.priya].filter(
    (o) => o.name !== nodeOwner.name
  )
  return [
    principal(nodeOwner, "editor", true),
    principal(rest[0], "editor"),
    principal(rest[1], "viewer"),
  ]
}

// ── Version history ──

export type VersionKind = "created" | "edited" | "restored" | "shared"

export interface FileVersion {
  id: string
  label: string
  kind: VersionKind
  actor: DriveOwner
  summary: string
  timeLabel: string
  sizeBytes: number
  current: boolean
}

// Deterministic per node id: the demo needs a stable history, and Math.random
// is banned in this corpus because it breaks render determinism.
const VERSION_STEPS: {
  kind: VersionKind
  summary: string
  timeLabel: string
  ratio: number
}[] = [
  {
    kind: "edited",
    summary: "Replaced the cover art",
    timeLabel: "Today",
    ratio: 1,
  },
  {
    kind: "shared",
    summary: "Shared with the studio",
    timeLabel: "Yesterday",
    ratio: 0.94,
  },
  {
    kind: "restored",
    summary: "Restored an earlier revision",
    timeLabel: "3 days ago",
    ratio: 0.9,
  },
  {
    kind: "edited",
    summary: "Reworked the layout",
    timeLabel: "Last week",
    ratio: 0.72,
  },
  {
    kind: "edited",
    summary: "Applied the new type scale",
    timeLabel: "2 weeks ago",
    ratio: 0.62,
  },
  {
    kind: "shared",
    summary: "Sent to the client for review",
    timeLabel: "2 weeks ago",
    ratio: 0.55,
  },
  {
    kind: "edited",
    summary: "Swapped the placeholder assets",
    timeLabel: "3 weeks ago",
    ratio: 0.48,
  },
  {
    kind: "created",
    summary: "Uploaded the first revision",
    timeLabel: "3 weeks ago",
    ratio: 0.4,
  },
]

/** Newest first; the head revision is the row's current size. */
export function versionsFor(row: DriveRow, cast: DriveOwner[]): FileVersion[] {
  const seed = row.id.length
  const depth = row.node.kind === "folder" ? 5 : VERSION_STEPS.length

  return VERSION_STEPS.slice(0, depth).map((step, index) => ({
    id: `${row.id}-v${depth - index}`,
    label: `v${depth - index}`,
    kind: step.kind,
    actor: index === 0 ? row.node.owner : cast[(seed + index) % cast.length],
    summary:
      row.node.kind === "folder"
        ? step.summary.replace("cover art", "folder contents")
        : step.summary,
    timeLabel: index === 0 ? row.node.modifiedLabel : step.timeLabel,
    sizeBytes: Math.round(row.sizeBytes * step.ratio),
    current: index === 0,
  }))
}

/** The demo cast, for attributing revisions to real people. */
export const CAST: DriveOwner[] = [
  OWNERS.nora,
  OWNERS.theo,
  OWNERS.sana,
  OWNERS.leo,
  OWNERS.priya,
  OWNERS.kenji,
  OWNERS.elijah,
  OWNERS.mira,
]