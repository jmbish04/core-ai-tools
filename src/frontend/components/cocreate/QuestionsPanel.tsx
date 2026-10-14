/**
 * @fileoverview The clarifying questions, as a ReUI/shadcn `Questionnaire`
 * (composition from `@reui/c-questionnaire-3` — a typed answer beside the
 * choices — and `-5` — an optional question that can be skipped on purpose).
 *
 * Below it, the answers waiting to be folded into the prompt, each with a
 * checkbox so the user decides what the next refinement absorbs. Answers pulled
 * in from other sessions are marked as such.
 */

import { useId, useRef, useState, type FormEvent } from "react";
import { CornerDownRightIcon, HelpCircleIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import type { QuestionnaireItemStatus } from "@shadcn/react/questionnaire";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import type { Answer } from "./types";

export interface QuestionsPanelProps {
  pending: Answer[];
  ready: Answer[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSubmit: (answers: Array<{ id: string; answer: string | null }>) => Promise<void>;
  onAsk: () => void;
  asking: boolean;
  /** Answers already absorbed by some version — shown as history. */
  appliedCount: number;
}

export function QuestionsPanel({ pending, ready, selected, onToggle, onSubmit, onAsk, asking, appliedCount }: QuestionsPanelProps) {
  const titleId = useId();
  // FormData cannot tell a skipped question from a blank one; the status can.
  const statuses = useRef<Record<string, QuestionnaireItemStatus>>({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await onSubmit(
        pending.map((q) => {
          const v = form.get(q.id);
          const text = typeof v === "string" ? v.trim() : "";
          return { id: q.id, answer: statuses.current[q.id] === "skipped" || !text ? null : text };
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 ? (
        <Questionnaire
          key={pending.map((q) => q.id).join()}
          className="w-full"
          defaultItem={pending[0].id}
          items={pending.map((q) => ({ name: q.id }))}
          onSubmit={handleSubmit}
        >
          <div className="flex items-center justify-between gap-2">
            <QuestionnaireProgress />
            <Button size="sm" variant="ghost" onClick={onAsk} disabled={asking} type="button">
              {asking ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCwIcon className="size-4" aria-hidden="true" />}
              Different questions
            </Button>
          </div>
          <Card>
            {pending.map((q) => (
              <QuestionnaireItem
                key={q.id}
                name={q.id}
                aria-labelledby={`${titleId}-${q.id}`}
                onStatusChange={(s) => {
                  statuses.current[q.id] = s;
                }}
              >
                <CardHeader>
                  <QuestionnaireTitle id={`${titleId}-${q.id}`} render={<CardTitle />}>
                    {q.question}
                  </QuestionnaireTitle>
                  <CardDescription>Pick one, type your own, or skip if it does not matter to you.</CardDescription>
                </CardHeader>
                <CardContent>
                  <QuestionnaireChoices>
                    {q.options.map((o) => (
                      <QuestionnaireChoice key={o} value={o}>
                        {o}
                      </QuestionnaireChoice>
                    ))}
                    <QuestionnaireInput aria-label={`Your own answer to: ${q.question}`} placeholder="Something else" />
                  </QuestionnaireChoices>
                </CardContent>
              </QuestionnaireItem>
            ))}
            <CardFooter>
              <QuestionnaireActions className="w-full">
                <QuestionnairePrevious />
                <QuestionnaireSkip>Skip</QuestionnaireSkip>
                <QuestionnaireNext>Next</QuestionnaireNext>
                <QuestionnaireSubmit disabled={saving}>{saving ? "Saving…" : "Save answers"}</QuestionnaireSubmit>
              </QuestionnaireActions>
            </CardFooter>
          </Card>
        </Questionnaire>
      ) : (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HelpCircleIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No open questions</EmptyTitle>
            <EmptyDescription>
              Ask the model what it would otherwise guess about this prompt. Each answer removes one guess from the image.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={onAsk} disabled={asking}>
              {asking ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : null}
              {asking ? "Thinking…" : "Ask clarifying questions"}
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {ready.length > 0 ? (
        <Frame stacked dense spacing="sm">
          <FrameHeader>
            <FrameTitle>Ready to fold into the prompt</FrameTitle>
            <FrameDescription>
              {selected.size} of {ready.length} selected. Refine the prompt to apply them; the new version records which ones it used.
            </FrameDescription>
          </FrameHeader>
          <FramePanel>
            <ul className="flex flex-col gap-2">
              {ready.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <Checkbox
                    checked={selected.has(a.id)}
                    onCheckedChange={() => onToggle(a.id)}
                    aria-label={`Apply: ${a.question}`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{a.question}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="primary-light">{a.answer}</Badge>
                      {a.sourceAnswerId ? (
                        <Badge variant="info-light" className="gap-1">
                          <CornerDownRightIcon className="size-3" aria-hidden="true" />
                          from another session
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      ) : null}

      {appliedCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {appliedCount} earlier answer{appliedCount === 1 ? " is" : "s are"} already part of the prompt — see History for which version absorbed each.
        </p>
      ) : null}
    </div>
  );
}
