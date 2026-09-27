/**
 * @fileoverview The hero at the top of a folder — what this project is, and what
 * every edit inside it starts from.
 *
 * It exists because the settings are invisible otherwise. A user looking at a
 * folder full of kitchen photos has no way to know a prompt is being prepended
 * to every generation, or that it came from two folders up. This says so, on the
 * screen where the work happens, with provenance — the same rule the settings
 * card follows, surfaced where it is first needed rather than only where it is
 * edited.
 *
 * The backdrop is the folder's own newest images, through the shell's hero band
 * contract (exact Cloudflare Images URLs). A folder with nothing in it gets no
 * backdrop rather than stock photography, because a picture that isn't yours
 * implies content that isn't there.
 */

import { FolderIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { FolderRow, ImageRow, ResolvedFolderSettings, ResolvedSetting } from "./types";

/** Cloudflare Images URLs end in a variant; swap the last segment, never append. */
function preview(deliveryUrl: string): string {
  return deliveryUrl.replace(/\/[^/]+$/, "/preview");
}

/** One setting, with where it came from — or an honest blank. */
function SettingLine({
  label,
  setting,
  folders,
}: {
  label: string;
  setting: ResolvedSetting<string> | undefined;
  folders: FolderRow[];
}) {
  if (!setting || setting.value === null) return null;
  const from = folders.find((f) => f.id === setting.fromFolderId);
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
      <dd className="text-foreground mt-0.5 text-sm break-words">
        {setting.value}
        {setting.inherited ? (
          <span className="text-muted-foreground ml-2 text-xs">
            inherited from {from?.name ?? "a parent folder"}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export function ProjectHero({
  folder,
  folders,
  settings,
  images,
}: {
  folder: FolderRow;
  folders: FolderRow[];
  settings: ResolvedFolderSettings | null;
  images: ImageRow[] | null;
}) {
  const backdrop = (images ?? []).slice(0, 3);
  const hasSettings =
    settings !== null &&
    [settings.defaultPrompt, settings.contextText, settings.useCase].some((s) => s.value !== null);

  return (
    <section className="border-border bg-card relative overflow-hidden rounded-lg border">
      {backdrop.length > 0 ? (
        <div aria-hidden="true" className="absolute inset-0 flex opacity-20">
          {backdrop.map((img) => (
            <img
              key={img.id}
              src={preview(img.deliveryUrl)}
              alt=""
              className="h-full flex-1 object-cover"
            />
          ))}
          <div className="from-card absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />
        </div>
      ) : null}

      <div className="relative space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <FolderIcon className="text-muted-foreground size-4" aria-hidden="true" />
          <h2 className="text-foreground text-base font-semibold">{folder.name}</h2>
          {settings?.useCase.value ? (
            <Badge variant="secondary" className="text-[11px]">
              {settings.useCase.value}
            </Badge>
          ) : null}
          <span className="text-muted-foreground text-xs">
            {images === null
              ? "…"
              : `${images.length} image${images.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {hasSettings ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <SettingLine label="Default prompt" setting={settings?.defaultPrompt} folders={folders} />
            <SettingLine label="Context" setting={settings?.contextText} folders={folders} />
          </dl>
        ) : (
          <p className="text-muted-foreground max-w-prose text-sm">
            No prompt or context is in force here, and nothing above sets one. Every edit
            starts from whatever you type at the time.
          </p>
        )}
      </div>
    </section>
  );
}
