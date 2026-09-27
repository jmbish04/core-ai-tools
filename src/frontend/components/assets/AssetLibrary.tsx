/**
 * @fileoverview `/assets` — the reusable source images, and what each one has
 * produced.
 *
 * An asset earns its place by lineage: every image generated or edited from it
 * traces back here, which is what makes "show me everything this kitchen island
 * ever turned into" a single indexed read rather than a walk of the revision
 * tree. The count on each card is that lineage, so it is fetched per asset
 * rather than guessed.
 */

import { useEffect, useState } from "react";
import { ImagesIcon, LayersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import type { AssetIteration, AssetRow } from "./types";
import { thumbOf } from "./types";

export function AssetLibrary() {
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiGet<{ assets: AssetRow[] }>("assets", { limit: 200 });
        if (cancelled) return;
        setAssets(res.assets);
        // Iteration counts, one request per asset. Fine at library size; if this
        // list grows, the API already has listLineageForAssets to batch it.
        const pairs = await Promise.allSettled(
          res.assets.map(async (a) => {
            const r = await apiGet<{ iterations: AssetIteration[] }>(`assets/${a.id}/iterations`);
            return [a.id, r.iterations.length] as const;
          }),
        );
        if (cancelled) return;
        setCounts(
          Object.fromEntries(
            pairs.filter((p) => p.status === "fulfilled").map((p) => (p as PromiseFulfilledResult<readonly [string, number]>).value),
          ),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load assets.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive-foreground rounded-lg border p-6 text-sm">
        {error}
      </div>
    );
  }

  if (assets === null) {
    return (
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i}>
            <Skeleton className="aspect-square w-full rounded-lg" />
          </li>
        ))}
      </ul>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="bg-card border-border flex flex-col items-center gap-3 rounded-lg border px-6 py-16 text-center">
        <ImagesIcon className="text-muted-foreground size-6" aria-hidden="true" />
        <div>
          <p className="text-foreground text-sm font-medium">No assets yet</p>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            An asset is an image you keep coming back to — a room, a garment, a material.
            Promote one from a folder and every edit made from it stays traceable back here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {assets.map((asset) => (
        <li key={asset.id} className="bg-card border-border overflow-hidden rounded-lg border">
          <a href={`/assets/${asset.id}`} className="block">
            <img
              src={thumbOf(asset.image.deliveryUrl)}
              alt={asset.name}
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
            <div className="space-y-2 p-3">
              <p className="text-foreground truncate text-sm font-medium">{asset.name}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="gap-1 text-[11px]">
                  <LayersIcon className="size-3" aria-hidden="true" />
                  {counts[asset.id] ?? 0} iteration{(counts[asset.id] ?? 0) === 1 ? "" : "s"}
                </Badge>
                {asset.promotedFromImageId ? (
                  <Badge variant="outline" className="text-[11px]">
                    promoted
                  </Badge>
                ) : null}
              </div>
              {asset.image.publicId ? (
                <p className="text-muted-foreground truncate font-mono text-[11px]">
                  {asset.image.publicId}
                </p>
              ) : null}
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
