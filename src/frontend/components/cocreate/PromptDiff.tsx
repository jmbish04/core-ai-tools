/**
 * @fileoverview A prompt-to-prompt diff rendered with ReUI's `CodeBlock` diff
 * props (pattern from `@reui/c-code-block-5` / `-22`): one clause per line,
 * removed clauses struck red, added clauses green, with +/− counts in the header.
 */

import { useMemo, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { CodeBlock, CodeBlockCopyButton, CodeBlockHeader, CodeBlockTitle } from "@/components/reui/code-block/code-block";
import { diffPrompts, toLineDiff } from "../../../shared/prompt-diff";

export interface PromptDiffProps {
  before: string;
  after: string;
  title: ReactNode;
  /** `ghost` when a Card/Frame around it already supplies the chrome. */
  variant?: "default" | "ghost";
}

/**
 * Show what changed between two prompts.
 *
 * @example <PromptDiff before={v1.promptText} after={v2.promptText} title="v1 → v2" />
 */
export function PromptDiff({ before, after, title, variant = "default" }: PromptDiffProps) {
  const { code, added, removed } = useMemo(() => toLineDiff(diffPrompts(before, after)), [before, after]);
  return (
    // A language is REQUIRED: CodeBlock applies diff line states only on its
    // highlighted path, and with no registered language it falls back to plain
    // lines with no diff colouring. `markdown` renders prose as plain text.
    // Wrap, because a clause can be long.
    <CodeBlock code={code || " "} language="markdown" showLineNumbers defaultWrap variant={variant} diff={{ added, removed }}>
      <CodeBlockHeader>
        <CodeBlockTitle>{title}</CodeBlockTitle>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge variant="success-light">+{added.length}</Badge>
          <Badge variant="destructive-light">−{removed.length}</Badge>
          <CodeBlockCopyButton />
        </div>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
