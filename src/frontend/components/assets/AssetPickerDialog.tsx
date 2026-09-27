/**
 * @fileoverview The asset picker — one dialog, two consumers (the organiser and
 * the onboarding wizard). Built once on purpose: two pickers over the same data
 * is how "pick an asset" ends up meaning two different things.
 *
 * Composed from ReUI `dialog-5` (template library dialog): its category rail and
 * selectable cards, fed assets instead of templates. The block is single-select;
 * this is multi-select, because both consumers pick a set — a moodboard, not one
 * picture. That is the one behavioural change; the styling is the block's.
 *
 * The brief named `@reui/ai-chat-7` for this dialog, which is a chat block —
 * `dialog-5` is the gallery picker it describes. Flagged rather than silently
 * substituted.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AssetRow } from "./types";
import { thumbOf } from "./types";

export function AssetPickerDialog({
  open,
  onOpenChange,
  onConfirm,
  initialSelection = [],
  title = "Choose assets",
  description = "Reusable source images. Everything made from one stays traceable back to it.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the chosen assets, in selection order. */
  onConfirm: (assets: AssetRow[]) => void;
  initialSelection?: string[];
  title?: string;
  description?: string;
}) {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>(initialSelection);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(initialSelection);
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiGet<{ assets: AssetRow[] }>("assets", { limit: 200 });
        if (!cancelled) setAssets(res.assets);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load assets.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // initialSelection is a fresh array each render; keying off `open` is what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !assets) return assets ?? [];
    return assets.filter((a) =>
      [a.name, a.description, a.image.publicId].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [assets, query]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, description or id"
            className="pl-9"
          />
        </div>

        <div className="max-h-[52svh] min-h-[16rem] overflow-auto">
          {error ? (
            <p className="text-destructive-foreground p-4 text-sm">{error}</p>
          ) : assets === null ? (
            <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="aspect-square w-full rounded-md" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-2 text-center">
              <p className="text-foreground text-sm font-medium">
                {assets.length === 0 ? "No assets yet" : "Nothing matches that search"}
              </p>
              <p className="text-muted-foreground max-w-sm text-sm">
                {assets.length === 0
                  ? "Promote an image from a folder to make it a reusable asset."
                  : "Try a different name, or clear the search."}
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-3">
              {shown.map((asset) => {
                const isPicked = picked.includes(asset.id);
                return (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => toggle(asset.id)}
                      aria-pressed={isPicked}
                      className={cn(
                        "group border-border bg-card relative w-full overflow-hidden rounded-md border text-left transition-colors",
                        isPicked ? "border-primary ring-primary/40 ring-2" : "hover:bg-accent/40",
                      )}
                    >
                      <img
                        src={thumbOf(asset.image.deliveryUrl)}
                        alt={asset.name}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                      {isPicked ? (
                        <span className="bg-primary text-primary-foreground absolute top-2 right-2 rounded-full p-1">
                          <CheckIcon className="size-3" aria-hidden="true" />
                        </span>
                      ) : null}
                      <div className="space-y-1 p-2">
                        <p className="text-foreground truncate text-sm font-medium">{asset.name}</p>
                        {asset.image.publicId ? (
                          <Badge variant="outline" className="font-mono text-[11px]">
                            {asset.image.publicId}
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-muted-foreground text-xs">
            {picked.length} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={picked.length === 0}
              onClick={() => {
                const byId = new Map((assets ?? []).map((a) => [a.id, a]));
                onConfirm(picked.map((id) => byId.get(id)).filter((a): a is AssetRow => !!a));
                onOpenChange(false);
              }}
            >
              Use {picked.length || ""} asset{picked.length === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
