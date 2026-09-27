/**
 * @fileoverview The folder organiser — the workspace's main screen.
 *
 * Three regions over one selection: the nested tree (ReUI `tree`, built on
 * @headless-tree), the selected folder's images, and the settings in force here
 * WITH their provenance, so an inherited prompt says which ancestor set it
 * rather than appearing from nowhere.
 *
 * Live: it subscribes to `/ws/folder/:id` and refetches the parts an event
 * touches. The channel is deliberately a notification, not a payload — D1 is the
 * truth, so an event says "images changed here" and the UI re-reads. That also
 * means an agent editing the folder shows up the same way a person does.
 *
 * Hand-rolled WebSocket client (reconnecting, resume-by-seq), not the Agents SDK
 * `useAgent` hook: that hook crashes this repo's SSR worker on a null dispatcher,
 * and FolderDO is a plain Durable Object anyway.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
import {
  LIBRARY_FOLDERS_PATH,
  LIBRARY_IMAGES_PATH,
  folderSettingsPath,
} from "@/lib/endpoints";
import { buildFolderTree } from "./types";
import type { FolderNode, FolderRow, ImageRow, ResolvedFolderSettings } from "./types";
import { FolderSettingsCard } from "./FolderSettingsCard";
import { FolderContents } from "./FolderContents";
import { FolderTree } from "./FolderTree";
import { FolderAgentPanel } from "./FolderAgentPanel";
import { ProjectHero } from "./ProjectHero";

/** Read the folder id out of the URL so a reload lands on the same folder. */
function folderFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("folder");
}

export function FolderOrganiser() {
  const [folders, setFolders] = useState<FolderRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(folderFromLocation);
  const [images, setImages] = useState<ImageRow[] | null>(null);
  const [settings, setSettings] = useState<ResolvedFolderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const loadFolders = useCallback(async () => {
    try {
      const res = await apiGet<{ folders: FolderRow[] }>(LIBRARY_FOLDERS_PATH);
      setFolders(res.folders);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load folders.");
    }
  }, []);

  const loadFolderBody = useCallback(async (folderId: string | null) => {
    if (!folderId) {
      setImages(null);
      setSettings(null);
      setBodyError(null);
      return;
    }
    const [imgs, resolved] = await Promise.allSettled([
      apiGet<{ images: ImageRow[] }>(LIBRARY_IMAGES_PATH, { folderId }),
      apiGet<ResolvedFolderSettings>(folderSettingsPath(folderId)),
    ]);
    // A failed read is NOT an empty folder. Substituting `[]` here is how this
    // screen spent its whole life reporting "0 images" for every folder while
    // the request behind it 404'd — the one failure mode a screenshot cannot
    // tell apart from the truth.
    if (imgs.status === "fulfilled") {
      setImages(imgs.value.images);
      setBodyError(null);
    } else {
      setImages(null);
      setBodyError(
        imgs.reason instanceof Error ? imgs.reason.message : "Could not load this folder's images.",
      );
    }
    setSettings(resolved.status === "fulfilled" ? resolved.value : null);
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadFolderBody(selected);
  }, [selected, loadFolderBody]);

  // Keep the URL in step so a refresh, a copied link and the back button all work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("folder", selected);
    else url.searchParams.delete("folder");
    window.history.replaceState({}, "", url);
  }, [selected]);

  // --- realtime -----------------------------------------------------------
  const seqRef = useRef(0);
  useEffect(() => {
    if (!selected || typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: number | undefined;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${proto}//${window.location.host}/ws/folder/${selected}`);

      socket.onopen = () => {
        retry = 0;
        setLive(true);
        socket?.send(JSON.stringify({ lastSeq: seqRef.current }));
      };
      socket.onmessage = (ev) => {
        let frame: { type?: string; seq?: number };
        try {
          frame = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (typeof frame.seq === "number") seqRef.current = frame.seq;
        // The DO tells us the replay window is gone rather than handing over a
        // partial one — so refetch everything instead of trusting a gap.
        if (frame.type === "resync_required") {
          void loadFolders();
          void loadFolderBody(selected);
          return;
        }
        if (frame.type === "synced") return;
        if (frame.type?.startsWith("folder_")) void loadFolders();
        void loadFolderBody(selected);
      };
      const reopen = () => {
        setLive(false);
        if (closed) return;
        // Back off, but keep trying: a folder page is left open for a long time.
        retry = Math.min(retry + 1, 6);
        timer = window.setTimeout(connect, 500 * 2 ** retry);
      };
      socket.onclose = reopen;
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      socket?.close();
    };
  }, [selected, loadFolders, loadFolderBody]);

  /** Everything the agent (or a person) changes funnels through one refresh. */
  const refreshAll = useCallback(() => {
    void loadFolders();
    void loadFolderBody(selected);
  }, [loadFolders, loadFolderBody, selected]);

  const tree = useMemo<FolderNode[]>(() => buildFolderTree(folders ?? []), [folders]);
  const selectedFolder = folders?.find((f) => f.id === selected) ?? null;

  if (error) {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive-foreground rounded-lg border p-6 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,23rem)]">
      <FolderTree
        nodes={tree}
        loading={folders === null}
        selectedId={selected}
        onSelect={setSelected}
        onChanged={loadFolders}
      />

      <div className="min-w-0 space-y-4">
        {selectedFolder ? (
          <ProjectHero
            folder={selectedFolder}
            folders={folders ?? []}
            settings={settings}
            images={images}
          />
        ) : null}
        <FolderContents
          folder={selectedFolder}
          images={images}
          live={live}
          error={bodyError}
          onChanged={() => void loadFolderBody(selected)}
        />
        <FolderSettingsCard
          folderId={selected}
          folders={folders ?? []}
          settings={settings}
          onSaved={() => void loadFolderBody(selected)}
        />
      </div>

      {/* The agent sits where the user is already looking, so they watch the tree
          change while they talk. Below xl it moves under the folder rather than
          competing for width. */}
      <div className="xl:sticky xl:top-3 xl:self-start">
        <FolderAgentPanel folder={selectedFolder} onChanged={refreshAll} />
      </div>
    </div>
  );
}
