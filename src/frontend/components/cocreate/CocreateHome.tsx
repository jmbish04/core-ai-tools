/**
 * @fileoverview `/cocreate` — start a co-creator session, revisit past ones, or
 * ask the consultant first. Every session listed here is fully revisitable: its
 * prompt log, questionnaire and images are stored in D1 / Cloudflare Images.
 */

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, Loader2Icon, MessagesSquareIcon, PlusIcon, WandSparklesIcon } from "lucide-react";

import { OptionSelect, type Option } from "@/components/blocks/solution-files-1/components/option-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiSend } from "@/lib/api";
import { COCREATE_SESSIONS_PATH } from "@/lib/endpoints";
import { relativeTime } from "@/lib/format";
import { ConsultantPanel } from "./ConsultantPanel";
import { variantOf, type CocreateSession, type Consultation, type Proactiveness, type SessionListItem } from "./types";

export const PROACTIVENESS_OPTIONS: Option<Proactiveness>[] = [
  { value: "low", label: "Strict", description: "Only what you wrote. Fewest guesses." },
  { value: "medium", label: "Balanced", description: "Fills obvious gaps with sensible defaults." },
  { value: "high", label: "Creative", description: "Proposes bold additions to consider." },
];

export const ASPECT_OPTIONS: Option<string>[] = ["16:9", "4:3", "1:1", "3:4", "9:16"].map((v) => ({ value: v, label: v }));

export function CocreateHome() {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [proactiveness, setProactiveness] = useState<Proactiveness>("medium");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        apiGet<{ sessions: SessionListItem[] }>(COCREATE_SESSIONS_PATH),
        apiGet<{ consultations: Consultation[] }>("cocreate/consultations"),
      ]);
      setSessions(s.sessions);
      setConsultations(c.consultations);
      setError(null);
    } catch (e) {
      // A failed read is an error, never an empty list.
      setError(e instanceof Error ? e.message : "Could not load co-creator sessions.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(body: Record<string, unknown>) {
    setCreating(true);
    setError(null);
    try {
      const s = await apiSend<CocreateSession>("POST", COCREATE_SESSIONS_PATH, body);
      window.location.href = `/cocreate/${s.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the session.");
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="border-border/40 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">Co-creator</p>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Say what you mean before the model guesses</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            The co-creator maps your prompt into what the model believes, asks the questions it would otherwise answer for
            you, and keeps every prompt version, answer and image so you can come back to it.
          </p>
        </div>
        {sessions ? (
          <div className="flex gap-2">
            <Badge variant="outline">{sessions.length} sessions</Badge>
            <Badge variant="outline">{sessions.reduce((n, s) => n + s.answeredCount, 0)} answers to reuse</Badge>
          </div>
        ) : null}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Frame>
            <FrameHeader>
              <FrameTitle className="flex items-center gap-2">
                <WandSparklesIcon className="text-muted-foreground size-4" aria-hidden="true" />
                New session
              </FrameTitle>
              <FrameDescription>Start from a rough idea. You will refine it with questions before generating.</FrameDescription>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="a cat hosting a party for its bunny friends"
                aria-label="Prompt"
                rows={3}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title (optional)"
                  aria-label="Title"
                  className="min-w-0 flex-1 basis-48"
                />
                <OptionSelect
                  value={proactiveness}
                  options={PROACTIVENESS_OPTIONS}
                  onChange={setProactiveness}
                  ariaLabel="Proactiveness"
                  contentClassName="w-72"
                />
                <OptionSelect value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} ariaLabel="Aspect ratio" className="w-24" />
                <Button
                  onClick={() => create({ prompt, title: title || null, proactiveness, aspectRatio })}
                  disabled={creating || !prompt.trim()}
                >
                  {creating ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <PlusIcon className="size-4" aria-hidden="true" />}
                  Start
                </Button>
              </div>
            </FramePanel>
          </Frame>

          <section aria-labelledby="cocreate-sessions" className="flex flex-col gap-3">
            <h2 id="cocreate-sessions" className="text-sm font-medium">
              Sessions
            </h2>
            {sessions === null && !error ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-56" />
                ))}
              </div>
            ) : sessions && sessions.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessagesSquareIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No sessions yet</EmptyTitle>
                  <EmptyDescription>Start one above. Each session keeps its full prompt history and every image.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sessions?.map((s) => (
                  <li key={s.id}>
                    <a href={`/cocreate/${s.id}`} className="group block h-full" aria-label={`Open session: ${s.title}`}>
                      <Frame dense className="h-full transition-colors group-hover:border-primary/40">
                        <FramePanel className="flex h-full flex-col gap-3 p-0">
                          {s.latestImageUrl ? (
                            <img
                              src={variantOf(s.latestImageUrl, "thumb")}
                              alt=""
                              loading="lazy"
                              className="aspect-video w-full object-cover"
                            />
                          ) : (
                            <div className="bg-muted/40 text-muted-foreground flex aspect-video w-full items-center justify-center">
                              <ImageIcon className="size-5" aria-hidden="true" />
                            </div>
                          )}
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 pb-3">
                            <span className="truncate text-sm font-medium">{s.title}</span>
                            <p className="text-muted-foreground line-clamp-2 text-xs">{s.currentPrompt}</p>
                            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                              <Badge variant="secondary" size="sm">v{s.versionCount}</Badge>
                              <Badge variant="secondary" size="sm">{s.answeredCount} answers</Badge>
                              <Badge variant="secondary" size="sm">{s.imageCount} images</Badge>
                              <span className="text-muted-foreground ml-auto text-[11px]">{relativeTime(s.updatedAt)}</span>
                            </div>
                          </div>
                        </FramePanel>
                      </Frame>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0">
          <ConsultantPanel
            consultations={consultations}
            onConsulted={(c) => setConsultations((prev) => [c, ...prev])}
            onStart={(c) =>
              create({
                prompt: c.goal,
                goal: c.goal,
                proactiveness,
                aspectRatio,
                importAnswerIds: c.matches.map((m) => m.answerId),
                consultationId: c.id,
              })
            }
          />
        </aside>
      </div>
    </div>
  );
}
