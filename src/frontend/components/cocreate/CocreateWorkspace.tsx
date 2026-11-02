/**
 * @fileoverview `/cocreate/[id]` — one co-creator session, revisitable from D1.
 *
 * Left: the prompt (editable; a manual edit saves as a version), the actions
 * (analyze → answer → refine → generate) and four tabs — Questions, Belief
 * graph, History (the full revision log with diffs) and Consultant (answers
 * from other sessions). Right: every image generated, by version.
 *
 * All state that matters lives on the server; this island re-reads the session
 * after each mutation rather than patching local copies that could drift.
 */

import { useCallback, useEffect, useState } from "react";
import { ArchiveIcon, HistoryIcon, Loader2Icon, NetworkIcon, SaveIcon, ScanSearchIcon, SparklesIcon, WandSparklesIcon, XIcon } from "lucide-react";

import { OptionSelect } from "@/components/blocks/solution-files-1/components/option-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Badge } from "@/components/reui/badge";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiSend } from "@/lib/api";
import { cocreateSessionPath } from "@/lib/endpoints";
import { BeliefGraphView, toGraphUpdates, type StagedEdits } from "./BeliefGraphView";
import { ASPECT_OPTIONS, PROACTIVENESS_OPTIONS } from "./CocreateHome";
import { ConsultantPanel } from "./ConsultantPanel";
import { GenerationGallery } from "./GenerationGallery";
import { PromptHistory } from "./PromptHistory";
import { QuestionsPanel } from "./QuestionsPanel";
import { ReviewDialog } from "./ReviewDialog";
import { variantOf, type Generation, type Proposal, type PromptVersion, type SessionDetail } from "./types";

type Busy = null | "analyze" | "questions" | "answers" | "refine" | "save" | "generate" | "import" | "settings";

const EMPTY_EDITS: StagedEdits = { attributes: {}, relationships: {} };

export function CocreateWorkspace({ sessionId }: { sessionId: string }) {
  const path = cocreateSessionPath(sessionId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<StagedEdits>(EMPTY_EDITS);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tab, setTab] = useState("questions");

  const reload = useCallback(async () => {
    const d = await apiGet<SessionDetail>(path);
    setDetail(d);
    setDraft(d.session.currentPrompt);
    return d;
  }, [path]);

  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : "Could not load this session."));
  }, [reload]);

  /** Run a mutation with one busy flag and one error surface. */
  const run = useCallback(async <T,>(kind: Busy, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  // Cheap derivations from a list of tens of rows — recomputed per render, not memoised.
  const answers = detail?.answers ?? [];
  const pending = answers.filter((a) => a.status === "pending");
  const ready = answers.filter((a) => a.status === "answered" && !a.appliedInVersionId);
  const applied = answers.filter((a) => a.appliedInVersionId).length;
  const selected = new Set(ready.map((a) => a.id).filter((id) => !deselected.has(id)));
  const graphUpdates = toGraphUpdates(detail?.session.beliefGraph ?? null, staged);
  const changeCount = selected.size + graphUpdates.length;
  const importedSourceIds = new Set(answers.map((a) => a.sourceAnswerId).filter(Boolean) as string[]);

  if (!detail) {
    return error ? (
      <Alert variant="destructive">
        <AlertTitle>Could not open this session</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Skeleton className="h-[36rem]" />
        <Skeleton className="h-[36rem]" />
      </div>
    );
  }

  const { session, versions } = detail;
  const current = versions.find((v) => v.id === session.currentVersionId);
  const dirty = draft.trim() !== session.currentPrompt.trim();

  const analyze = (graph: boolean) =>
    run(graph ? "analyze" : "questions", async () => {
      await apiSend("POST", `${path}/analyze`, { graph });
      await reload();
    });

  const generate = (v?: PromptVersion) =>
    run("generate", async () => {
      const r = await apiSend<{ generated: number; failed: number }>("POST", `${path}/generate`, { versionId: v?.id });
      await reload();
      if (r.generated === 0) throw new Error("No image was produced. See the failed slots for the provider's reason.");
    });

  const addVersion = (body: Record<string, unknown>, kind: Busy = "save") =>
    run(kind, async () => {
      await apiSend("POST", `${path}/versions`, body);
      return reload();
    });

  const patch = (body: Record<string, unknown>) =>
    run("settings", async () => {
      await apiSend("PATCH", path, body);
      await reload();
    });

  async function acceptProposal(text: string) {
    if (!proposal) return;
    const d = await addVersion(
      { promptText: text, source: "refine", answerIds: proposal.answerIds, graphUpdates: proposal.graphUpdates },
      "refine",
    );
    if (!d) return;
    setProposal(null);
    setStaged(EMPTY_EDITS);
    setDeselected(new Set());
    // As in the demo: a new prompt gets a fresh graph and fresh questions.
    await analyze(true);
  }

  async function openInEditor(g: Generation) {
    if (!g.libraryImageId) return;
    const r = await run("settings", () =>
      apiSend<{ session: { sessionUuid: string } }>("POST", "sessions", {
        originLibraryImageId: g.libraryImageId,
        title: `${session.title} — v${versions.find((v) => v.id === g.promptVersionId)?.version ?? ""}`,
        createdVia: "ui",
      }),
    );
    if (r) window.location.href = `/sessions/${r.session.sessionUuid}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="border-border/40 flex flex-wrap items-end justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <a href="/cocreate" className="text-muted-foreground hover:text-foreground font-mono text-xs tracking-widest uppercase">
            Co-creator
          </a>
          <h1 className="text-foreground truncate text-2xl font-semibold tracking-tight">{session.title}</h1>
          {session.goal ? <p className="text-muted-foreground mt-1 max-w-3xl text-sm">Goal: {session.goal}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">v{current?.version ?? "?"} of {versions.length}</Badge>
          <Badge variant="outline">{answers.filter((a) => a.status === "answered").length} answers</Badge>
          <Button size="sm" variant="ghost" onClick={() => patch({ archived: !session.archivedAt })}>
            <ArchiveIcon className="size-4" aria-hidden="true" />
            {session.archivedAt ? "Unarchive" : "Archive"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Frame>
            <FrameHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <div>
                <FrameTitle>Prompt</FrameTitle>
                <FrameDescription>Edit freely; saving makes a new version. Everything is kept in History.</FrameDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <OptionSelect
                  value={session.proactiveness}
                  options={PROACTIVENESS_OPTIONS}
                  onChange={(v) => patch({ proactiveness: v })}
                  ariaLabel="Proactiveness"
                  contentClassName="w-72"
                />
                <OptionSelect value={session.aspectRatio} options={ASPECT_OPTIONS} onChange={(v) => patch({ aspectRatio: v })} ariaLabel="Aspect ratio" className="w-24" />
              </div>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-3">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} aria-label="Prompt" />
              {detail.referenceImage ? (
                <div className="flex items-center gap-3">
                  <img src={variantOf(detail.referenceImage.deliveryUrl, "thumb")} alt="Reference" className="size-12 rounded object-cover" />
                  <span className="text-muted-foreground text-xs">Reference image — analysis treats it as the current scene; generation edits from it.</span>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove reference image" onClick={() => patch({ referenceImageId: null })}>
                    <XIcon className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {dirty ? (
                  <>
                    <Button size="sm" onClick={() => addVersion({ promptText: draft, source: "manual" })} disabled={busy !== null || !draft.trim()}>
                      {busy === "save" ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <SaveIcon className="size-4" aria-hidden="true" />}
                      Save as v{versions.length + 1}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(session.currentPrompt)}>
                      Discard edit
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => analyze(true)} disabled={busy !== null}>
                      {busy === "analyze" ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <ScanSearchIcon className="size-4" aria-hidden="true" />}
                      {session.beliefGraph ? "Re-analyze" : "Analyze prompt"}
                    </Button>
                    <Button
                      size="sm"
                      variant={changeCount ? "default" : "outline"}
                      disabled={busy !== null || changeCount === 0}
                      onClick={() =>
                        run("refine", async () => {
                          setProposal(
                            await apiSend<Proposal>("POST", `${path}/refine`, { answerIds: [...selected], graphUpdates }),
                          );
                        })
                      }
                    >
                      {busy === "refine" ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <WandSparklesIcon className="size-4" aria-hidden="true" />}
                      Refine prompt{changeCount ? ` (${changeCount})` : ""}
                    </Button>
                    <Button size="sm" variant="outline" className="ms-auto" onClick={() => generate()} disabled={busy !== null}>
                      {busy === "generate" ? <Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> : <SparklesIcon className="size-4" aria-hidden="true" />}
                      Generate 4
                    </Button>
                  </>
                )}
              </div>
            </FramePanel>
          </Frame>

          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="questions">
                Questions
                {pending.length ? <Badge size="sm" variant="primary-light">{pending.length}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="graph">
                <NetworkIcon className="size-3.5" aria-hidden="true" />
                Belief graph
                {graphUpdates.length ? <Badge size="sm" variant="warning-light">{graphUpdates.length}</Badge> : null}
              </TabsTrigger>
              <TabsTrigger value="history">
                <HistoryIcon className="size-3.5" aria-hidden="true" />
                History
                <Badge size="sm" variant="secondary">{versions.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="consultant">Consultant</TabsTrigger>
            </TabsList>
            <TabsContent value="questions" className="pt-4">
              <QuestionsPanel
                pending={pending}
                ready={ready}
                selected={selected}
                onToggle={(id) =>
                  setDeselected((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onSubmit={async (list) => {
                  await run("answers", async () => {
                    await apiSend("POST", `${path}/answers`, { answers: list });
                    await reload();
                  });
                }}
                onAsk={() => analyze(false)}
                asking={busy === "questions" || busy === "analyze"}
                appliedCount={applied}
              />
            </TabsContent>
            <TabsContent value="graph" className="pt-4">
              <BeliefGraphView graph={session.beliefGraph} loading={busy === "analyze"} staged={staged} onStage={setStaged} />
            </TabsContent>
            <TabsContent value="history" className="pt-4">
              <PromptHistory
                key={session.currentVersionId ?? ""}
                versions={versions}
                answers={answers}
                generations={detail.generations}
                currentVersionId={session.currentVersionId}
                busy={busy !== null}
                onGenerate={(v) => generate(v)}
                onRestore={(v) =>
                  addVersion({ promptText: v.promptText, source: "restore", parentVersionId: v.id, note: `Restored from v${v.version}` })
                }
              />
            </TabsContent>
            <TabsContent value="consultant" className="pt-4">
              <ConsultantPanel
                sessionId={session.id}
                initialGoal={session.goal ?? session.currentPrompt}
                consultations={detail.consultations}
                onConsulted={() => void reload()}
                importedSourceIds={importedSourceIds}
                onImport={async (ids) => {
                  await apiSend("POST", `${path}/import-answers`, { answerIds: ids });
                  await reload();
                  setTab("questions");
                }}
              />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="min-w-0">
          <GenerationGallery
            generations={detail.generations}
            versions={versions}
            generating={busy === "generate"}
            referenceImageId={session.referenceImageId}
            onOpenInEditor={openInEditor}
            onUseAsReference={(g) => patch({ referenceImageId: g.libraryImageId })}
          />
        </aside>
      </div>

      <ReviewDialog
        open={proposal !== null}
        basePrompt={proposal?.basePrompt ?? ""}
        proposed={proposal?.promptText ?? ""}
        summary={proposal ? `${proposal.answerIds.length} answers and ${proposal.graphUpdates.length} graph edits` : ""}
        saving={busy === "refine"}
        onAccept={acceptProposal}
        onReject={() => setProposal(null)}
      />
    </div>
  );
}
