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
