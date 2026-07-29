/**
 * @fileoverview AssistantModal — a floating "Ask AI" button that opens the
 * enhanced single-thread {@link Thread} in a base-ui Dialog.
 *
 * Quiet by default: it takes NO layout space until the user clicks the floating
 * button, then floats over everything. That's why session pages use it instead
 * of an always-present side panel — the workbench keeps the full screen width.
 *
 * Thread id: pass `agentName` to bind a specific ChatBroker conversation (e.g.
 * `session-chat-<uuid>` so the broker knows which session it is). With no
 * `agentName` it falls back to a per-browser-session id persisted in
 * `sessionStorage` (the homepage behaviour) so re-opening resumes the chat.
 *
 * The runtime is only created once the dialog has been opened at least once
 * (kept mounted thereafter so history survives close/re-open). Mount
 * `client:only="react"`.
 */

"use client";

import * as React from "react";

import { SparklesIcon } from "lucide-react";

import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ThreadProvider, type ThreadStatus } from "./Thread";

/** Resolve (and persist) a stable per-session ChatBroker id for the modal. */
function useModalSessionId(): string {
  return React.useState(() => {
    if (typeof window === "undefined") return "assistant-modal-ssr";
    const stored = window.sessionStorage.getItem("assistant-modal-session");
    if (stored) return stored;
    const fresh = `assistant-modal-${crypto.randomUUID()}`;
    window.sessionStorage.setItem("assistant-modal-session", fresh);
    return fresh;
  })[0];
}

/** Map PartySocket `readyState` to a {@link ThreadStatus}. */
function statusFromReadyState(readyState: number): ThreadStatus {
  if (readyState === 1) return "connected";
  if (readyState === 0) return "connecting";
  return "disconnected";
}

/** Configurable copy + thread binding for {@link AssistantModal}. */
export interface AssistantModalProps {
  /**
   * ChatBroker thread id to bind. Omit for the per-browser homepage chat; pass
   * `session-chat-<uuid>` on a session page so the broker knows the session.
   */
  agentName?: string;
  /** Floating button label. */
  buttonLabel?: string;
  /** Dialog title. */
  title?: string;
  /** Dialog subtitle (under the title). */
  description?: string;
  /** Empty-thread welcome heading. */
  welcomeTitle?: string;
  /** Empty-thread welcome subtitle. */
  welcomeSubtitle?: string;
  /** Composer placeholder. */
  placeholder?: string;
  /** Starter prompt chips on the empty screen. */
  welcomeSuggestions?: string[];
  /** "center" = centered modal (default); "bottom" = sheet that slides up. */
  placement?: "center" | "bottom";
}

/**
 * The live chat surface. Split out so the `useAgent` WebSocket only opens once
 * the modal has been activated (kept mounted afterwards).
 */
function ModalChat({
  agentName,
  welcomeTitle = "Ask AI",
  welcomeSubtitle = "I can answer questions, render a metric card, or draft a task.",
  placeholder = "Ask anything about this app…",
  welcomeSuggestions,
}: Pick<AssistantModalProps, "agentName" | "welcomeTitle" | "welcomeSubtitle" | "placeholder" | "welcomeSuggestions">) {
  const fallbackId = useModalSessionId();
  const agent = useAgent({ agent: "chat-broker", name: agentName ?? fallbackId });
  const chat = useAgentChat({ agent });
  const runtime = useAISDKRuntime(chat);
  const status = statusFromReadyState(agent.readyState);

  return (
    <ThreadProvider
      runtime={runtime}
      status={status}
      welcomeTitle={welcomeTitle}
      welcomeSubtitle={welcomeSubtitle}
      placeholder={placeholder}
      {...(welcomeSuggestions ? { welcomeSuggestions } : {})}
    />
  );
}

/**
 * Floating assistant button + dialog. Drop once near the end of a page.
 */
export function AssistantModal({
  agentName,
  buttonLabel = "Ask AI",
  title = "Assistant",
  description = "Powered by the ChatBroker Durable Object over a WebSocket channel.",
  welcomeTitle,
  welcomeSubtitle,
  placeholder,
  welcomeSuggestions,
  placement = "center",
}: AssistantModalProps = {}) {
  const [open, setOpen] = React.useState(false);
  const [activated, setActivated] = React.useState(false);

  React.useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 gap-2 rounded-full bg-orange-600 px-5 shadow-lg shadow-orange-950/40 hover:bg-orange-700"
        aria-label={buttonLabel}
      >
        <SparklesIcon className="size-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          placement={placement}
          className={
            placement === "bottom"
              ? "flex h-[min(80vh,640px)] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0"
              : "flex h-[min(80vh,640px)] max-w-xl flex-col gap-0 overflow-hidden p-0"
          }
          showClose
        >
          <DialogHeader className="border-b border-border/30 px-5 py-4">
            <DialogTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-orange-500" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1">
            {/* Only mount the live chat (and its WebSocket) once activated.
                Before that, a static placeholder — `<Thread />` requires a
                runtime provider, so we never render it bare. */}
            {activated ? (
              <ModalChat
                agentName={agentName}
                welcomeTitle={welcomeTitle}
                welcomeSubtitle={welcomeSubtitle}
                placeholder={placeholder}
                welcomeSuggestions={welcomeSuggestions}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Connecting…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
