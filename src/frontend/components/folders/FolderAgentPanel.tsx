/**
 * @fileoverview The agent, docked beside the folder it is working on.
 *
 * Composed from ReUI `ai-chat-2`: its `ChatThread` and `Composer` do the message
 * rendering, markdown, scrollback and input. What is NOT reused is the block's
 * draft/document coupling — it exists to insert replies into a document, and this
 * panel has no document. Here the equivalent of "insert" is that the folder
 * itself changed, which the tree shows on its own.
 *
 * The folder in the URL rides with every turn, so the agent already knows what
 * the user is looking at instead of asking. When a turn ends, the caller refetches
 * — belt and braces next to the WebSocket, because a user who just watched the
 * agent say "done" should not have to wait on a socket round trip to see it.
 *
 * Tool calls are shown, including failures. An agent that quietly failed and
 * reported success in prose would be worse than one that says nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ChatThread } from "@/components/blocks/ai-chat-2/components/chat-thread";
import { Composer } from "@/components/blocks/ai-chat-2/components/composer";
import type {
  ChatMessageRecord,
  TranscriptRecord,
} from "@/components/blocks/ai-chat-2/components/data";
import { AGENT_TURN_STREAM_PATH } from "@/lib/endpoints";
import { postSse } from "@/lib/sse";
import type { FolderRow } from "./types";

interface ToolCallRecord {
  name: string;
  ok: boolean;
  error?: string;
}

interface TurnResponse {
  reply: string;
  toolCalls: ToolCallRecord[];
  model: string;
}

/** Render the tool calls as a markdown line under the reply. */
function toolLine(calls: ToolCallRecord[]): string {
  if (calls.length === 0) return "";
  const parts = calls.map((c) =>
    c.ok ? `\`${c.name}\` ✓` : `\`${c.name}\` ✗ — ${c.error ?? "failed"}`,
  );
  // No emphasis markers: the renderer left `*Ran:*` on screen as literal
  // asterisks. Backticks around the tool names do render, so they stay.
  return `\n\nRan ${parts.join(" · ")}`;
}

const now = () => new Date().toISOString();

export function FolderAgentPanel({
  folder,
  onChanged,
}: {
  folder: FolderRow | null;
  /** Called after every turn so the tree and contents refetch. */
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [modelId, setModelId] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  // The agent takes plain history; keep it beside the rendered transcript.
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  /** Aborts the in-flight turn. "Stop" that only clears a flag is not a stop —
   *  the reply still lands, and the freed gate lets a second turn run against the
   *  same folder concurrently. */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setStreaming(true);
      const controller = new AbortController();
      inFlight.current = controller;

      const userMessage: ChatMessageRecord = {
        id: `u-${Date.now()}`,
        role: "user",
        parts: [{ kind: "text", text: trimmed }],
        at: now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // The reply grows in place. One message id for the whole turn, so each
      // delta rewrites that message rather than appending a new one.
      const replyId = `a-${Date.now()}`;
      let replyText = "";
      const tools: ToolCallRecord[] = [];

      /** Rewrite the assistant message with whatever has arrived so far. */
      const paint = () => {
        const text = `${replyText}${toolLine(tools)}`;
        setMessages((prev) => {
          const next = [...prev];
          const at = next.findIndex((m) => m.id === replyId);
          const message: ChatMessageRecord = {
            id: replyId,
            role: "assistant",
            parts: [{ kind: "text", text }],
            at: now(),
          };
          if (at === -1) next.push(message);
          else next[at] = message;
          return next;
        });
      };

      try {
        for await (const frame of postSse(
          `/api/${AGENT_TURN_STREAM_PATH}`,
          {
            folderId: folder?.id ?? null,
            message: trimmed,
            history: history.current.slice(-20),
            model: modelId,
          },
          controller.signal,
        )) {
          // Stopped while this was in flight: drop the rest rather than writing
          // it in after whatever the user said next.
          if (controller.signal.aborted) return;

          switch (frame.type) {
            case "delta":
              replyText += String(frame.text ?? "");
              paint();
              break;
            case "tool": {
              const call = frame as unknown as ToolCallRecord;
              tools.push({ name: call.name, ok: call.ok, error: call.error });
              // A tool that succeeded has already committed to D1. Refresh now
              // rather than at the end of the turn, so the tree moves while the
              // agent is still talking — which is the point of streaming this.
              if (call.ok) onChanged();
              paint();
              break;
            }
            case "done": {
              const turn = frame.turn as unknown as TurnResponse;
              // `done` is authoritative: the deltas can miss a trailing chunk.
              replyText = turn.reply;
              tools.splice(0, tools.length, ...turn.toolCalls);
              paint();
              history.current = [
                ...history.current,
                { role: "user", content: trimmed },
                { role: "assistant", content: turn.reply },
              ];
              if (turn.toolCalls.some((c) => c.ok)) onChanged();
              break;
            }
            case "error":
              setError(String(frame.message ?? "The agent could not be reached."));
              break;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "The agent could not be reached.");
      } finally {
        if (inFlight.current === controller) {
          inFlight.current = null;
          setStreaming(false);
        }
      }
    },
    [folder?.id, modelId, onChanged, streaming],
  );

  const transcript: TranscriptRecord = {
    messages,
    separator: folder ? `Working in ${folder.name}` : "No folder selected",
  };

  return (
    // The viewport height belongs to the sticky third column only. Below xl the
    // panel is stacked under the folder, where `100svh` made it a ~700px box of
    // empty space between the settings card and the composer — the transcript
    // grows into its height, so it has to be bounded, not filled.
    <section className="bg-card border-border flex h-[32rem] flex-col rounded-lg border xl:h-[calc(100svh-12rem)] xl:min-h-[28rem]">
      <header className="border-border border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">Agent</h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {folder
            ? `Working in ${folder.name}. It edits this folder for you.`
            : "Pick a folder and it will work there."}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-2 p-4">
            <p className="text-muted-foreground text-sm">
              Ask it to tidy this folder, set a prompt for everything inside, tag what each
              image is for, or run one idea across several models.
            </p>
            <ul className="space-y-1.5">
              {[
                "What is in this folder?",
                "Set a default prompt for everything in here",
                "Tag each image with what it is for",
              ].map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void send(s)}
                    className="border-border hover:bg-accent/40 w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ChatThread
            transcript={transcript}
            streaming={streaming}
            stopped={false}
            stoppedIds={[]}
            arrivingId={null}
            drafted={false}
            onToggleDraft={() => undefined}
            onSend={(t) => void send(t)}
            onRetry={() => undefined}
            onArrived={() => undefined}
          />
        )}
      </div>

      {error ? (
        <p className="text-destructive-foreground border-border border-t px-4 py-2 text-xs">{error}</p>
      ) : null}

      <div className="border-border border-t p-3">
        <Composer
          streaming={streaming}
          modelId={modelId}
          onModelChange={setModelId}
          placeholder={
            folder ? `Ask the agent about ${folder.name}…` : "Pick a folder to work in…"
          }
          onSend={(t) => void send(t)}
          onStop={() => {
            inFlight.current?.abort();
            inFlight.current = null;
            setStreaming(false);
          }}
        />
      </div>
    </section>
  );
}
