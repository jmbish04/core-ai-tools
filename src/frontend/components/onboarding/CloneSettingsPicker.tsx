/**
 * @fileoverview "Start from another project's settings."
 *
 * The wizard's draft has carried a `{ kind: "clone"; folderId }` settings source
 * since it was written, and the UI offered the idea in prose, but nothing ever
 * set it and nothing ever read it — picking it did the same thing as inheriting.
 *
 * What it clones is the source folder's RESOLVED settings, not its own columns.
 * A project whose prompt is inherited from two folders up would otherwise clone
 * as blank, which is the opposite of what "start from this one" means — the user
 * is pointing at what they can see on that project's page, and what they can see
 * is the resolved value.
 */

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { folderSettingsPath } from "@/lib/endpoints";
import type { FolderRow, ResolvedFolderSettings } from "@/components/folders/types";
import type { ClonedSettings } from "./types";

export type { ClonedSettings };

export function CloneSettingsPicker({
  folders,
  /** The folder being cloned from, or null when not cloning. */
  sourceFolderId,
  onSelect,
  onResolved,
}: {
  folders: FolderRow[];
  sourceFolderId: string | null;
  /** The user picked (or cleared) a source. Resolution follows asynchronously. */
  onSelect: (folderId: string | null) => void;
  /**
   * The source's resolved settings, once read. Called with `null` when the read
   * failed — cloning must not quietly produce a project with no settings.
   */
  onResolved: (settings: ClonedSettings | null) => void;
}) {
  const [preview, setPreview] = useState<ResolvedFolderSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceFolderId) {
      setPreview(null);
      setError(null);
      onResolved(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void apiGet<ResolvedFolderSettings>(folderSettingsPath(sourceFolderId))
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        setError(null);
        onResolved({
          defaultPrompt: res.defaultPrompt.value,
          contextText: res.contextText.value,
          useCase: res.useCase.value,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Failing to read the source must not silently clone nothing — the user
        // would create a project believing it carried settings it does not.
        setPreview(null);
        setError(err instanceof Error ? err.message : "Could not read that project's settings.");
        onResolved(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // The callbacks are fresh closures each render; the source id is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFolderId]);

  const rows: [string, string | null][] = preview
    ? [
        ["Default prompt", preview.defaultPrompt.value],
        ["Context", preview.contextText.value],
        ["Use case", preview.useCase.value],
      ]
    : [];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="clone-source" className="text-foreground text-sm font-medium">
          Start from another project
        </label>
        <select
          id="clone-source"
          value={sourceFolderId ?? ""}
          onChange={(e) => {
            setPreview(null);
            // Only the id is reported here; the effect reads the settings and
            // reports those, so the draft never holds a half-resolved clone.
            onSelect(e.target.value || null);
          }}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <option value="">Don't clone — inherit, or set your own</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Copies that project's prompt, context and use case onto this one — including
          anything it inherits, because that is what is actually in force there.
        </p>
      </div>

      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : preview ? (
        <dl className="border-border divide-border divide-y rounded-md border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-4">
              <dt className="text-muted-foreground shrink-0 sm:w-32">{label}</dt>
              <dd className="text-foreground min-w-0 flex-1 break-words">
                {value ?? <span className="text-muted-foreground">not set there either</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
