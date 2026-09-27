/**
 * @fileoverview W4.2 — `/assets/[id]`, one asset and everything descended from it.
 *
 * Arrangement retrofitted from the ReUI ecommerce product-detail blocks
 * (`product-detail-1`, `-2`, `-5`): a gallery with a filmstrip on the left, a
 * sticky detail column on the right, and narrative sections underneath. Those
 * blocks are not installed, so the arrangement is rebuilt from primitives that
 * are — no carousel dependency, and the filmstrip is a plain scrollable list.
 *
 * The sections underneath are the asset's descendants GROUPED BY FOLDER, each one
 * an {@link ImageEvolutionTimeline}: a folder is where a line of work lives, so
 * one folder is one story even when its revisions came from several sessions.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, FolderIcon, ImageOffIcon, TriangleAlertIcon } from "lucide-react";

import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/reui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { thumbOf, type AssetIteration, type AssetRow } from "@/components/assets/types";
import type { FolderRow } from "@/components/folders/types";
import { apiGet } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ImageEvolutionTimeline } from "./ImageEvolutionTimeline";

/** Images shown in the gallery: the asset itself first, then what came from it. */
interface Shot {
  id: string;
  deliveryUrl: string;
  label: string;
}

/** One folder's worth of descendants. */
interface FolderGroup {
  folderId: string | null;
  iterations: AssetIteration[];
}

/** Group by folder, ordered by when each folder first received an image. */
function groupByFolder(iterations: AssetIteration[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  for (const row of iterations) {
    const key = row.folderId ?? "\u0000unfiled";
    const group = groups.get(key) ?? { folderId: row.folderId, iterations: [] };
    group.iterations.push(row);
    groups.set(key, group);
  }
  // Sorted rather than trusting insertion order: the API documents oldest-first,
  // but the page should not change shape if that ever stops being true.
  const firstMs = (g: FolderGroup) =>
    Math.min(...g.iterations.map((r) => new Date(r.createdAt).getTime() || 0));
  return [...groups.values()].sort((a, b) => firstMs(a) - firstMs(b));
}

/** A metadata block, rendered only when the asset actually carries it. */
function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="text-foreground text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export interface AssetDetailProps {
  /** The asset id from the route. */
  id: string;
}

/**
 * The asset detail page body.
 *
 * @param id Asset id from `/assets/[id]`.
 * @example <AssetDetail id={id} client:load />
 */
export function AssetDetail({ id }: AssetDetailProps) {
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [iterations, setIterations] = useState<AssetIteration[] | null>(null);
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The asset and its lineage are the page; folder names are decoration, so
        // a folders failure must not take the page down with it.
        const [a, it, f] = await Promise.all([
          apiGet<AssetRow>(`assets/${id}`),
          apiGet<{ iterations: AssetIteration[] }>(`assets/${id}/iterations`, { limit: 1000 }),
          apiGet<{ folders: FolderRow[] }>("library/folders").catch(() => null),
        ]);
        if (cancelled) return;
        setAsset(a);
        setIterations(it.iterations);
        setFolders(f?.folders ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load this asset.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const shots = useMemo<Shot[]>(() => {
    if (!asset) return [];
    return [
      { id: asset.image.id, deliveryUrl: asset.image.deliveryUrl, label: "Source image" },
      ...(iterations ?? []).map((row) => ({
        id: row.libraryImageId,
        deliveryUrl: row.deliveryUrl,
        label: row.revLabel ?? "Original",
      })),
    ];
  }, [asset, iterations]);

  const groups = useMemo(() => groupByFolder(iterations ?? []), [iterations]);

  /**
   * A folder id we cannot name is still a folder. Saying "Unfiled" because the
   * names did not load would turn a failed fetch into a claim about the data.
   */
  const folderName = (folderId: string | null) => {
    if (folderId === null) return "Unfiled";
    const found = folders?.find((f) => f.id === folderId);
    if (found) return found.name;
    return folders === null ? `Folder ${folderId.slice(0, 8)}` : "Deleted folder";
  };

  if (error) {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive-foreground flex items-start gap-3 rounded-lg border p-6 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-2">
          <p>{error}</p>
          <a href="/assets" className="text-foreground inline-flex items-center gap-1 underline">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            Back to assets
          </a>
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="aspect-4/3 w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const hero = shots.find((s) => s.id === shown) ?? shots[0]!;

  return (
    <div className="space-y-10">
      <a
        href="/assets"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
        Assets
      </a>

      {/* Gallery + filmstrip on the left, sticky detail column on the right. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-3">
          <div className="bg-card border-border overflow-hidden rounded-lg border">
            <img
              src={hero.deliveryUrl}
              alt={`${asset.name} — ${hero.label}`}
              className="aspect-4/3 w-full bg-black/20 object-contain"
            />
          </div>
          {shots.length > 1 ? (
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Asset images">
              {shots.map((shot) => (
                <li key={shot.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setShown(shot.id)}
                    aria-current={shot.id === hero.id || undefined}
                    title={shot.label}
                    className={cn(
                      "block overflow-hidden rounded-md border transition-colors",
                      shot.id === hero.id
                        ? "border-primary"
                        : "border-border hover:border-muted-foreground",
                    )}
                  >
                    <img
                      src={thumbOf(shot.deliveryUrl)}
                      alt={shot.label}
                      loading="lazy"
                      className="size-16 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-5 lg:sticky lg:top-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {asset.archivedAt ? <Badge variant="warning-light">archived</Badge> : null}
              {asset.promotedFromImageId ? <Badge variant="outline">promoted</Badge> : null}
              <Badge variant="secondary" className="tabular-nums">
                {iterations === null
                  ? "…"
                  : `${iterations.length} iteration${iterations.length === 1 ? "" : "s"}`}
              </Badge>
            </div>
            <h1 className="text-foreground text-xl font-semibold">{asset.name}</h1>
            <p className="text-muted-foreground text-xs">Added {shortDate(asset.createdAt)}</p>
          </div>

          {asset.image.publicId ? (
            <div className="bg-card border-border space-y-2 rounded-lg border p-3">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Public id
              </p>
              <p className="text-foreground truncate font-mono text-xs">
                {asset.image.publicId}
              </p>
              <CopyButton text={asset.image.publicId} label="Copy public id" />
            </div>
          ) : null}

          <Separator />

          <div className="space-y-4">
            <Detail label="Description" value={asset.description} />
            <Detail label="How to use it" value={asset.usageInstructions} />
            <Detail label="Context" value={asset.contextText} />
            {!asset.description && !asset.usageInstructions && !asset.contextText ? (
              <p className="text-muted-foreground text-sm">
                No description, usage notes or context yet. The folder agent reads these,
                so filling them in changes what it suggests.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <Separator />

      {/* Descendants, one story per folder. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-foreground text-lg font-semibold">What came from this image</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Every image generated or edited from this asset, grouped by the folder it landed
            in. A branch means someone forked the history and took it two ways.
          </p>
        </div>

        {iterations === null ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : groups.length === 0 ? (
          <ImageEvolutionTimeline
            iterations={[]}
            emptyTitle="Nothing made from it yet"
            emptyDescription="This asset is ready to use but nothing has been generated or edited from it. Start a session from it and every edit — including the ones you discard — shows up here."
          />
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <ImageEvolutionTimeline
                key={group.folderId ?? "unfiled"}
                iterations={group.iterations}
                title={folderName(group.folderId)}
                action={
                  group.folderId ? (
                    <a
                      href={`/folders?folder=${group.folderId}`}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                    >
                      <FolderIcon className="size-3.5" aria-hidden="true" />
                      Open folder
                    </a>
                  ) : (
                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                      <ImageOffIcon className="size-3.5" aria-hidden="true" />
                      No folder
                    </span>
                  )
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
