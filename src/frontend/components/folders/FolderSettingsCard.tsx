/**
 * @fileoverview Folder settings, with inheritance made visible.
 *
 * The whole point of this panel is the provenance. A prompt that arrived from
 * three folders up looks identical to one set here unless the UI says otherwise,
 * and a user who cannot tell will "fix" the wrong folder. So every field states
 * whether it is set here or inherited, and from which folder.
 *
 * Clearing a field sends `null`, which is what re-enables inheritance — the API
 * distinguishes absent (leave alone) from null (clear). An empty string would
 * store an empty value and quietly break the chain, so the save path converts
 * blanks to null deliberately.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiSend } from "@/lib/api";
import type { FolderRow, ResolvedFolderSettings, ResolvedSetting } from "./types";

/** "Set here" / "Inherited from X" / "Not set anywhere above". */
function Provenance({
  setting,
  folders,
}: {
  setting: ResolvedSetting<unknown> | undefined;
  folders: FolderRow[];
}) {
  if (!setting || setting.value === null) {
    return <span className="text-muted-foreground text-[11px]">Not set — nothing above sets it</span>;
  }
  if (!setting.inherited) {
    return <span className="text-[11px] text-emerald-500">Set on this folder</span>;
  }
  const from = folders.find((f) => f.id === setting.fromFolderId);
  return (
    <span className="text-muted-foreground text-[11px]">
      Inherited from {from ? from.name : "a parent folder"}
    </span>
  );
}

export function FolderSettingsCard({
  folderId,
  folders,
  settings,
  onSaved,
}: {
  folderId: string | null;
  folders: FolderRow[];
  settings: ResolvedFolderSettings | null;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [useCase, setUseCase] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the inputs with what is in force, inherited or not: editing then means
  // "make this folder's own", which is the intent behind typing in the box.
  useEffect(() => {
    setPrompt(settings?.defaultPrompt.value ?? "");
    setContext(settings?.contextText.value ?? "");
    setUseCase(settings?.useCase.value ?? "");
    setSaved(false);
  }, [settings]);

  if (!folderId) return null;

  const save = async () => {
    setBusy(true);
    try {
      // Blank means "clear it and inherit again" — null, never "".
      await apiSend("PUT", `library/folders/${folderId}/settings`, {
        defaultPrompt: prompt.trim() || null,
        contextText: context.trim() || null,
        useCase: useCase.trim() || null,
      });
      setSaved(true);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-card border-border rounded-lg border p-5">
      <h2 className="text-foreground text-sm font-semibold">Folder settings</h2>
      <p className="text-muted-foreground mt-1 text-xs">
        Anything left blank is inherited from the nearest folder above that sets it.
      </p>

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="folder-prompt" className="text-xs">
              Default prompt
            </Label>
            <Provenance setting={settings?.defaultPrompt} folders={folders} />
          </div>
          <Textarea
            id="folder-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="photoreal kitchen, keep cabinetry"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="folder-context" className="text-xs">
              Context
            </Label>
            <Provenance setting={settings?.contextText} folders={folders} />
          </div>
          <Textarea
            id="folder-context"
            rows={3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="What this folder is for, and anything a model should assume."
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="folder-usecase" className="text-xs">
              Use case
            </Label>
            <Provenance setting={settings?.useCase} folders={folders} />
          </div>
          <Input
            id="folder-usecase"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            placeholder="home-remodel"
          />
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save settings"}
          </Button>
          {saved ? <span className="text-xs text-emerald-500">Saved</span> : null}
        </div>
      </div>
    </section>
  );
}
