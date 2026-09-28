/**
 * @fileoverview Wizard step 5 — the copilot that settles the project's settings
 * by conversation.
 *
 * This is NOT the folder agent, and it deliberately cannot act: the project
 * folder does not exist yet (the wizard writes nothing until the user commits),
 * so there is nothing for `set_folder_settings` to be called on. Instead the
 * copilot PROPOSES, the user accepts or edits, and the wizard writes on finish.
 * `backend/ai/agent/onboarding-copilot.ts` carries the reasoning.
 *
 * The proposal is applied to the draft, not to D1. A user who talks to the
 * copilot and then closes the tab has changed nothing, which is the same promise
 * every other step of the wizard makes.
 */

import { useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiSend } from "@/lib/api";
import { AGENT_TURN_PATH } from "@/lib/endpoints";
import { USE_CASES } from "./types";
import type { OnboardingDraft } from "./types";

/** What the copilot settled. Mirrors the backend's `SettingsProposal`. */
export interface SettingsProposal {
  defaultPrompt?: string | null;
  contextText?: string | null;
  useCase?: string | null;
  summary?: string;
}

interface TurnResponse {
  reply: string;
  proposal: SettingsProposal | null;
  model: string;
}

interface Line {
  role: "user" | "assistant";
  text: string;
  /** Attached to the assistant line that produced it, so it stays in context. */
  proposal?: SettingsProposal | null;
}

const OPENERS = [
  "Help me write a prompt for this project",
  "What context should the models have?",
  "I'm not sure which use case fits",
];

/** The settings keys a proposal can carry, in the order the review lists them. */
const FIELDS: { key: keyof SettingsProposal; label: string }[] = [
  { key: "defaultPrompt", label: "Default prompt" },
  { key: "contextText", label: "Context" },
  { key: "useCase", label: "Use case" },
];

function describe(key: keyof SettingsProposal, value: unknown): string {
  if (value === null) return "cleared — inherits from the folder above";
  if (key === "useCase") {
    return USE_CASES.find((u) => u.id === value)?.label ?? String(value);
  }
  return String(value);
}

export function OnboardingCopilot({
  draft,
  parentFolderName,
  onApply,
}: {
  draft: OnboardingDraft;
  parentFolderName: string;
  /** Applies a proposal to the draft. The wizard writes it on finish, not here. */
  onApply: (proposal: SettingsProposal) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => inFlight.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, busy]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    setBusy(true);
    setValue("");
    const controller = new AbortController();
    inFlight.current = controller;

    const history = lines.map((l) => ({ role: l.role, content: l.text }));
    setLines((prev) => [...prev, { role: "user", text: trimmed }]);

    try {
      const turn = await apiSend<TurnResponse>(
        "POST",
        AGENT_TURN_PATH,
        {
          folderId: null,
          mode: "onboarding",
          message: trimmed,
          history: history.slice(-20),
          draft: {
            name: draft.name,
            parentFolderName,
            useCase: draft.useCase || null,
            scenario: draft.scenario || null,
            defaultPrompt: draft.defaultPrompt || null,
            contextText: draft.contextText || null,
            images: draft.images.map((i) => ({ title: i.filename, role: i.role })),
            assets: draft.assets.map((a) => a.name),
          },
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setLines((prev) => [
        ...prev,
        { role: "assistant", text: turn.reply, proposal: turn.proposal },
      ]);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "The copilot could not be reached.");
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
          <SparklesIcon className="size-4" aria-hidden="true" />
          Settle it by talking
        </h3>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">
          Describe the job and the copilot will suggest the prompt, context and use case this
          project should start from. Nothing is written until you create the project — if you
          would rather fill the fields in yourself, go back a step.
        </p>
      </div>

      <div className="border-border bg-background/40 flex max-h-[26rem] min-h-[12rem] flex-col gap-3 overflow-y-auto rounded-md border p-3">
        {lines.length === 0 ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">Try one of these:</p>
            <ul className="space-y-1.5">
              {OPENERS.map((o) => (
                <li key={o}>
                  <button
                    type="button"
                    onClick={() => void send(o)}
                    className="border-border hover:bg-accent/40 w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                  >
                    {o}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={line.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  line.role === "user"
                    ? "bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm"
                    : "max-w-[92%] space-y-2"
                }
              >
                <p className="text-sm whitespace-pre-wrap">{line.text}</p>
                {line.proposal ? (
                  <div className="border-border bg-card space-y-2 rounded-md border p-3">
                    <p className="text-foreground text-xs font-medium">
                      {line.proposal.summary ?? "Suggested settings"}
                    </p>
                    <dl className="space-y-1.5">
                      {FIELDS.filter((f) => f.key in line.proposal!).map((f) => (
                        <div key={f.key} className="min-w-0">
                          <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">
                            {f.label}
                          </dt>
                          <dd className="text-foreground text-sm break-words">
                            {describe(f.key, line.proposal![f.key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <Button
                      size="sm"
                      onClick={() => {
                        onApply(line.proposal!);
                        setApplied(line.proposal!.summary ?? "Settings applied to this project.");
                      }}
                    >
                      Use these settings
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        {busy ? <p className="text-muted-foreground text-sm">Thinking…</p> : null}
        <div ref={endRef} />
      </div>

      {applied ? (
        <p className="text-muted-foreground text-xs">
          Applied — {applied} You can still change it on the review step.
        </p>
      ) : null}
      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(value);
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. I'm choosing between island materials in a 1920s kitchen"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || value.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
