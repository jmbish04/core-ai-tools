/**
 * @fileoverview The project onboarding wizard — six steps on ReUI's `stepper`.
 *
 * What it produces is a folder: a project IS a folder with settings, which is
 * why there is no separate projects table. The settings collected here become
 * that folder's own, and anything left blank keeps inheriting from the parent —
 * the same rule the organiser shows provenance for.
 *
 * Nothing is written until the last step. A half-filled project in D1 would
 * appear in the folder tree as a real folder that isn't one, so the draft lives
 * client-side until the user commits (see ./types.ts). That constraint is also
 * why the copilot proposes rather than acts — see ./OnboardingCopilot.tsx.
 *
 * The stepper nav is hidden below `sm`: six items do not fit in 375px, and the
 * ReUI nav does not wrap, so the last two ran off the edge. Narrow screens get a
 * "Step n of 6 — Title" line instead, which is the same information.
 */

import { useEffect, useMemo, useState } from "react";

import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTrigger,
} from "@/components/reui/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AssetPickerDialog } from "@/components/assets/AssetPickerDialog";
import { thumbOf } from "@/components/assets/types";
import type { AssetRow } from "@/components/assets/types";
import { apiGet, apiSend } from "@/lib/api";
import { LIBRARY_FOLDERS_PATH, assetPlacePath } from "@/lib/endpoints";
import type { FolderRow } from "@/components/folders/types";
import { StagedImageList } from "./StagedImageList";
import { OnboardingCopilot } from "./OnboardingCopilot";
import type { SettingsProposal } from "./OnboardingCopilot";
import { CloneSettingsPicker } from "./CloneSettingsPicker";
import { UnresolvedCloneError, applyProposalToDraft, settingsToWrite } from "./settings";
import {
  EMPTY_DRAFT,
  SCENARIOS,
  USE_CASES,
  clearDraft,
  loadDraft,
  saveDraft,
} from "./types";
import type { OnboardingDraft } from "./types";

const STEPS = [
  { step: 1, title: "Project", hint: "Name and where it lives" },
  { step: 2, title: "Assets", hint: "Reuse what you already have" },
  { step: 3, title: "Images", hint: "Upload and say what each one is for" },
  { step: 4, title: "Intent", hint: "What the models should do" },
  { step: 5, title: "Copilot", hint: "Settle it by talking" },
  { step: 6, title: "Review", hint: "Check and create" },
];

export function ProjectWizard() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  /** Set when creation failed AFTER the folder existed, so the error can link to it. */
  const [createdFolderId, setCreatedFolderId] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadDraft();
    if (saved) {
      setDraft(saved);
      setRestored(true);
    }
    void apiGet<{ folders: FolderRow[] }>(LIBRARY_FOLDERS_PATH)
      .then((r) => setFolders(r.folders))
      .catch(() => setFolders([]));
  }, []);

  const patch = (next: Partial<OnboardingDraft>) => setDraft((d) => ({ ...d, ...next }));

  const parentName = useMemo(
    () => folders.find((f) => f.id === draft.parentFolderId)?.name ?? "Library root",
    [folders, draft.parentFolderId],
  );

  const source = draft.settingsSource;
  const cloneSourceId = source.kind === "clone" ? source.folderId : null;
  const cloneSourceName = folders.find((f) => f.id === cloneSourceId)?.name ?? null;
  /** While a clone source is chosen, all three settings come from it. */
  const cloning = source.kind === "clone";

  // Step 4 asks for a use case, and a clone supplies one — so requiring the
  // tiles while cloning is a dead end. It used to be worse than a dead end:
  // clicking a tile set `settingsSource: custom`, which silently discarded the
  // clone the user had just chosen, and the tiles were mandatory to advance. The
  // two ways of answering the same question now exclude each other explicitly.
  const canAdvance =
    step === 1
      ? draft.name.trim().length > 0
      : step === 4
        ? cloning || draft.useCase.length > 0
        : true;

  /**
   * Apply a copilot proposal to the draft.
   *
   * `null` in a proposal means "clear this and inherit again", which in the
   * draft is the empty string — the create step turns an empty string back into
   * `null`. An absent key is left alone, which is why each field is checked with
   * `in` rather than for truthiness.
   */
  const applyProposal = (proposal: SettingsProposal) =>
    setDraft((d) => applyProposalToDraft(d, proposal));

  /**
   * Create the project: one folder, then its settings, then move every staged
   * image and chosen asset into it. Settings go in a single PUT so a partly
   * applied project cannot exist.
   */
  const create = async () => {
    // Checked BEFORE the folder is created: an unresolved clone is the user's
    // mistake to correct, not a half-made project to clean up.
    try {
      settingsToWrite(draft, cloneSourceName);
    } catch (err) {
      if (err instanceof UnresolvedCloneError) {
        setError(err.message);
        return;
      }
      throw err;
    }

    setCreating(true);
    setError(null);
    let folderId: string | null = null;
    try {
      const folder = await apiSend<FolderRow>("POST", LIBRARY_FOLDERS_PATH, {
        name: draft.name.trim(),
        parentFolderId: draft.parentFolderId,
      });
      folderId = folder.id;

      const settings = settingsToWrite(draft, cloneSourceName);

      if (settings) {
        await apiSend("PUT", `${LIBRARY_FOLDERS_PATH}/${folder.id}/settings`, settings);
      }

      // Chosen assets are COPIED into the project (the asset itself stays put),
      // and staged uploads are moved, each keeping the role the user gave it.
      for (const asset of draft.assets) {
        await apiSend("POST", assetPlacePath(asset.id), { folderId: folder.id });
      }
      for (const img of draft.images) {
        await apiSend("POST", `library/images/${img.imageId}/move`, { folderId: folder.id });
        if (img.role || img.note) {
          await apiSend("PATCH", `library/images/${img.imageId}`, {
            role: img.role,
            usageInstructions: img.note.trim() || null,
          });
        }
      }

      clearDraft();
      window.location.href = `/folders?folder=${folder.id}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the project.";
      // The folder is created first, so a later failure leaves a real project
      // behind. Saying only "could not create" invites a retry that makes a
      // second one — send the user to what exists instead.
      setError(
        folderId
          ? `${message} The project folder was created, but filling it did not finish. Open it and add what is missing rather than creating it again.`
          : message,
      );
      setCreatedFolderId(folderId);
      setCreating(false);
    }
  };

  const current = STEPS[step - 1];

  return (
    <Stepper value={step} onValueChange={setStep} className="space-y-6">
      {/* Six items do not fit at 375; the nav does not wrap, so below sm it is
          replaced by the same information on one line. */}
      <p className="text-muted-foreground text-sm sm:hidden">
        Step {step} of {STEPS.length} —{" "}
        <span className="text-foreground font-medium">{current.title}</span>
      </p>

      <StepperNav className="hidden sm:flex">
        {STEPS.map((s, i) => (
          <StepperItem key={s.step} step={s.step} className="flex-1">
            <StepperTrigger className="flex-col items-start gap-1">
              <span className="flex items-center gap-2">
                <StepperIndicator>{s.step}</StepperIndicator>
                <span className="text-foreground text-sm font-medium">{s.title}</span>
              </span>
              <span className="text-muted-foreground hidden text-xs lg:block">{s.hint}</span>
            </StepperTrigger>
            {i < STEPS.length - 1 ? <StepperSeparator /> : null}
          </StepperItem>
        ))}
      </StepperNav>

      {restored ? (
        <p className="text-muted-foreground text-xs">
          Picked up where you left off.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              clearDraft();
              setDraft(EMPTY_DRAFT);
              setCreatedFolderId(null);
              setRestored(false);
              setStep(1);
            }}
          >
            Start over
          </button>
        </p>
      ) : null}

      <StepperPanel className="bg-card border-border rounded-lg border p-4 sm:p-6">
        <StepperContent value={1} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              autoFocus
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Kitchen remodel — island options"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-parent">Where it lives</Label>
            <select
              id="project-parent"
              value={draft.parentFolderId ?? ""}
              onChange={(e) => patch({ parentFolderId: e.target.value || null })}
              className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="">Library root</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              A project is a folder. Put it inside another to inherit that folder's prompt and
              context.
            </p>
          </div>
        </StepperContent>

        <StepperContent value={2} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-foreground text-sm font-medium">Assets</h3>
              <p className="text-muted-foreground mt-1 max-w-prose text-sm">
                Reuse images you have already saved. A copy goes into this project and stays
                traceable back to the asset.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
              Choose assets
            </Button>
          </div>
          {draft.assets.length === 0 ? (
            <p className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-center text-sm">
              No assets chosen. This step is optional.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {draft.assets.map((a: AssetRow) => (
                <li key={a.id} className="border-border overflow-hidden rounded-md border">
                  <img
                    src={thumbOf(a.image.deliveryUrl)}
                    alt={a.name}
                    className="aspect-square w-full object-cover"
                  />
                  <p className="truncate p-2 text-xs">{a.name}</p>
                </li>
              ))}
            </ul>
          )}
          <AssetPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            initialSelection={draft.assets.map((a) => a.id)}
            onConfirm={(assets) => patch({ assets })}
          />
        </StepperContent>

        <StepperContent value={3} className="space-y-4">
          <div>
            <h3 className="text-foreground text-sm font-medium">Images</h3>
            <p className="text-muted-foreground mt-1 max-w-prose text-sm">
              Upload the pictures this project works from, then say what each one is for. The
              base image is the thing being edited; references and injects are what it should
              borrow from — a kitchen island, a fabric, a fixture.
            </p>
          </div>
          <StagedImageList images={draft.images} onChange={(images) => patch({ images })} />
        </StepperContent>

        <StepperContent value={4} className="space-y-6">
          <fieldset className="space-y-2" disabled={cloning}>
            <legend className="text-foreground text-sm font-medium">What should happen here?</legend>
            <div className={`grid gap-2 sm:grid-cols-2 ${cloning ? "opacity-50" : ""}`}>
              {USE_CASES.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => patch({ useCase: u.id, settingsSource: { kind: "custom" } })}
                  aria-pressed={!cloning && draft.useCase === u.id}
                  className={`border-border rounded-md border p-3 text-left transition-colors ${
                    !cloning && draft.useCase === u.id
                      ? "border-primary bg-accent/50"
                      : "hover:bg-accent/40"
                  }`}
                >
                  <span className="text-foreground block text-sm font-medium">{u.label}</span>
                  <span className="text-muted-foreground block text-xs">{u.hint}</span>
                </button>
              ))}
            </div>
            {cloning ? (
              <p className="text-muted-foreground text-xs">
                The use case comes from {cloneSourceName ?? "the project you are cloning"}. Clear
                the source below to choose one here.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-foreground text-sm font-medium">What kind of work is it?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => patch({ scenario: s.id })}
                  aria-pressed={draft.scenario === s.id}
                  className={`border-border rounded-md border p-3 text-left transition-colors ${
                    draft.scenario === s.id ? "border-primary bg-accent/50" : "hover:bg-accent/40"
                  }`}
                >
                  <span className="text-foreground block text-sm font-medium">{s.label}</span>
                  <span className="text-muted-foreground block text-xs">{s.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="border-border space-y-4 border-t pt-5">
            <CloneSettingsPicker
              folders={folders}
              sourceFolderId={cloneSourceId}
              onSelect={(folderId) =>
                patch({
                  settingsSource: folderId
                    ? { kind: "clone", folderId, settings: null }
                    : { kind: "inherit" },
                })
              }
              // The resolved settings go INTO the draft, so they survive a save
              // and restore and `create()` has everything it needs in one place.
              onResolved={(settings) =>
                setDraft((d) =>
                  d.settingsSource.kind === "clone"
                    ? { ...d, settingsSource: { ...d.settingsSource, settings } }
                    : d,
                )
              }
            />
          </div>

          {cloning ? (
            <p className="text-muted-foreground text-xs">
              Cloning from {cloneSourceName ?? "another project"}. Everything above and below is
              ignored while a source is chosen — clear it to set your own.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="wizard-prompt">Default prompt (optional)</Label>
            <Textarea
              id="wizard-prompt"
              rows={2}
              disabled={!!cloneSourceId}
              value={draft.defaultPrompt}
              onChange={(e) =>
                patch({ defaultPrompt: e.target.value, settingsSource: { kind: "custom" } })
              }
              placeholder="photoreal, keep the existing cabinetry and floor"
            />
            <p className="text-muted-foreground text-xs">Leave blank to inherit from {parentName}.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wizard-context">Context (optional)</Label>
            <Textarea
              id="wizard-context"
              rows={3}
              disabled={!!cloneSourceId}
              value={draft.contextText}
              onChange={(e) =>
                patch({ contextText: e.target.value, settingsSource: { kind: "custom" } })
              }
              placeholder="A 1920s kitchen; the client wants to keep the original windows."
            />
          </div>
        </StepperContent>

        <StepperContent value={5} className="space-y-4">
          <OnboardingCopilot draft={draft} parentFolderName={parentName} onApply={applyProposal} />
        </StepperContent>

        <StepperContent value={6} className="space-y-5">
          <div>
            <h3 className="text-foreground text-sm font-medium">Review</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Creating this makes the folder, applies the settings, and files every image and
              asset you chose.
            </p>
          </div>
          <dl className="divide-border divide-y text-sm">
            {(
              [
                ["Name", draft.name || "—"],
                ["Lives in", parentName],
                ["Assets", `${draft.assets.length}`],
                ["Images", `${draft.images.length}`],
                [
                  "Settings",
                  // A clone whose settings never resolved says so here rather
                  // than claiming a clone that `create()` would refuse to write.
                  source.kind === "clone"
                    ? source.settings
                      ? `Cloned from ${cloneSourceName ?? "another project"}`
                      : `Could not read ${cloneSourceName ?? "that project"}'s settings — go back and pick again`
                    : source.kind === "custom"
                      ? "Set on this project"
                      : `Inherited from ${parentName}`,
                ],
                [
                  "Use case",
                  source.kind === "clone"
                    ? (source.settings?.useCase ?? "—")
                    : (USE_CASES.find((u) => u.id === draft.useCase)?.label ?? "—"),
                ],
                ["Scenario", SCENARIOS.find((s) => s.id === draft.scenario)?.label ?? "—"],
                [
                  "Prompt",
                  source.kind === "clone"
                    ? (source.settings?.defaultPrompt ?? "—")
                    : draft.defaultPrompt.trim() || `Inherited from ${parentName}`,
                ],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
                <dt className="text-muted-foreground shrink-0 sm:w-32">{k}</dt>
                <dd className="text-foreground min-w-0 flex-1 break-words">{v}</dd>
              </div>
            ))}
          </dl>

          {error ? (
            <div className="space-y-2">
              <p className="text-destructive-foreground text-sm">{error}</p>
              {createdFolderId ? (
                <a
                  href={`/folders?folder=${createdFolderId}`}
                  className="text-foreground text-sm font-medium underline underline-offset-4"
                >
                  Open the project that was created &rarr;
                </a>
              ) : null}
            </div>
          ) : null}
        </StepperContent>
      </StepperPanel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
        >
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              saveDraft(draft);
              setRestored(true);
            }}
          >
            Save draft
          </Button>
          {step < STEPS.length ? (
            <Button size="sm" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button size="sm" disabled={creating || !draft.name.trim()} onClick={() => void create()}>
              {creating ? "Creating…" : "Create project"}
            </Button>
          )}
        </div>
      </div>
    </Stepper>
  );
}
