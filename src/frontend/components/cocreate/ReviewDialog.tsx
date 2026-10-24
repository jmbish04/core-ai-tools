/**
 * @fileoverview Review a proposed prompt before it becomes a version — the
 * demo's ReviewPromptModal, rebuilt on the `@reui/c-code-block-22` pattern
 * (an agent-proposed diff with Accept / Reject). The text stays editable, and
 * the diff follows the edit, so what is accepted is exactly what was reviewed.
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PromptDiff } from "./PromptDiff";

export interface ReviewDialogProps {
  open: boolean;
  basePrompt: string;
  proposed: string;
  /** e.g. "3 answers, 2 graph edits" */
  summary: string;
  saving: boolean;
  onAccept: (text: string) => void;
  onReject: () => void;
}

export function ReviewDialog({ open, basePrompt, proposed, summary, saving, onAccept, onReject }: ReviewDialogProps) {
  const [text, setText] = useState(proposed);
  useEffect(() => setText(proposed), [proposed]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onReject()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review the refined prompt</DialogTitle>
          <DialogDescription>
            Rewritten from {summary}. Edit it if anything is off — accepting saves it as a new version in the history.
          </DialogDescription>
        </DialogHeader>
        <PromptDiff before={basePrompt} after={text} title="Current → proposed" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Proposed prompt" />
        <DialogFooter>
          <Button variant="outline" onClick={onReject} disabled={saving}>
            Reject
          </Button>
          <Button onClick={() => onAccept(text)} disabled={saving || !text.trim()}>
            {saving ? "Saving…" : "Accept as new version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
