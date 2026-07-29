/**
 * @fileoverview Role-tagged reference-image multi-select for the compose pane.
 * Adds ADDITIONAL references (beyond the base image) to a multi-reference edit,
 * each tagged object (a subject/material to reproduce) or style (a look to
 * emulate). Assembly order is object then style. Sources: the session's library,
 * or a pasted image URL / Cloudflare Images URL ingested on the fly.
 *
 * Emits `references: [{ imageId, role }]`, consumed by submit_edit.
 */

import { useEffect, useState } from "react";
import { ImagePlus, Link2, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGet, apiSend } from "@/lib/api";

export type ReferenceRole = "object" | "style";
export interface ReferenceItem {
  imageId: string;
  role: ReferenceRole;
  thumbUrl: string;
  label?: string | null;
}

interface LibraryImage {
  id: string;
  deliveryUrl: string;
  originalFilename?: string | null;
  description?: string | null;
  flaggedBadAt?: number | null;
}

/** Swap the trailing delivery-URL variant segment (never append). */
function variant(deliveryUrl: string, name: string): string {
  return deliveryUrl ? deliveryUrl.replace(/\/[^/]+$/, `/${name}`) : "";
}

interface ReferencePickerProps {
  value: ReferenceItem[];
  onChange: (refs: ReferenceItem[]) => void;
  /** Total cap for the selected model (base excluded), e.g. Pro = 14. */
  maxTotal: number;
}

export function ReferencePicker({ value, onChange, maxTotal }: ReferencePickerProps) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryImage[]>([]);
  const [url, setUrl] = useState("");
  const [urlDesc, setUrlDesc] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiGet<{ images: LibraryImage[] }>("library/images")
      .then((res) => setLibrary(res.images ?? []))
      .catch(() => setLibrary([]));
  }, [open]);

  const selectedIds = new Set(value.map((r) => r.imageId));

  const add = (img: { id: string; deliveryUrl: string; label?: string | null }) => {
    if (selectedIds.has(img.id)) return;
    if (value.length >= maxTotal) {
      setError(`This model accepts at most ${maxTotal} reference images.`);
      return;
    }
    onChange([
      ...value,
      { imageId: img.id, role: "object", thumbUrl: variant(img.deliveryUrl, "thumb"), label: img.label },
    ]);
  };

  const remove = (imageId: string) => onChange(value.filter((r) => r.imageId !== imageId));
  const setRole = (imageId: string, role: ReferenceRole) =>
    onChange(value.map((r) => (r.imageId === imageId ? { ...r, role } : r)));

  const ingestUrl = async () => {
    if (!url.trim()) return;
    setIngesting(true);
    setError(null);
    try {
      const isCf = url.includes("imagedelivery.net");
      const row = await apiSend<LibraryImage>("POST", "library/register", {
        [isCf ? "cfImagesUrl" : "imageUrl"]: url.trim(),
        description: urlDesc.trim() || null,
      });
      add({ id: row.id, deliveryUrl: row.deliveryUrl, label: urlDesc.trim() || row.originalFilename });
      setUrl("");
      setUrlDesc("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register image");
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="font-mono text-muted-foreground flex items-center gap-1 text-xs">
        <ImagePlus className="h-3.5 w-3.5" /> Reference Images
        {value.length > 0 && <span className="text-muted-foreground/60">({value.length})</span>}
      </label>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((r) => (
            <div
              key={r.imageId}
              className="flex items-center gap-2 rounded-lg bg-background px-2 py-1.5 ring-1 ring-border/40"
            >
              {r.thumbUrl && (
                <img src={r.thumbUrl} alt="" className="h-9 w-9 rounded object-cover" />
              )}
              <select
                value={r.role}
                onChange={(e) => setRole(r.imageId, e.target.value as ReferenceRole)}
                className="rounded bg-card px-1.5 py-1 font-mono text-[11px] text-foreground ring-1 ring-border/40 focus:outline-none"
                aria-label="reference role"
              >
                <option value="object">object</option>
                <option value="style">style</option>
              </select>
              <button
                type="button"
                onClick={() => remove(r.imageId)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="remove reference"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full gap-2 justify-start ring-1 ring-border/40 text-xs font-mono text-muted-foreground hover:text-foreground"
      >
        <ImagePlus className="h-3.5 w-3.5 text-primary" /> Add reference image
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl bg-card text-foreground ring-1 ring-border/40">
          <DialogHeader>
            <DialogTitle className="text-sm">Add reference images</DialogTitle>
          </DialogHeader>

          {error && (
            <div className="rounded-lg bg-destructive/15 p-2 text-xs text-destructive">{error}</div>
          )}

          {/* Ingest from a URL (Cloudflare Images or any http(s) image). */}
          <div className="space-y-2 border-b border-border/40 pb-3">
            <label className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" /> Paste an image URL
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://imagedelivery.net/…/public  or  any image URL"
              className="w-full rounded-lg bg-background p-2 font-mono text-xs ring-1 ring-border/40 focus:outline-none"
            />
            <div className="flex gap-2">
              <input
                value={urlDesc}
                onChange={(e) => setUrlDesc(e.target.value)}
                placeholder="description (e.g. Calacatta Viola slab)"
                className="flex-1 rounded-lg bg-background p-2 font-mono text-xs ring-1 ring-border/40 focus:outline-none"
              />
              <Button type="button" onClick={ingestUrl} disabled={ingesting || !url.trim()} className="gap-1 text-xs">
                {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </Button>
            </div>
          </div>

          {/* Library picker. */}
          <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {library.map((img) => {
              const selected = selectedIds.has(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => (selected ? remove(img.id) : add(img))}
                  className={`relative aspect-square overflow-hidden rounded-lg ring-1 transition ${
                    selected ? "ring-2 ring-primary" : "ring-border/40 hover:ring-primary/60"
                  } ${img.flaggedBadAt ? "opacity-40" : ""}`}
                  title={img.description ?? img.originalFilename ?? img.id}
                >
                  <img src={variant(img.deliveryUrl, "thumb")} alt="" className="h-full w-full object-cover" />
                  {selected && (
                    <span className="absolute inset-x-0 bottom-0 bg-primary/80 py-0.5 text-center text-[10px] font-mono text-primary-foreground">
                      selected
                    </span>
                  )}
                </button>
              );
            })}
            {library.length === 0 && (
              <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
                No library images yet — paste a URL above.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={() => setOpen(false)} className="text-xs">
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
