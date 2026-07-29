/**
 * @fileoverview SessionAssistant — the assistant-ui `<Thread />` embedded on a
 * session page, scoped to that session. The ChatBroker thread id is
 * `session-chat-<uuid>`, which (a) persists a distinct conversation per session
 * and (b) lets the broker inject the session context so "this session" works
 * without the user pasting the id (see ChatBroker.sessionUuidFromName).
 *
 * Browser-only: depends transitively on `agents/react` + PartySocket. Mount with
 * `client:only="react"`.
 */

"use client";

import { useState } from "react";

import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";

import { ThreadProvider, type ThreadStatus } from "@/components/assistant/Thread";

function statusFromReadyState(readyState: number): ThreadStatus {
  if (readyState === 1) return "connected";
  if (readyState === 0) return "connecting";
  return "disconnected";
}

export function SessionAssistant({ sessionUuid }: { sessionUuid: string }) {
  // Deterministic per-session thread id → the conversation resumes when you
  // return to the session, and the broker knows which session this is.
  const [threadId] = useState(() => `session-chat-${sessionUuid}`);

  const agent = useAgent({ agent: "chat-broker", name: threadId });
  const chat = useAgentChat({ agent });
  const runtime = useAISDKRuntime(chat);
  const status = statusFromReadyState(agent.readyState);

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border/40">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Session assistant</h2>
          <p className="text-xs text-muted-foreground">Knows this session — ask why an edit failed, or what to try next.</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ring-1 ${
            status === "connected"
              ? "text-emerald-400 ring-emerald-500/40"
              : status === "connecting"
                ? "text-amber-400 ring-amber-500/40"
                : "text-muted-foreground ring-border/40"
          }`}
        >
          {status}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ThreadProvider runtime={runtime} status={status} />
      </div>
    </div>
  );
}
