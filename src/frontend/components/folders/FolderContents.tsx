/**
 * @fileoverview The selected folder's images, and the ways to add one.
 *
 * NO folder name in this header. `ProjectHero` sits directly above and is the
 * thing that names the folder — printing it again here read as two panels about
 * two different folders at narrow widths, where the hero's own name scrolls out
 * of view first. This header carries the count, the realtime state, and the
 * actions.
 *
 * Every card carries the image's short public id with copy-to-clipboard, because
 * that handle is the thing a user pastes into a prompt and the same handle an
 * agent resolves with `get_image_by_public_id`. A card with no id would make the
 * two halves of this product speak different languages.
 */

import { CheckIcon, CopyIcon, ImageIcon, ImagesIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetPickerDialog } from "@/components/assets/AssetPickerDialog";
import type { AssetRow } from "@/components/assets/types";
import { apiSend } from "@/lib/api";
import { assetPlacePath } from "@/lib/endpoints";
import type { FolderRow, ImageRow } from "./types";

/** Bytes as a human size. Kept local and tiny — one call site. */
function fileSize(bytes: number | null): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Cloudflare Images delivery URLs end in a variant; swap it, never append. */
function thumbOf(deliveryUrl: string): string {
  return deliveryUrl.replace(/\/[^/]+$/, "/thumb");
}

function CopyId({ publicId }: { publicId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground h-6 max-w-full gap-1 px-1.5 font-mono text-[11px]"
      onClick={async () => {
        await navigator.clipboard.writeText(publicId);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <CheckIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{publicId}</span>
      <span className="sr-only">Copy image id</span>
    </Button>
  );
}

export function FolderContents({
  folder,
  images,
  live,
  error,
  onChanged,
}: {
  folder: FolderRow | null;
  images: ImageRow[] | null;
  /** Whether the realtime channel is currently connected. */
  live: boolean;
  /** Set when the images could not be read. An error is NOT an empty folder. */
  error?: string | null;
  onChanged: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  if (!folder) {
    return (
      <section className="bg-card border-border flex min-h-[18rem] items-center justify-center rounded-lg border p-8">
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          Pick a folder to see its images, the prompt and context in force there, and what it
          inherits from its parents.
        </p>
      </section>
    );
  }

  /**
   * Place a copy of each chosen asset into this folder. Sequential on purpose:
   * the folder's realtime channel allocates one `seq` per event, and a user
   * watching the grid fill in order reads it as the work happening.
   */
  const placeAssets = async (assets: AssetRow[]) => {
    setPlacing(true);
    setPlaceError(null);
    const failed: string[] = [];
    for (const asset of assets) {
      try {
        await apiSend("POST", assetPlacePath(asset.id), { folderId: folder.id });
      } catch {
        failed.push(asset.name);
      }
    }
    setPlacing(false);
    // Report per-asset, not "something went wrong": with a multi-select, which
    // ones landed is the only useful part of the answer.
    if (failed.length > 0) {
      setPlaceError(
        `Could not add ${failed.join(", ")}. ${assets.length - failed.length} of ${assets.length} added.`,
      );
    }
    onChanged();
  };

  const count = images?.length ?? 0;

  return (
    <section className="bg-card border-border rounded-lg border">
      <header className="border-border flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="text-foreground text-sm font-semibold">Images</h3>
          <p className="text-muted-foreground text-xs">
            {error ? "Unavailable" : images === null ? "Loading…" : `${count} in this folder`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Honest about the channel: a dot that is always green would be the
              kind of instrument that cannot fail. */}
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            />
            <span className="hidden sm:inline">{live ? "Live" : "Reconnecting"}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={placing}
            onClick={() => setPickerOpen(true)}
            className="gap-1.5"
          >
            <ImagesIcon className="size-3.5" aria-hidden="true" />
            {placing ? "Adding…" : "Add from assets"}
          </Button>
        </div>
      </header>

      {placeError ? (
        <p className="text-destructive-foreground border-border border-b px-4 py-2 text-xs sm:px-5">
          {placeError}
        </p>
      ) : null}

      {error ? (
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <p className="text-foreground text-sm font-medium">Could not load this folder's images</p>
          <p className="text-muted-foreground max-w-sm text-sm">{error}</p>
        </div>
      ) : images === null ? (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-md" />
          ))}
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
          <ImageIcon className="text-muted-foreground size-6" aria-hidden="true" />
          <div>
            <p className="text-foreground text-sm font-medium">No images in this folder</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Add one from your assets, or upload one, to start a session from it.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            Add from assets
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5 2xl:grid-cols-4">
          {images.map((img) => (
            <li key={img.id} className="border-border bg-background overflow-hidden rounded-md border">
              <img
                src={thumbOf(img.deliveryUrl)}
                alt={img.title ?? img.description ?? "Library image"}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              <div className="min-w-0 space-y-1.5 p-2.5">
                <p className="text-foreground truncate text-sm font-medium">
                  {img.title ?? "Untitled"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {img.role ? (
                    <Badge variant="secondary" className="text-[11px]">
                      {img.role}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-[11px]">
                    {img.kind}
                  </Badge>
                  <span className="text-muted-foreground text-[11px]">{fileSize(img.bytes)}</span>
                </div>
                {img.publicId ? <CopyId publicId={img.publicId} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title={`Add assets to ${folder.name}`}
        description="A copy of each asset is placed in this folder. The asset itself stays where it is, and anything you make from the copy still traces back to it."
        onConfirm={(assets) => void placeAssets(assets)}
      />
    </section>
  );
}
