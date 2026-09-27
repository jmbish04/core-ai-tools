"use client"

// Drive Explorer for Rivermark Studio. Frameless and full-height on purpose:
// the block owns no outer card, so it drops into any page shell as the main
// module. Folders ride in a band above; the browse surface below holds files,
// and one TanStack table instance backs both its list and grid views.
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useFileUpload } from "@/hooks/use-file-upload"
import {
  DataGrid,
  dataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import {
  SortingState,
  useTable,
  type ColumnVisibilityState,
  type RowSelectionState,
} from "@tanstack/react-table"
import { toast } from "./drive-toast"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
import { createDriveColumns } from "./columns"
import { DeleteDialog, NameDialog, type NamePrompt } from "./crud-dialogs"
import {
  buildDriveRows,
  CAST,
  collectAllRows,
  collectFiles,
  CURRENT_USER,
  defaultPrincipals,
  DRIVE_NAME,
  DRIVE_ROOT_ID,
  DRIVE_TREE,
  FILE_KIND_OPTIONS,
  findRow,
  formatCount,
  getFolderPath,
  insertChild,
  isDescendant,
  listFolder,
  makeFolder,
  makeUploadedFile,
  moveNode,
  removeNodes,
  renameNode,
  SHARE_TEAMS,
  STORAGE_PLAN_BYTES,
  toggleStarred,
  totalSize,
  versionsFor,
  type DriveNode,
  type DriveRow,
  type FileKind,
  type FileVersion,
  type LinkAccess,
  type SharePrincipal,
  type ShareRole,
  type ShareTeam,
} from "./data"
import { DriveEmptyState } from "./empty-state"
import { FileCardGrid } from "./file-card-grid"
import { FolderBand } from "./folder-band"
import {
  FolderTree,
  type DriveSelection,
  type FolderAction,
} from "./folder-tree"
import { HistorySheet } from "./history-sheet"
import { MoveDialog } from "./move-dialog"
import { OptionSelect } from "./option-select"
import { DriveSelectionBar } from "./selection-bar"
import { ShareSheet } from "./share-sheet"
import {
  UploadPanel,
  type UploadEntry,
  type UploadStatus,
} from "./upload-panel"
import {
  ViewSettings,
  type DriveDensity,
  type DriveProperty,
  type DriveSortKey,
} from "./view-settings"
import { FolderPlusIcon, UploadIcon, MenuIcon, SearchIcon, ListIcon, LayoutGridIcon } from "lucide-react"

const RECENT_LIMIT = 12
const SUGGESTED_FOLDER_LIMIT = 4

const SORT_STATES: Record<DriveSortKey, SortingState> = {
  "name-asc": [{ id: "name", desc: false }],
  "name-desc": [{ id: "name", desc: true }],
  "size-desc": [{ id: "size", desc: true }],
  "modified-desc": [{ id: "modified", desc: true }],
  "type-asc": [{ id: "type", desc: false }],
}

/**
 * Sorting is the single truth; the Sort select reads back out of it. A header
 * click can land on a state no preset names, so this reports "custom" and the
 * select shows it read-only rather than offering it as a choice.
 */
function sortKeyFromSorting(sorting: SortingState): DriveSortKey | "custom" {
  const match = Object.entries(SORT_STATES).find(
    ([, state]) =>
      state[0].id === sorting?.[0]?.id && state[0].desc === sorting?.[0]?.desc
  )
  return (match?.[0] as DriveSortKey) ?? "custom"
}

const SCOPE_LABELS = {
  recent: "Recent",
  starred: "Starred",
  shared: "Shared",
} as const

// Icon names must stay static literals; prettier-ignore keeps the table flat.
// prettier-ignore
const TOOLBAR_ICONS = {
  folderPlus: <FolderPlusIcon data-icon="inline-start" aria-hidden="true" />,
  dropzone: <UploadIcon aria-hidden="true" />,
  upload: <UploadIcon data-icon="inline-start" aria-hidden="true" />,
  menu: <MenuIcon aria-hidden="true" />,
  search: <SearchIcon aria-hidden="true" />,
  list: <ListIcon className="size-4" aria-hidden="true" />,
  grid: <LayoutGridIcon className="size-4" aria-hidden="true" />,
}

type DriveViewMode = "list" | "grid"

/** Cap a single upload so a mis-drop cannot balloon the demo drive. */
const UPLOAD_MAX_SIZE = 50 * 1024 * 1024

/** A node in the bin, with the parent it should return to on restore. */
interface TrashedEntry {
  row: DriveRow
  parentId: string
}

/** Transfer state for a file already present in the tree. */
interface UploadRecord {
  name: string
  sizeBytes: number
  progress: number
  status: UploadStatus
}

/**
 * True below the `sm` breakpoint. The drive's list view carries seven columns,
 * which cannot fit a phone without a sideways scroll, so the secondary ones
 * fold away there and the card view stays available for the full picture.
 */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)")
    const sync = () => setNarrow(query.matches)
    sync()
    // Both signals: `change` is the precise one, `resize` is the safety net for
    // embedders where the media-query event does not reach this document.
    query.addEventListener("change", sync)
    window.addEventListener("resize", sync)
    return () => {
      query.removeEventListener("change", sync)
      window.removeEventListener("resize", sync)
    }
  }, [])

  return narrow
}

export function DriveExplorer() {
  // The tree is the mutable truth; every row measure derives from it, so a
  // create, rename or delete reflows folder sizes and counts for free.
  const [tree, setTree] = useState<DriveNode[]>(DRIVE_TREE)
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveRow | null>(null)
  const [moveDestId, setMoveDestId] = useState<string>(DRIVE_ROOT_ID)
  const [moveParentId, setMoveParentId] = useState<string>(DRIVE_ROOT_ID)
  const [shareTarget, setShareTarget] = useState<DriveRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<DriveRow | null>(null)
  // Access lists are per node id, seeded on first open.
  const [shares, setShares] = useState<Record<string, SharePrincipal[]>>({})
  const [linkAccess, setLinkAccess] = useState<Record<string, LinkAccess>>({})
  const [linkRole, setLinkRole] = useState<Record<string, ShareRole>>({})
  const [shareTeams, setShareTeams] = useState<Record<string, ShareTeam[]>>({})
  const [selection, setSelection] = useState<DriveSelection>({
    type: "folder",
    id: DRIVE_ROOT_ID,
  })
  const [density, setDensity] = useState<DriveDensity>("compact")
  const [viewMode, setViewMode] = useState<DriveViewMode>("list")
  const [sorting, setSorting] = useState<SortingState>(SORT_STATES["name-asc"])
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<FileKind | "all">("all")
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [railOpen, setRailOpen] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([
    DRIVE_ROOT_ID,
    "fld-client",
  ])
  const [visibleProperties, setVisibleProperties] = useState<
    Record<DriveProperty, boolean>
  >({ owner: true, type: true, size: true, modified: true })

  const driveRows = useMemo(() => buildDriveRows(tree), [tree])

  // headless-tree caches its item instances, so changing the loader data is not
  // enough: the rail remounts whenever the folder shape changes. Expansion is
  // owned here so it survives that remount.
  const folderSignature = useMemo(
    () =>
      collectAllRows(driveRows)
        .filter((row) => row.node.kind === "folder")
        .map((row) => `${row.id}:${row.node.name}`)
        .join("|"),
    [driveRows]
  )

  // Rows for the active scope or folder.
  /**
   * The bin. Deleting moves a node here with the parent it came from, so
   * restore can put it back where it was; a folder goes as a whole subtree so
   * restoring brings its contents with it. If that parent has since been
   * deleted too, restore falls back to the drive root rather than failing.
   */
  const [trashed, setTrashed] = useState<TrashedEntry[]>([])

  const trashRows = useMemo(() => trashed.map((entry) => entry.row), [trashed])

  const moveToTrash = useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) return
      const entries: TrashedEntry[] = []
      ids.forEach((id) => {
        const row = findRow(driveRows, id)
        if (row) entries.push({ row, parentId: parentOf(id) })
      })
      if (entries.length === 0) return
      setTrashed((current) => [...entries, ...current])
      setTree((current) => removeNodes(current, ids))
    },
    // parentOf/findRow read driveRows, so this rebuilds with the tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driveRows]
  )

  const restoreFromTrash = useCallback((id: string) => {
    setTrashed((current) => {
      const entry = current.find((item) => item.row.id === id)
      if (!entry) return current
      setTree((tree) => {
        // The folder it came from may itself be gone; root is the honest
        // fallback, and it is what the toast promises.
        const target = findRow(tree, entry.parentId)
          ? entry.parentId
          : DRIVE_ROOT_ID
        return insertChild(tree, target, entry.row.node)
      })
      toast.success(`${entry.row.node.name} restored`)
      return current.filter((item) => item.row.id !== id)
    })
  }, [])

  const deleteForever = useCallback((id: string) => {
    setTrashed((current) => {
      const entry = current.find((item) => item.row.id === id)
      if (entry) toast.success(`${entry.row.node.name} deleted forever`)
      return current.filter((item) => item.row.id !== id)
    })
  }, [])

  const emptyBin = useCallback(() => {
    setTrashed((current) => {
      if (current.length > 0) toast.success("Bin emptied")
      return []
    })
  }, [])

  const isBin = selection.type === "scope" && selection.id === "bin"

  const scopeRows = useMemo(() => {
    if (selection.type === "folder") {
      return listFolder(driveRows, selection.id)
    }

    if (selection.id === "bin") {
      return trashRows
    }

    if (selection.id === "recent") {
      return [...collectFiles(driveRows)]
        .sort((a, b) => b.node.modifiedAt.localeCompare(a.node.modifiedAt))
        .slice(0, RECENT_LIMIT)
    }

    if (selection.id === "starred") {
      return collectAllRows(driveRows).filter((row) => row.node.starred)
    }

    return collectAllRows(driveRows).filter((row) => Boolean(row.node.sharedBy))
  }, [selection, driveRows, trashRows])

  const query = search.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      scopeRows.filter((row) => {
        const matchesKind = kindFilter === "all" || row.node.kind === kindFilter
        const matchesQuery =
          !query ||
          row.node.name.toLowerCase().includes(query) ||
          row.node.owner.name.toLowerCase().includes(query)
        return matchesKind && matchesQuery
      }),
    [scopeRows, kindFilter, query]
  )

  // The band is a short suggestion strip; the table and grid still list every
  // row, folders included, so nothing is reachable only from the band.
  const suggestedFolders = useMemo(
    () =>
      filteredRows
        .filter((row) => row.node.kind === "folder")
        .sort((a, b) => b.node.modifiedAt.localeCompare(a.node.modifiedAt))
        .slice(0, SUGGESTED_FOLDER_LIMIT),
    [filteredRows]
  )

  // The suggestion headings are an index-level affordance; inside a folder the
  // listing is just that folder's contents.
  const isDriveRoot =
    selection.type === "folder" && selection.id === DRIVE_ROOT_ID
  const hasFilters = query.length > 0 || kindFilter !== "all"
  const isEmpty = filteredRows.length === 0

  const isNarrow = useIsNarrow()

  const columnVisibility = useMemo<ColumnVisibilityState>(
    () => ({
      // On a phone only name and its actions survive: the rest would force a
      // horizontal scroll, which is worse than not showing them. The user's own
      // choices are preserved and reapply as soon as there is room.
      owner: !isNarrow && visibleProperties.owner,
      type: !isNarrow && visibleProperties.type,
      size: !isNarrow && visibleProperties.size,
      modified: !isNarrow && visibleProperties.modified,
    }),
    [visibleProperties, isNarrow]
  )

  // Navigating resets everything scoped to the old listing: a stale selection
  // would apply to rows the user can no longer see.
  const goTo = useCallback((next: DriveSelection) => {
    setSelection(next)
    setRowSelection({})
    setRailOpen(false)
  }, [])

  const handleOpen = useCallback(
    (row: DriveRow) => {
      if (row.node.kind === "folder") {
        goTo({ type: "folder", id: row.id })
        return
      }
      toast.info(`Opening ${row.node.name}`)
    },
    [goTo]
  )

  const handleToggleStar = useCallback((row: DriveRow) => {
    setTree((current) => toggleStarred(current, row.id))
  }, [])

  const handleRowAction = useCallback(
    (action: string, row: DriveRow) => {
      if (action === "rename") {
        setNamePrompt({
          mode: "rename",
          targetId: row.id,
          currentName: row.node.name,
        })
        return
      }
      if (action === "remove") {
        setDeleteTarget(row)
        return
      }
      if (action === "star") {
        handleToggleStar(row)
        return
      }
      if (action === "share") {
        openShare(row)
        return
      }
      if (action === "move") {
        setMoveDestId(DRIVE_ROOT_ID)
        setMoveParentId(parentOf(row.id))
        setMoveTarget(row)
        return
      }
      if (action === "history") {
        // Deferred a frame so the menu's dismiss cannot close the sheet.
        requestAnimationFrame(() => setHistoryTarget(row))
        return
      }
      if (action === "link") {
        void navigator.clipboard
          ?.writeText(`https://rivermark.studio/d/${row.id}`)
          .catch(() => undefined)
        toast.success("Link copied")
        return
      }
      toast.success(`Downloading ${row.node.name}`)
    },
    // parentOf reads driveRows, so this must rebuild when the tree changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleToggleStar, driveRows]
  )

  /**
   * In-flight uploads, keyed by the drive node id. A file is inserted into the
   * tree immediately so it is real and selectable, and this record tracks only
   * the transfer: progress while it runs, an error the user can retry, or
   * absence once it has landed. Cancelling removes both the record and the node.
   */
  const [uploads, setUploads] = useState<Record<string, UploadRecord>>({})

  /** Upload ids already turned into drive nodes, so a re-emit cannot duplicate. */
  const ingestedUploadIds = useRef<Set<string>>(new Set())

  // One ticker drives every in-flight upload. It only runs while something is
  // uploading, so an idle drive schedules no timers.
  const hasActiveUpload = Object.values(uploads).some(
    (record) => record.status === "uploading"
  )

  useEffect(() => {
    if (!hasActiveUpload) return

    const timer = setInterval(() => {
      setUploads((current) => {
        let changed = false
        const next: Record<string, UploadRecord> = {}
        for (const [id, record] of Object.entries(current)) {
          if (record.status !== "uploading") {
            next[id] = record
            continue
          }
          const advanced = record.progress + Math.random() * 16 + 6
          if (advanced < 100) {
            next[id] = { ...record, progress: advanced }
            changed = true
            continue
          }
          // A demo drive has no server, so a small share of transfers fail to
          // exercise the retry path rather than always succeeding.
          // Success keeps the record at `done` so the transfer panel can show
          // a completed row; the node itself is already an ordinary file.
          next[id] =
            Math.random() < 0.12
              ? { ...record, progress: 100, status: "error" }
              : { ...record, progress: 100, status: "done" }
          changed = true
        }
        return changed ? next : current
      })
    }, 280)

    return () => clearInterval(timer)
  }, [hasActiveUpload])

  const cancelUpload = useCallback((nodeId: string) => {
    if (nodeId.startsWith("rejected-")) {
      clearUploadErrors()
      return
    }
    setUploads((current) => {
      const { [nodeId]: removed, ...rest } = current
      if (!removed) return current
      return rest
    })
    setTree((current) => removeNodes(current, new Set([nodeId])))
  }, [])

  const retryUpload = useCallback((nodeId: string) => {
    setUploads((current) => {
      const record = current[nodeId]
      if (!record) return current
      return {
        ...current,
        [nodeId]: { ...record, progress: 0, status: "uploading" },
      }
    })
  }, [])

  // The hook owns only the picker and the drag state; the drive tree stays the
  // one source of truth for what exists. Files are inserted here as real nodes
  // carrying the browser's own name, byte size and type.
  const [
    { isDragging, errors: uploadErrors },
    {
      clearErrors: clearUploadErrors,
      openFileDialog,
      getInputProps,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
    },
  ] = useFileUpload({
    multiple: true,
    maxSize: UPLOAD_MAX_SIZE,
    onFilesChange: (incoming) => {
      // The hook keeps its own accumulating list and re-emits it, so ingesting
      // `incoming` wholesale would insert the same drop twice. Track the ids
      // already turned into drive nodes and only take the new ones.
      const fresh = incoming.filter(
        (entry) => !ingestedUploadIds.current.has(entry.id)
      )
      if (fresh.length === 0) return
      fresh.forEach((entry) => ingestedUploadIds.current.add(entry.id))

      const uploaded = fresh
        .map((entry) => entry.file)
        .filter((file): file is File => file instanceof File)
        .map((file) => makeUploadedFile(file, CURRENT_USER))
      if (uploaded.length === 0) return

      setTree((current) =>
        uploaded.reduce(
          (tree, node) => insertChild(tree, currentFolderId, node),
          current
        )
      )
      setUploads((current) => {
        const next = { ...current }
        uploaded.forEach((node) => {
          next[node.id] = {
            name: node.name,
            sizeBytes: node.sizeBytes,
            progress: 0,
            status: "uploading",
          }
        })
        return next
      })
      // Scopes like Starred and Shared filter by a property a new file has not
      // earned yet, so land the user in the folder it actually went into.
      // No toast here: the transfer panel already reports every upload, and a
      // toast on top of it would be a second, transient copy of the same state.
      revealFolder(currentFolderId)
    },
  })

  function handleUpload() {
    openFileDialog()
  }

  /** Panel chrome. Closing clears settled rows and hides it until the next drop. */
  const [uploadPanelCollapsed, setUploadPanelCollapsed] = useState(false)

  // The hook rejects files that break maxSize/maxFiles before they ever reach
  // onFilesChange, so without this a too-large pick is completely silent: no
  // row, no panel, nothing. Surface them as failed rows in the same panel that
  // reports every other transfer.
  const rejectedEntries = useMemo<UploadEntry[]>(
    () =>
      uploadErrors.map((message, index) => ({
        id: `rejected-${index}`,
        name: message,
        sizeBytes: 0,
        progress: 100,
        status: "rejected" as const,
      })),
    [uploadErrors]
  )

  const liveUploadEntries = useMemo<UploadEntry[]>(
    () =>
      Object.entries(uploads).map(([id, record]) => ({
        id,
        name: record.name,
        sizeBytes: record.sizeBytes,
        progress: record.progress,
        status: record.status,
      })),
    [uploads]
  )

  const uploadEntries = useMemo(
    () => [...liveUploadEntries, ...rejectedEntries],
    [liveUploadEntries, rejectedEntries]
  )

  // Closing is only allowed to drop settled rows: a transfer still running must
  // keep its cancel control reachable rather than being hidden behind an X.
  const closeUploadPanel = useCallback(() => {
    // Rejections live in the hook's own error list, not in `uploads`; clearing
    // only one of the two left the panel stuck open with nothing to act on.
    clearUploadErrors()
    setUploads((current) => {
      const next: Record<string, UploadRecord> = {}
      for (const [id, record] of Object.entries(current)) {
        if (record.status === "uploading") next[id] = record
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const columns = useMemo(
    () =>
      createDriveColumns({
        onOpen: handleOpen,
        onAction: handleRowAction,
        onToggleStar: handleToggleStar,
        uploads,
        // In the bin a row is not a live file: opening, starring and the usual
        // menu do not apply, so it gets restore and delete-forever instead.
        binMode: isBin,
        onRestore: restoreFromTrash,
        onDeleteForever: deleteForever,
      }),
    [
      handleOpen,
      handleRowAction,
      handleToggleStar,
      uploads,
      isBin,
      restoreFromTrash,
      deleteForever,
    ]
  )

  // No pager: the surface scrolls, so one page always holds every file.
  const pagination = useMemo(
    () => ({ pageIndex: 0, pageSize: Math.max(filteredRows.length, 1) }),
    [filteredRows]
  )

  const table = useTable({
    features: dataGridFeatures,
    data: filteredRows,
    columns,
    getRowId: (row) => row.id,
    state: { sorting, pagination, rowSelection, columnVisibility },
    enableRowSelection: true,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
  })

  // The grid renders the table's row model, not the raw rows, so sorting and
  // filtering read identically in both views.
  const pageRows = table.getRowModel().rows.map((row) => row.original)

  const selectedIds = useMemo(
    () => new Set(Object.keys(rowSelection).filter((id) => rowSelection[id])),
    [rowSelection]
  )

  const selectionSummary = useMemo(() => {
    const rows = collectAllRows(driveRows).filter((row) =>
      selectedIds.has(row.id)
    )
    return {
      count: rows.length,
      bytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
    }
  }, [selectedIds, driveRows])

  const breadcrumb = useMemo(() => {
    if (selection.type === "scope") {
      return [
        { id: DRIVE_ROOT_ID, label: "My Drive" },
        { id: selection.id, label: SCOPE_LABELS[selection.id] },
      ]
    }

    return getFolderPath(driveRows, selection.id).map((id) => ({
      id,
      label:
        id === DRIVE_ROOT_ID
          ? "My Drive"
          : (findRow(driveRows, id)?.node.name ?? "Folder"),
    }))
  }, [selection, driveRows])

  const usedBytes = totalSize(driveRows)

  function handleCardSelectChange(row: DriveRow, next: boolean) {
    setRowSelection((prev) => {
      const draft = { ...prev }
      if (next) {
        draft[row.id] = true
      } else {
        delete draft[row.id]
      }
      return draft
    })
  }

  function toggleProperty(property: DriveProperty) {
    setVisibleProperties((current) => ({
      ...current,
      [property]: !current[property],
    }))
  }

  function clearFilters() {
    setSearch("")
    setKindFilter("all")
  }

  const currentFolderId =
    selection.type === "folder" ? selection.id : DRIVE_ROOT_ID

  /** A scope view filters by a property a brand new item does not have yet. */
  function revealFolder(folderId: string) {
    if (selection.type !== "folder") {
      setSelection({ type: "folder", id: folderId })
    }
  }

  /** The folder an item currently sits in, for the "current location" chip. */
  function parentOf(id: string) {
    const path = getFolderPath(driveRows, id)
    return path[path.length - 2] ?? DRIVE_ROOT_ID
  }

  function labelFor(id: string) {
    return id === DRIVE_ROOT_ID
      ? "My Drive"
      : (findRow(driveRows, id)?.node.name ?? "this folder")
  }

  function handleFolderAction(action: FolderAction, folderId: string) {
    if (action === "new") {
      setNamePrompt({
        mode: "create",
        parentId: folderId,
        parentLabel: labelFor(folderId),
      })
      return
    }
    if (action === "rename") {
      // The drive root is a synthetic tree node with no entry in the data, so
      // renaming it would walk the tree, match nothing, and still toast.
      if (!findRow(driveRows, folderId)) return
      setNamePrompt({
        mode: "rename",
        targetId: folderId,
        currentName: labelFor(folderId),
      })
      return
    }
    if (action === "history") {
      const target = findRow(driveRows, folderId)
      if (target) requestAnimationFrame(() => setHistoryTarget(target))
      return
    }
    if (action === "move") {
      const target = findRow(driveRows, folderId)
      if (target) {
        setMoveDestId(DRIVE_ROOT_ID)
        setMoveParentId(parentOf(folderId))
        setMoveTarget(target)
      }
      return
    }
    if (action === "delete") {
      const target = findRow(driveRows, folderId)
      if (target) setDeleteTarget(target)
      return
    }
    toast.success(`Downloading ${labelFor(folderId)}`)
  }

  function submitName(name: string) {
    if (!namePrompt) return

    if (namePrompt.mode === "create") {
      setTree((current) =>
        insertChild(
          current,
          namePrompt.parentId,
          makeFolder(name, CURRENT_USER)
        )
      )
      revealFolder(namePrompt.parentId)
      toast.success(`${name} created`)
    } else {
      setTree((current) => renameNode(current, namePrompt.targetId, name))
      toast.success(`Renamed to ${name}`)
    }

    setNamePrompt(null)
  }

  function confirmDelete() {
    if (!deleteTarget) return

    const name = deleteTarget.node.name
    moveToTrash(new Set([deleteTarget.id]))
    setRowSelection({})
    // Not just the open folder: deleting any ancestor of it leaves the
    // selection pointing at a node that no longer exists.
    if (
      selection.type === "folder" &&
      // getFolderPath returns ids from the root down to the folder
      getFolderPath(driveRows, selection.id).includes(deleteTarget.id)
    ) {
      setSelection({ type: "folder", id: DRIVE_ROOT_ID })
    }
    setDeleteTarget(null)
    toast.success(`${name} moved to trash`)
  }

  // A folder cannot move into itself or anything beneath it.
  // The item itself and everything under it: moving into those would orphan it.
  const moveBlocked = new Set(
    moveTarget
      ? collectAllRows(driveRows)
          .filter(
            (row) =>
              row.id === moveTarget.id ||
              isDescendant(tree, moveTarget.id, row.id)
          )
          .map((row) => row.id)
      : []
  )

  function confirmMove() {
    if (!moveTarget) return
    const name = moveTarget.node.name
    setTree((current) => moveNode(current, moveTarget.id, moveDestId))
    setMoveTarget(null)
    toast.success(`${name} moved to ${labelFor(moveDestId)}`)
  }

  const shareId = shareTarget?.id ?? ""
  const sharePrincipals =
    shares[shareId] ??
    (shareTarget ? defaultPrincipals(shareTarget.node.owner) : [])

  function openShare(row: DriveRow) {
    setShares((current) =>
      current[row.id]
        ? current
        : { ...current, [row.id]: defaultPrincipals(row.node.owner) }
    )
    // Deferred a frame: the menu's own dismiss would otherwise close the sheet.
    requestAnimationFrame(() => setShareTarget(row))
  }

  function updateShares(next: (list: SharePrincipal[]) => SharePrincipal[]) {
    setShares((current) => ({ ...current, [shareId]: next(sharePrincipals) }))
  }

  const historyVersions = historyTarget ? versionsFor(historyTarget, CAST) : []

  function restoreVersion(version: FileVersion) {
    toast.success(`Restored ${version.label} of ${historyTarget?.node.name}`)
    setHistoryTarget(null)
  }

  function copyLink(id: string) {
    void navigator.clipboard
      ?.writeText(`https://rivermark.studio/d/${id}`)
      .catch(() => undefined)
    toast.success("Link copied")
  }

  function removeSelected() {
    moveToTrash(selectedIds)
    toast.success(`${formatCount(selectedIds.size)} items moved to trash`)
    setRowSelection({})
  }

  const rail = (
    <FolderTree
      key={folderSignature}
      rows={driveRows}
      selection={selection}
      usedBytes={usedBytes}
      planBytes={STORAGE_PLAN_BYTES}
      onSelect={goTo}
      onGetStorage={() => toast.info("Storage plans open here")}
      onFolderAction={handleFolderAction}
      expandedItems={expandedFolderIds}
      onExpandedChange={setExpandedFolderIds}
      className="h-full"
    />
  )

  return (
    <DataGrid
      table={table}
      recordCount={filteredRows.length}
      tableLayout={{
        dense: density === "compact",
        columnsResizable: false,
        columnsVisibility: false,
        rowBorder: true,
      }}
      tableClassNames={{
        bodyRow: "group/row",
        edgeCell: "first:ps-4 last:pe-4",
      }}
    >
      {/* Root container only. The Card style owns padding and gap; both are
          zeroed here, with ! so the reset holds wherever the card is reused. */}
      <Card className="relative h-full min-h-0 w-full gap-0! overflow-hidden p-0!">
        {/* Docked over the drive, inside the block's own card so it never
            escapes into the page chrome the way a `fixed` panel would. */}
        <UploadPanel
          entries={uploadEntries}
          collapsed={uploadPanelCollapsed}
          onToggleCollapsed={() => setUploadPanelCollapsed((open) => !open)}
          onClose={closeUploadPanel}
          onCancel={cancelUpload}
          onRetry={retryUpload}
        />
        <CardContent className="flex min-h-0 flex-1 flex-col p-0!">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-foreground text-base leading-none font-semibold">
                ReUI Drive
              </h2>
              <p className="text-muted-foreground truncate text-xs max-sm:hidden">
                Shared studio files and folders
              </p>
            </div>
            {/* Below sm the two actions would squeeze the title to an
                ellipsis, so the labels drop and the buttons become icons. */}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleFolderAction("new", currentFolderId)}
              >
                {TOOLBAR_ICONS.folderPlus}
                <span className="max-sm:sr-only">New Folder</span>
              </Button>
              <Button type="button" onClick={handleUpload}>
                {TOOLBAR_ICONS.upload}
                <span className="max-sm:sr-only">Upload</span>
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Folder rail */}
            <aside className="border-border hidden w-64 shrink-0 border-e lg:flex lg:flex-col">
              {rail}
            </aside>

            {/* Browse panel */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Toolbar */}
              <div className="flex min-w-0 shrink-0 flex-col gap-2 px-4 py-2.5 lg:flex-row lg:items-center">
                {/* Path */}
                <div className="flex min-w-0 items-center gap-2 lg:me-auto">
                  <Sheet open={railOpen} onOpenChange={setRailOpen}>
                    <SheetTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="shrink-0 lg:hidden"
                          aria-label="Open navigation"
                        >
                          {TOOLBAR_ICONS.menu}
                        </Button>
                      }
                    />
                    <SheetContent side="left" className="w-72 p-0">
                      <SheetHeader className="border-b">
                        <SheetTitle>{DRIVE_NAME}</SheetTitle>
                        <SheetDescription>
                          Pick a folder or a saved view
                        </SheetDescription>
                      </SheetHeader>
                      <div className="min-h-0 flex-1">{rail}</div>
                    </SheetContent>
                  </Sheet>

                  <Breadcrumb className="min-w-0">
                    <BreadcrumbList className="flex-nowrap">
                      {breadcrumb.map((crumb, index) => {
                        const last = index === breadcrumb.length - 1

                        // Separator is a sibling <li>, never nested inside the
                        // item: an <li> inside an <li> is invalid and hydrates
                        // differently on the client.
                        return (
                          <Fragment key={crumb.id}>
                            <BreadcrumbItem className="min-w-0">
                              {last ? (
                                <BreadcrumbPage className="truncate">
                                  {crumb.label}
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink
                                  render={
                                    <button
                                      type="button"
                                      className="truncate"
                                      onClick={() =>
                                        goTo({ type: "folder", id: crumb.id })
                                      }
                                    >
                                      {crumb.label}
                                    </button>
                                  }
                                />
                              )}
                            </BreadcrumbItem>
                            {last ? null : <BreadcrumbSeparator />}
                          </Fragment>
                        )
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>

                {/* Controls */}
                <div className="flex min-w-0 flex-wrap items-center gap-2 lg:flex-nowrap">
                  <InputGroup className="w-full lg:w-56">
                    <InputGroupAddon>{TOOLBAR_ICONS.search}</InputGroupAddon>
                    <InputGroupInput
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search files"
                      aria-label="Search files"
                    />
                  </InputGroup>

                  <OptionSelect
                    value={kindFilter}
                    options={[
                      { value: "all" as const, label: "All types" },
                      ...FILE_KIND_OPTIONS,
                    ]}
                    ariaLabel="Filter by type"
                    size="default"
                    className="flex-1 lg:w-[132px] lg:flex-none"
                    onChange={(next) => setKindFilter(next)}
                  />

                  <ToggleGroup
                    multiple={false}
                    spacing={0}
                    value={[viewMode]}
                    onValueChange={(next: string[]) => {
                      // Deselecting the active item yields [], which would
                      // leave the browse surface with no view at all.
                      const mode = next[0] as DriveViewMode | undefined
                      if (mode) setViewMode(mode)
                    }}
                    variant="outline"
                    size="default"
                    aria-label="Browse view"
                    className="shrink-0"
                  >
                    <ToggleGroupItem value="list" aria-label="List view">
                      {TOOLBAR_ICONS.list}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="grid" aria-label="Grid view">
                      {TOOLBAR_ICONS.grid}
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <ViewSettings
                    density={density}
                    sortKey={sortKeyFromSorting(sorting)}
                    visibleProperties={visibleProperties}
                    onDensityChange={setDensity}
                    onSortChange={(next) => {
                      // "custom" names a header-click state, not a preset;
                      // committing it would set sorting to undefined.
                      const preset = SORT_STATES[next]
                      if (preset) setSorting(preset)
                    }}
                    onToggleProperty={toggleProperty}
                  />
                </div>
              </div>

              <Separator />

              {/* Selection */}
              {selectionSummary.count > 0 ? (
                <DriveSelectionBar
                  selectedCount={selectionSummary.count}
                  selectedBytes={selectionSummary.bytes}
                  onDownload={() =>
                    toast.success(
                      `Downloading ${formatCount(selectionSummary.count)} items`
                    )
                  }
                  onShare={() =>
                    toast.info(
                      `Sharing ${formatCount(selectionSummary.count)} items`
                    )
                  }
                  onRemove={removeSelected}
                  onClear={() => setRowSelection({})}
                />
              ) : null}

              {/* Content: the one scroll owner, so the shell never grows.
                  It is also the drop target: dropping anywhere over the browse
                  surface uploads into the folder currently being viewed. */}
              {/* The drop surface is the wrapper, not the scroller: an
                  overlay inside an `overflow-y-auto` element scrolls away with
                  the content, so it drifted off the visible area as soon as the
                  list was scrolled. The wrapper never scrolls, so `absolute`
                  here always means "over what the user can currently see". */}
              <div
                className="relative flex min-h-0 flex-1 flex-col"
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <input {...getInputProps()} className="sr-only" tabIndex={-1} />
                {isDragging ? (
                  <div
                    aria-hidden="true"
                    className="border-primary bg-background/80 pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed backdrop-blur-[2px]"
                  >
                    {/* An affordance, not a control: icon over label over hint,
                        with no fill or shadow, so it cannot be mistaken for a
                        button the user is meant to click mid-drag. The backdrop
                        carries the legibility instead of a solid pill. */}
                    <span className="flex flex-col items-center gap-2 text-center">
                      <span className="border-primary/40 bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full border border-dashed [&_svg]:size-5">
                        {TOOLBAR_ICONS.dropzone}
                      </span>
                      <span className="text-foreground text-sm font-medium">
                        Drop files to upload
                      </span>
                      <span className="text-muted-foreground text-xs">
                        They land in{" "}
                        {breadcrumb[breadcrumb.length - 1]?.label ??
                          "this folder"}
                      </span>
                    </span>
                  </div>
                ) : null}
                <ScrollArea className="min-h-0 flex-1">
                  {isEmpty ? (
                    <DriveEmptyState
                      filtered={hasFilters}
                      onClearFilters={clearFilters}
                      onUpload={handleUpload}
                    />
                  ) : (
                    <>
                      {/* Two peer groups, one rhythm: each is label + gap-2 +
                        content, and the single parent gap is what separates
                        them. Neither band pads itself, so the two can never
                        drift apart. */}
                      <div className="flex flex-col gap-5 pt-3 pb-4">
                        <FolderBand
                          folders={suggestedFolders}
                          onOpen={handleOpen}
                        />

                        <div className="flex flex-col gap-2">
                          {isDriveRoot ? (
                            <p className="text-muted-foreground px-4 text-xs font-medium">
                              Suggested Files
                            </p>
                          ) : null}

                          {viewMode === "grid" ? (
                            <FileCardGrid
                              rows={pageRows}
                              visibleProperties={visibleProperties}
                              selectedIds={selectedIds}
                              onOpen={handleOpen}
                              onSelectChange={handleCardSelectChange}
                              onToggleStar={handleToggleStar}
                            />
                          ) : (
                            <DataGridScrollArea>
                              <DataGridTable />
                            </DataGridScrollArea>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </ScrollArea>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <NameDialog
        prompt={namePrompt}
        onSubmit={submitName}
        onOpenChange={(open) => {
          if (!open) setNamePrompt(null)
        }}
      />
      <MoveDialog
        open={moveTarget !== null}
        targetName={moveTarget?.node.name ?? ""}
        rows={driveRows}
        destId={moveDestId}
        currentParent={labelFor(moveParentId)}
        destPath={getFolderPath(driveRows, moveDestId).map(labelFor)}
        disabledIds={moveBlocked}
        onDest={setMoveDestId}
        destPathOf={(id) => getFolderPath(driveRows, id).map(labelFor)}
        onConfirm={confirmMove}
        onOpenChange={(open: boolean) => {
          if (!open) setMoveTarget(null)
        }}
      />
      <HistorySheet
        target={historyTarget}
        versions={historyVersions}
        onOpenChange={(open) => {
          if (!open) setHistoryTarget(null)
        }}
        onRestore={restoreVersion}
        onDownload={(version) => toast.success(`Downloading ${version.label}`)}
      />
      <ShareSheet
        target={shareTarget}
        principals={sharePrincipals}
        teams={shareTeams[shareId] ?? SHARE_TEAMS}
        linkAccess={linkAccess[shareId] ?? "restricted"}
        linkRole={linkRole[shareId] ?? "viewer"}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
        onInvite={(email, role) =>
          updateShares((list) =>
            // The id IS the address, so a second invite would duplicate a React
            // key and make remove/role-change ambiguous. Re-grant instead.
            list.some((p) => p.id === email)
              ? list.map((p) => (p.id === email ? { ...p, role } : p))
              : [...list, { id: email, name: email.split("@")[0], email, role }]
          )
        }
        onRoleChange={(id, role) =>
          updateShares((list) =>
            list.map((p) => (p.id === id ? { ...p, role } : p))
          )
        }
        onRemove={(id) =>
          updateShares((list) => list.filter((p) => p.id !== id))
        }
        onTeamRoleChange={(id, role) =>
          setShareTeams((current) => ({
            ...current,
            [shareId]: (current[shareId] ?? SHARE_TEAMS).map((team) =>
              team.id === id ? { ...team, role } : team
            ),
          }))
        }
        onLinkAccessChange={(next) =>
          setLinkAccess((current) => ({ ...current, [shareId]: next }))
        }
        onLinkRoleChange={(next) =>
          setLinkRole((current) => ({ ...current, [shareId]: next }))
        }
        onCopyLink={() => copyLink(shareId)}
      />
      <DeleteDialog
        open={deleteTarget !== null}
        targetLabel={deleteTarget?.node.name ?? "This item"}
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </DataGrid>
  )
}