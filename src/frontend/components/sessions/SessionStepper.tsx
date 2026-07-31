/**
 * @fileoverview New-session wizard. Step 1 picks images (skipped when opened
 * from an existing selection), step 2 collects the required name + primary +
 * per-image object/style role, step 3 is optional advanced (approval policy +
 * model override). Primary → session origin; the rest persist as the reference
 * pool.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Images, Loader2, Settings2, Sparkles } from "lucide-react";

import { apiGet, apiSend } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { ImagePickerPanel } from "@/components/library/ImagePickerPanel";

type Role = "object" | "style";
interface ModelEntry {
  id: string;
  display_name?: string;
  capabilities?: { image_to_image?: boolean };
}

const STEPS = [
  { title: "Select images", icon: <Images className="size-4" /> },
  { title: "Details", icon: <Sparkles className="size-4" /> },
  { title: "Advanced", icon: <Settings2 className="size-4" /> },
];

export interface SessionStepperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialImageIds?: string[];
}

export function SessionStepper({ open, onOpenChange, initialImageIds = [] }: SessionStepperProps) {
  const [step, setStep] = useState(1);
  const [ids, setIds] = useState<string[]>(initialImageIds);
  const [primary, setPrimary] = useState<string | null>(initialImageIds[0] ?? null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [title, setTitle] = useState("");
  const [approvalPolicy, setApprovalPolicy] = useState<"auto" | "masked_only" | "always">("masked_only");
  const [modelOverride, setModelOverride] = useState<string>("");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A value-stable key for the seed so the reset effect re-runs when the seed
  // CONTENT changes (not on every render — `initialImageIds` defaults to a fresh
  // [] each render, which would otherwise wipe user input on every keystroke).
  const seedKey = initialImageIds.join(",");

  // Reset + choose starting step whenever the modal opens or the seed changes.
  useEffect(() => {
    if (!open) return;
    setIds(initialImageIds);
    setPrimary(initialImageIds[0] ?? null);
    setRoles({});
    setTitle("");
    setApprovalPolicy("masked_only");
    setModelOverride("");
    setError(null);
    setStep(initialImageIds.length > 0 ? 2 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedKey]);

  useEffect(() => {
    if (!open) return;
    apiGet<{ models: ModelEntry[] }>("models")
      .then((r) => {
        const all = r.models ?? [];
        const imageEdit = all.filter((m) => m.capabilities?.image_to_image);
        setModels(imageEdit.length > 0 ? imageEdit : all);
      })
      .catch(() => setModels([]));
  }, [open]);

  // Keep primary valid as the selection changes.
  useEffect(() => {
    if (primary && !ids.includes(primary)) setPrimary(ids[0] ?? null);
    if (!primary && ids.length) setPrimary(ids[0]);
  }, [ids, primary]);

  const canNextFrom1 = ids.length > 0;
  const canCreate = title.trim().length > 0 && ids.length > 0 && !!primary;

  const references = useMemo(
    () => ids.filter((id) => id !== primary).map((id) => ({ imageId: id, role: roles[id] ?? "object" })),
    [ids, primary, roles],
  );

  const create = async () => {
    if (!canCreate || !primary) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        originLibraryImageId: primary,
        title: title.trim(),
        approvalPolicy,
        createdVia: "ui",
      };
      if (references.length) body.references = references;
      if (modelOverride) body.modelOverrides = { image_edit: modelOverride };
      const res = await apiSend<{ session: { sessionUuid: string } } | { sessionUuid: string }>(
        "POST",
        "sessions",
        body,
      );
      const uuid = "session" in res ? res.session.sessionUuid : res.sessionUuid;
      window.location.href = `/sessions/${uuid}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-card text-foreground ring-1 ring-border/40">
        <DialogHeader>
          <DialogTitle>New editing session</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-destructive/15 p-3 text-xs text-destructive">{error}</div>
        )}

        <Stepper
          value={step}
          onValueChange={setStep}
          indicators={{ completed: <Check className="size-3.5" />, loading: <Loader2 className="size-3.5 animate-spin" /> }}
          className="w-full space-y-6"
        >
          <StepperNav className="gap-3">
            {STEPS.map((s, i) => (
              <StepperItem
                key={s.title}
                step={i + 1}
                // Gate the tab headers so a user can't jump ahead of the
                // requirements: step 2 needs ≥1 image, step 3 needs a valid draft.
                disabled={i === 1 ? !canNextFrom1 : i === 2 ? !canCreate : false}
                className="relative flex-1 items-start"
              >
                <StepperTrigger className="flex grow flex-col items-start gap-2">
                  <StepperIndicator className="size-8 border-2">{s.icon}</StepperIndicator>
                  <StepperTitle className="text-sm font-semibold">{s.title}</StepperTitle>
                </StepperTrigger>
                {i < STEPS.length - 1 && (
                  <StepperSeparator className="absolute inset-x-0 start-9 top-4 m-0" />
                )}
              </StepperItem>
            ))}
          </StepperNav>

          <StepperPanel>
            <StepperContent value={1}>
              <ImagePickerPanel value={ids} onChange={setIds} />
            </StepperContent>

            <StepperContent value={2} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">
                  Session name <span className="text-destructive">*</span>
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Primary bath — spa remodel"
                  className="bg-background ring-1 ring-border/40"
                />
              </div>
              <div className="space-y-2">
                <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Primary image (session origin) &amp; reference roles
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {ids.map((id) => {
                    const isPrimary = id === primary;
                    return (
                      <div
                        key={id}
                        className={`flex flex-col gap-1 rounded-lg p-1.5 ring-1 ${
                          isPrimary ? "ring-primary" : "ring-border/40"
                        }`}
                      >
                        <button
                          onClick={() => setPrimary(id)}
                          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          title="Set as primary"
                        >
                          {isPrimary ? "★ primary" : `${id.slice(0, 8)}`}
                        </button>
                        {!isPrimary && (
                          <select
                            value={roles[id] ?? "object"}
                            onChange={(e) => setRoles((r) => ({ ...r, [id]: e.target.value as Role }))}
                            className="rounded bg-background px-1 py-0.5 text-[10px] ring-1 ring-border/40"
                          >
                            <option value="object">object</option>
                            <option value="style">style</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </StepperContent>

            <StepperContent value={3} className="space-y-4">
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">Approval policy</label>
                <select
                  value={approvalPolicy}
                  onChange={(e) => setApprovalPolicy(e.target.value as typeof approvalPolicy)}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border/40"
                >
                  <option value="masked_only">masked_only (default)</option>
                  <option value="auto">auto</option>
                  <option value="always">always</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-xs text-muted-foreground">
                  Image-edit model override (optional)
                </label>
                <select
                  value={modelOverride}
                  onChange={(e) => setModelOverride(e.target.value)}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-border/40"
                >
                  <option value="">Inherit defaults</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name ?? m.id}
                    </option>
                  ))}
                </select>
              </div>
            </StepperContent>
          </StepperPanel>
        </Stepper>

        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step === 1 && (
              <Button disabled={!canNextFrom1} onClick={() => setStep(2)}>
                Next
              </Button>
            )}
            {step === 2 && (
              <>
                <Button variant="outline" onClick={() => setStep(3)}>
                  Advanced
                </Button>
                <Button disabled={!canCreate || creating} onClick={create} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Create session
                </Button>
              </>
            )}
            {step === 3 && (
              <Button disabled={!canCreate || creating} onClick={create} className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Create session
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
