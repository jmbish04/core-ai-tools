/**
 * @fileoverview The consultant: the user says what they are trying to make, and
 * the consultant cites answers from OTHER co-creator sessions that bear on it,
 * with why and how to use each, plus advice for steering the model away from
 * guessed detail. Used on `/cocreate` (start a session from the advice) and in
 * a workspace (pull the cited answers into this session's questionnaire).
 *
 * Composition: a ReUI `Frame` ask box (as in `@reui/ai-chat-5`/`-10`), the
 * advice as `Markdown`, and each cited answer as an `Item` row with a `Badge`.
 */

import { useState } from "react";
import { ArrowUpRightIcon, CheckIcon, CompassIcon, Loader2Icon, SparklesIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { apiSend } from "@/lib/api";
import { COCREATE_CONSULT_PATH } from "@/lib/endpoints";
import { relativeTime } from "@/lib/format";
import type { Consultation } from "./types";

export interface ConsultantPanelProps {
  /** Ask on behalf of this session (its prompt is context; its own answers are excluded). */
  sessionId?: string;
  initialGoal?: string;
  consultations: Consultation[];
  onConsulted: (c: Consultation) => void;
  /** Workspace: bring cited answers into this session. */
  onImport?: (answerIds: string[]) => Promise<void>;
  /** Answer ids already imported here (source ids), to mark them done. */
  importedSourceIds?: Set<string>;
  /** Home: start a session seeded with the advice. */
  onStart?: (c: Consultation) => void;
}

export function ConsultantPanel({
  sessionId,
  initialGoal = "",
  consultations,
  onConsulted,
  onImport,
  importedSourceIds,
  onStart,
}: ConsultantPanelProps) {
  const [goal, setGoal] = useState(initialGoal);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!goal.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onConsulted(await apiSend<Consultation>("POST", COCREATE_CONSULT_PATH, { goal, sessionId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The consultant could not answer.");
    } finally {
      setBusy(false);
    }
  }

  async function importIds(key: string, ids: string[]) {
    if (!onImport) return;
    setImporting(key);
    setError(null);
    try {
      await onImport(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring those answers in.");
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FrameHeader>
          <FrameTitle className="flex items-center gap-2">
            <CompassIcon className="text-muted-foreground size-4" aria-hidden="true" />
            Consultant
          </FrameTitle>
          <FrameDescription>
            Describe what you are trying to make. The consultant finds decisions you already made in other sessions and tells
            you how to use them so the model draws what you mean, not what it guesses.
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-3">
          <Textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Show my kitchen with matte oak cabinets and brass fixtures, photoreal, morning light"
            aria-label="What are you trying to make?"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">⌘ Enter to ask</span>
            <Button size="sm" onClick={ask} disabled={busy || !goal.trim()}>
              {busy ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <SparklesIcon className="size-4" aria-hidden="true" />}
              {busy ? "Consulting…" : "Ask the consultant"}
            </Button>
          </div>
        </FramePanel>
      </Frame>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Consultant failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {consultations.length === 0 && !busy ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CompassIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No advice yet</EmptyTitle>
            <EmptyDescription>
              Answers you give in any session become material the consultant can reuse. Ask once you have a goal in mind.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {consultations.map((c) => {
        const pending = c.matches.filter((m) => !importedSourceIds?.has(m.answerId));
        return (
          <Frame key={c.id} stacked dense spacing="sm">
            <FrameHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <FrameTitle className="truncate">{c.goal}</FrameTitle>
                <FrameDescription>
                  {relativeTime(c.createdAt)} · read {c.candidateCount} past answers · cited {c.matches.length}
                </FrameDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                {onImport && pending.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={importing !== null}
                    onClick={() => importIds(c.id, pending.map((m) => m.answerId))}
                  >
                    {importing === c.id ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
                    Use all {pending.length}
                  </Button>
                ) : null}
                {onStart ? (
                  <Button size="sm" onClick={() => onStart(c)}>
                    Start a session from this
                  </Button>
                ) : null}
              </div>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-4">
              <Markdown className="text-sm">{c.advice}</Markdown>
              {c.matches.length > 0 ? (
                <ul className="flex flex-col gap-2" aria-label="Relevant answers from other sessions">
                  {c.matches.map((m) => {
                    const done = importedSourceIds?.has(m.answerId);
                    return (
                      <li key={m.answerId} className="bg-muted/40 flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{m.question}</span>
                            <Badge variant="primary-light">{m.answer}</Badge>
                          </div>
                          <p className="text-muted-foreground text-xs">{m.reason}</p>
                          <p className="text-xs">
                            <span className="text-muted-foreground">How to use: </span>
                            {m.howToUse}
                          </p>
                          <a
                            href={`/cocreate/${m.fromSessionId}`}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                          >
                            From “{m.fromSessionTitle}”
                            <ArrowUpRightIcon className="size-3" aria-hidden="true" />
                          </a>
                        </div>
                        {onImport ? (
                          <Button
                            size="sm"
                            variant={done ? "ghost" : "outline"}
                            disabled={done || importing !== null}
                            onClick={() => importIds(m.answerId, [m.answerId])}
                            className="shrink-0"
                          >
                            {done ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                            {done ? "In this session" : importing === m.answerId ? "Adding…" : "Use this answer"}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">
                  No past answers matched. The advice above still applies; answering this session's questions builds the
                  history the consultant draws on.
                </p>
              )}
            </FramePanel>
          </Frame>
        );
      })}
    </div>
  );
}
