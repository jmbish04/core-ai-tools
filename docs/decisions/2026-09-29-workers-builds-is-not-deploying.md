# Workers Builds on core-ai-tools: it DOES deploy, but its deploy command skips migrations

- **Date:** 2026-09-29 (corrected 2026-09-30)
- **Status:** open — needs Justin (one decision, below)
- **Raised by:** Claude (session_01HdpUxmx9TLnT9R47NdFPdZ)

## Correction first: my original finding here was wrong

This file previously said "Workers Builds is not deploying this Worker." **That was wrong,
and so was the AGENTS.md rule I wrote from it.** Both errors came from one bad assumption:
that `deployments[].source == "wrangler"` means a person ran wrangler.

**Workers Builds deploys by running the wrangler CLI inside its build container.** So every
CI deploy is `source: "wrangler"`, `author_email: smart-home@126colby.com`,
`workers/triggered_by: version_upload` — indistinguishable from a laptop deploy by that
field, in either direction. I read the field as a negative the way I had earlier read
`modified_on` as a positive; the field never supported either reading.

**The discriminator that does work** is the GitHub check run, from the Cloudflare Workers and
Pages app (app id `85455`):

```
GET /repos/jmbish04/core-ai-tools/commits/53bd00a…/check-runs
→ name: "Workers Builds: core-ai-tools"   conclusion: success
  Build ID:   59d53926-a179-45cb-a67f-9a6a57cb9428
  Version ID: a2293181-76e4-47c3-8cf3-46f0d101b25f
```

That Version ID is the exact version `/workers/scripts/core-ai-tools/versions` reported as
`source: "wrangler"` at 21:09:50Z. **Workers Builds built and deployed PR #13's merge
successfully. Merging to `main` IS a deploy on this project.**

## The real finding: CI deploys code, never schema

`.github/scripts/configure_builds.py` (line 318) sets:

```python
"build_command":  "pnpm run build",
"deploy_command": "npx wrangler deploy",
```

A bare `npx wrangler deploy` does work here — `wrangler.jsonc` carries `main` and
`assets.directory`. But `package.json`'s own `deploy` script is:

```
pnpm run build && cp .assetsignore dist/.assetsignore && pnpm run migrate:deploy && npx wrangler deploy
```

So CI skips two steps a human running `pnpm run deploy` performs:

1. **`migrate:deploy`** — `wrangler d1 migrations apply DB --remote`. CI has never applied a
   migration. This is why `0015` can sit unapplied against production D1 while every merge
   deploys green. New code booting against an un-migrated database is exactly what
   AGENTS.md's "migrations run before the deploy" rule exists to prevent.
2. **`cp .assetsignore dist/.assetsignore`** — without it the asset upload is not filtered as
   the repo intends.

AGENTS.md already states the rule ("Point Workers Builds at `pnpm run deploy`"); the
autoconfig script contradicts it, and **re-POSTs a new trigger on every push to `main`** (17
successful runs), so fixing the trigger by hand or via `workers_cicd_configure` gets
overwritten on the next merge. The fix belongs in the script.

## The question

Should CI apply D1 migrations automatically on every merge to `main`?

## Options

1. **Set the script's `deploy_command` to `pnpm run deploy`** (recommended). One-line change;
   CI then matches the documented rule and the local command exactly. `migrate:deploy`
   applies only committed migrations, never generates one, so it is the CI-safe form
   AGENTS.md already endorses. Cost: the next merge applies `0015` to production D1 without
   anyone watching. It is additive (2 tables, 10 ADD COLUMN, 1 index), but it is still a
   production schema change triggered by a merge.
2. **`npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`** — same effect,
   skips the double build that `pnpm run deploy` causes when the build command is also set.
   Slightly faster; duplicates the chain in two places, which is how they drift.
3. **Leave CI code-only and apply migrations by hand.** Safest for the database, but every
   schema change needs you at a terminal, and a merge that needs a migration will deploy
   code against the old schema in the meantime — silently.

## Default if I hear nothing

I will not change the deploy command. AGENTS.md now records that CI deploys code but not
schema, so no future session reports a merge as a full deploy or assumes migrations ran.

## Decision

_(awaiting Justin)_
