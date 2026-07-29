/**
 * @fileoverview Login island — posts the worker key to `/api/auth/login`, which
 * sets the signed session cookie. On success, navigates to `next` (the page the
 * user was gated away from). Single-owner auth: the only credential is the
 * WORKER_API_KEY.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next: string }) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      if (res.ok) {
        // Relative redirect only — never bounce to an attacker-supplied origin.
        window.location.href = next.startsWith("/") ? next : "/";
        return;
      }
      setError(res.status === 401 ? "Incorrect key." : `Sign-in failed (${res.status}).`);
    } catch {
      setError("Network error — try again.");
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-card p-6 ring-1 ring-border/40"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Enter the worker key to access core-ai-tools.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="worker-key" className="text-sm font-medium">
          Worker key
        </label>
        <input
          id="worker-key"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full rounded-lg bg-background px-3 py-2 text-sm outline-none ring-1 ring-border/40 focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="WORKER_API_KEY"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !apiKey} aria-busy={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
