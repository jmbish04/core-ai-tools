/**
 * @fileoverview Image library page component — complete implementation matching
 * the Monolith design system (Library.dc.html). Includes:
 *   - Folder tree sidebar with nesting, folder item counts, and new folder creation.
 *   - Direct creator upload to Cloudflare Images with drag-and-drop dropzone.
 *   - Search by filename/kind and active folder filtering.
 *   - Multi-select toolbar for batch operations (move to folder, soft delete, start session).
 *   - Slide-over detail drawer showing image metadata, preview, and every session
 *     spawned from this origin image (`list_sessions_for_image`), plus a "Start new session" CTA.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Grid,
  ImageIcon,
  Images,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";

import { apiGet, apiSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function variant(deliveryUrl: string, name: string): string {
  if (!deliveryUrl) return "";
  return deliveryUrl.replace(/\/[^/]+$/, `/${name}`);
}

interface LibraryImage {
  id: string;
  deliveryUrl: string;
  originalFilename: string | null;
  folderId: string | null;
  mediaType: "image" | "video";
  kind: string;
  bytes?: number | null;
  createdAt?: string;
  width?: number | null;
  height?: number | null;
}

interface LibraryFolder {
  id: string;
  name: string;
  parentFolderId: string | null;
}

interface Session {
  sessionUuid: string;
  title: string | null;
  status: string;
  createdVia: string;
  lastActivityAt: string;
  originLibraryImageId: string;
}

type TileStatus = "done" | "uploading" | "error";

interface Tile {
  key: string;
  id: string | null;
  name: string;
  folderId: string | null;
  status: TileStatus;
  thumbUrl?: string;
  previewUrl?: string;
  localPreview?: string;
  error?: string;
  file?: File;
  size?: number;
  createdAt?: string;
}

interface UploadIntent {
  uploadURL: string;
  cfImageId: string;
}

function tileFromImage(img: LibraryImage): Tile {
  return {
    key: img.id,
    id: img.id,
    name: img.originalFilename ?? img.kind,
    folderId: img.folderId,
    status: "done",
    thumbUrl: variant(img.deliveryUrl, "thumb"),
    previewUrl: variant(img.deliveryUrl, "preview"),
    size: img.bytes ?? undefined,
    createdAt: img.createdAt,
  };
}

async function uploadOne(file: File, folderId?: string | null): Promise<LibraryImage> {
  const intent = await apiSend<UploadIntent>("POST", "library/upload-intent", {});
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(intent.uploadURL, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Cloudflare Images upload failed (${res.status})`);
  return apiSend<LibraryImage>("POST", "library/complete-upload", {
    cfImageId: intent.cfImageId,
    folderId: folderId ?? null,
    originalFilename: file.name,
    contentType: file.type || null,
    bytes: file.size,
  });
}

function formatBytes(n?: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function LibraryGrid() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  
  // Slide-over detail drawer state
  const [detailTile, setDetailTile] = useState<Tile | null>(null);
  const [detailSessions, setDetailSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Modal states
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [targetMoveFolder, setTargetMoveFolder] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const patch = useCallback((key: string, p: Partial<Tile>) => {
    setTiles((prev) => prev.map((t) => (t.key === key ? { ...t, ...p } : t)));
  }, []);

  const loadData = useCallback(() => {
    Promise.all([
      apiGet<{ images: LibraryImage[] }>("library/images"),
      apiGet<{ folders: LibraryFolder[] }>("library/folders"),
    ])
      .then(([imgRes, foldRes]) => {
        setTiles((prev) => [
          ...prev.filter((t) => t.status !== "done"),
          ...imgRes.images.map(tileFromImage),
        ]);
        setFolders(foldRes.folders ?? []);
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError(e?.message ?? "Failed to load library");
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load sessions spawned for selected image in detail drawer
  useEffect(() => {
    if (!detailTile?.id) {
      setDetailSessions([]);
      return;
    }
    setLoadingSessions(true);
    apiGet<{ sessions: Session[] }>("sessions", { forImage: detailTile.id })
      .then((r) => setDetailSessions(r.sessions ?? []))
      .catch(() => setDetailSessions([]))
      .finally(() => setLoadingSessions(false));
  }, [detailTile]);

  const runUpload = useCallback(
    async (key: string, file: File) => {
      patch(key, { status: "uploading", error: undefined });
      try {
        const row = await uploadOne(file, activeFolderId);
        patch(key, {
          id: row.id,
          folderId: row.folderId,
          status: "done",
          thumbUrl: variant(row.deliveryUrl, "thumb"),
          previewUrl: variant(row.deliveryUrl, "preview"),
        });
      } catch (e) {
        patch(key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
      }
    },
    [patch, activeFolderId],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
      const next: Tile[] = imgs.map((file) => ({
        key: `u${seq.current++}`,
        id: null,
        name: file.name,
        folderId: activeFolderId,
        status: "uploading",
        localPreview: URL.createObjectURL(file),
        file,
        size: file.size,
      }));
      setTiles((prev) => [...next, ...prev]);
      imgs.forEach((file, idx) => {
        runUpload(next[idx].key, file);
      });
    },
    [runUpload, activeFolderId],
  );

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await apiSend("POST", "library/folders", {
        name: newFolderName.trim(),
        parentFolderId: activeFolderId,
      });
      setNewFolderName("");
      setNewFolderOpen(false);
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create folder");
    }
  };

  const handleMoveSelected = async () => {
    if (selected.length === 0) return;
    try {
      await Promise.all(
        selected.map((id) =>
          apiSend("POST", `library/images/${id}/move`, { folderId: targetMoveFolder }),
        ),
      );
      setMoveModalOpen(false);
      setSelected([]);
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to move images");
    }
  };

  const handleDeleteSelected = async () => {
    if (selected.length === 0) return;
    if (!confirm(`Soft-delete ${selected.length} selected image(s)?`)) return;
    try {
      await Promise.all(selected.map((id) => apiSend("DELETE", `library/images/${id}`)));
      setSelected([]);
      loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete images");
    }
  };

  const handleStartSession = async (imageId: string) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await apiSend<{ sessionUuid: string }>("POST", "sessions", {
        originLibraryImageId: imageId,
        createdVia: "ui",
      });
      window.location.href = `/sessions/${res.sessionUuid}`;
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Failed to start session");
      setStarting(false);
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // Filtering
  const filteredTiles = tiles.filter((tile) => {
    if (activeFolderId !== null && tile.folderId !== activeFolderId) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return tile.name.toLowerCase().includes(q);
    }
    return true;
  });

  const activeFolderName =
    folders.find((f) => f.id === activeFolderId)?.name ?? "All images";

  return (
    <div className="flex max-w-7xl flex-col gap-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            LIBRARY &bull; CORE-AI-TOOLS
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Image library
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tiles.filter((t) => t.status === "done").length} photos stored &bull; Organize by folder &amp; launch session trees
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search filenames..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card ring-1 ring-border/40"
            />
          </div>

          <Button
            onClick={() => inputRef.current?.click()}
            className="gap-2 bg-primary text-primary-foreground font-medium hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" /> Upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>
      </div>

      {startError && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/15 p-3 text-sm text-destructive ring-1 ring-destructive/30">
          <AlertCircle className="h-4 w-4" />
          {startError}
        </div>
      )}

      {/* Main split: Folders sidebar + Image grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Sidebar */}
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

          <button
            onClick={() => setActiveFolderId(null)}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeFolderId === null
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Images className="h-4 w-4 text-primary" />
              <span>All images</span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {tiles.filter((t) => t.status === "done").length}
            </span>
          </button>

          <div className="mt-1 flex flex-col gap-1 border-t border-border/40 pt-2">
            {folders.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">
                No folders created yet.
              </p>
            ) : (
              folders.map((folder) => {
                const count = tiles.filter(
                  (t) => t.folderId === folder.id && t.status === "done",
                ).length;
                const isActive = activeFolderId === folder.id;
                return (
                  <button
                    key={folder.id}
                    onClick={() => setActiveFolderId(folder.id)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{folder.name}</span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex flex-col gap-4">
          {/* Multi-select bar */}
          {selected.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-primary/10 px-4 py-2.5 ring-1 ring-primary/30">
              <span className="text-sm font-medium text-primary">
                {selected.length} image(s) selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMoveModalOpen(true)}
                  className="h-8 gap-1.5 ring-1 ring-border/40"
                >
                  <Folder className="h-3.5 w-3.5" /> Move
                </Button>
                {selected.length === 1 && (
                  <Button
                    size="sm"
                    onClick={() => handleStartSession(selected[0])}
                    disabled={starting}
                    className="h-8 gap-1.5 bg-primary text-primary-foreground"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Start Session
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteSelected}
                  className="h-8 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected([])}
                  className="h-8 text-xs text-muted-foreground"
                >
                  Deselect all
                </Button>
              </div>
            </div>
          )}

          {/* Drag & drop dropzone + Grid */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
            }}
            className={`min-h-[400px] rounded-xl p-4 transition-all ${
              dragging
                ? "bg-primary/5 ring-2 ring-dashed ring-primary"
                : "bg-card/50 ring-1 ring-border/40"
            }`}
          >
            {filteredTiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <ImageIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  No images in {activeFolderName}
                </h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Drag and drop photo assets here, or click upload above to add images into your editing library.
                </p>
                <Button
                  onClick={() => inputRef.current?.click()}
                  variant="outline"
                  className="mt-4 gap-2 ring-1 ring-border/40"
                >
                  <Upload className="h-4 w-4" /> Upload photos
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {filteredTiles.map((tile) => {
                  const isSel = tile.id ? selected.includes(tile.id) : false;
                  return (
                    <div
                      key={tile.key}
                      onClick={() => tile.id && setDetailTile(tile)}
                      className={`group relative flex aspect-square flex-col overflow-hidden rounded-xl bg-background cursor-pointer transition-all ${
                        isSel
                          ? "ring-2 ring-primary"
                          : "ring-1 ring-border/40 hover:ring-primary/50"
                      }`}
                    >
                      {tile.status === "uploading" ? (
                        <div className="relative flex h-full w-full items-center justify-center bg-muted">
                          {tile.localPreview && (
                            <img
                              src={tile.localPreview}
                              alt={tile.name}
                              className="h-full w-full object-cover opacity-40"
                            />
                          )}
                          <div className="absolute flex flex-col items-center gap-1.5 rounded-lg bg-background/80 p-2 text-xs font-medium text-foreground backdrop-blur">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span>Uploading...</span>
                          </div>
                        </div>
                      ) : tile.status === "error" ? (
                        <div className="flex h-full w-full flex-col items-center justify-center p-3 text-center bg-destructive/10 text-destructive">
                          <AlertCircle className="h-6 w-6 mb-1" />
                          <span className="text-xs font-medium">{tile.error || "Failed"}</span>
                        </div>
                      ) : (
                        <>
                          <img
                            src={tile.thumbUrl || tile.previewUrl}
                            alt={tile.name}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 opacity-0 transition-opacity group-hover:opacity-100" />
                          
                          {/* Selection Checkbox */}
                          {tile.id && (
                            <button
                              onClick={(e) => toggleSelect(tile.id!, e)}
                              className={`absolute left-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded border transition-all ${
                                isSel
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-white/40 bg-black/40 text-transparent hover:border-white"
                              }`}
                            >
                              ✓
                            </button>
                          )}

                          {/* Info overlay */}
                          <div className="absolute bottom-0 left-0 right-0 p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <p className="truncate font-mono text-xs font-medium text-white">
                              {tile.name}
                            </p>
                            <p className="text-[10px] text-white/70">
                              {formatBytes(tile.size)}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-over Detail Drawer */}
      {detailTile && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="flex w-full max-w-md flex-col bg-card shadow-2xl ring-1 ring-border/40">
            <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
              <h3 className="font-semibold text-foreground truncate">
                {detailTile.name}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDetailTile(null)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Image Preview */}
              <div className="overflow-hidden rounded-xl bg-background ring-1 ring-border/40">
                <img
                  src={detailTile.previewUrl || detailTile.thumbUrl}
                  alt={detailTile.name}
                  className="w-full object-contain max-h-[300px]"
                />
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-background p-3 ring-1 ring-border/40">
                  <span className="text-muted-foreground">Size</span>
                  <p className="mt-1 font-mono font-medium text-foreground">
                    {formatBytes(detailTile.size)}
                  </p>
                </div>
                <div className="rounded-lg bg-background p-3 ring-1 ring-border/40">
                  <span className="text-muted-foreground">Folder</span>
                  <p className="mt-1 font-medium text-foreground truncate">
                    {folders.find((f) => f.id === detailTile.folderId)?.name ?? "Root"}
                  </p>
                </div>
              </div>

              {/* Action Button */}
              {detailTile.id && (
                <Button
                  onClick={() => handleStartSession(detailTile.id!)}
                  disabled={starting}
                  className="w-full gap-2 bg-primary text-primary-foreground font-medium py-5"
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Start New Session From Photo
                </Button>
              )}

              {/* Sessions spawned from this image */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <h4 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    Sessions Spawned ({detailSessions.length})
                  </h4>
                </div>

                {loadingSessions ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : detailSessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 italic">
                    No sessions created from this photo yet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {detailSessions.map((session) => (
                      <a
                        key={session.sessionUuid}
                        href={`/sessions/${session.sessionUuid}`}
                        className="flex items-center justify-between rounded-lg bg-background p-3 text-xs ring-1 ring-border/40 transition-colors hover:ring-primary/50"
                      >
                        <div className="flex flex-col gap-0.5 truncate pr-2">
                          <span className="font-medium text-foreground truncate">
                            {session.title || session.sessionUuid.slice(0, 8)}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            Via {session.createdVia.toUpperCase()} &bull; {new Date(session.lastActivityAt).toLocaleDateString()}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] uppercase font-mono"
                        >
                          {session.status}
                        </Badge>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="bg-card text-foreground ring-1 ring-border/40">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-xs font-medium text-muted-foreground">
              Folder Name
            </label>
            <Input
              type="text"
              placeholder="e.g. Living Room Redesign"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="mt-1.5 bg-background ring-1 ring-border/40"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFolder} className="bg-primary text-primary-foreground">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Images Modal */}
      <Dialog open={moveModalOpen} onOpenChange={setMoveModalOpen}>
        <DialogContent className="bg-card text-foreground ring-1 ring-border/40">
          <DialogHeader>
            <DialogTitle>Move {selected.length} Image(s)</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Select Destination Folder
            </label>
            <button
              onClick={() => setTargetMoveFolder(null)}
              className={`w-full flex items-center justify-between rounded-lg p-3 text-sm ring-1 ring-border/40 ${
                targetMoveFolder === null ? "bg-muted font-medium" : "bg-background"
              }`}
            >
              <span>Root (No Folder)</span>
            </button>
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setTargetMoveFolder(f.id)}
                className={`w-full flex items-center justify-between rounded-lg p-3 text-sm ring-1 ring-border/40 ${
                  targetMoveFolder === f.id ? "bg-muted font-medium" : "bg-background"
                }`}
              >
                <span>{f.name}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMoveModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMoveSelected} className="bg-primary text-primary-foreground">
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
