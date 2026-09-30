# Workers Builds on core-ai-tools: it DOES deploy, but its deploy command skips migrations

- **Date:** 2026-09-29 (corrected 2026-09-30)
- **Status:** DECIDED 2026-09-30, but NOT YET EFFECTIVE — needs a Cloudflare-side change
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

**2026-09-30 — Justin: yes, CI should apply migrations.** Implemented as option 2 rather
than option 1, because option 1's cost turned out to be avoidable: the build trigger
already sets `build_command: pnpm run build`, so `pnpm run deploy` would have built twice.
A named `deploy:ci` script gets the same result without the rebuild, and because it is one
script referenced once it does not duplicate the chain in two places — which was the only
objection to option 2 above.

```
deploy:ci = cp .assetsignore dist/.assetsignore && pnpm run migrate:deploy && npx wrangler deploy
```

Justin also asked for the migration files themselves to be made re-runnable as part of the
migrate flow. Shipped:

- `db:generate` now chains the managed `fix-d1-migrations.mjs`, so new migrations are
  idempotent at birth.
- `scripts/check-migrations.mjs` gates `migrate:local` / `migrate:remote` /
  `migrate:deploy` and fails on any migration that is not re-runnable.
- The 16 already-shipped non-idempotent migrations are grandfathered in
  `scripts/migration-idempotency-baseline.txt` rather than rewritten, because rewriting a
  shipped migration is forbidden. The baseline fails both ways, so it also detects an edit
  to a shipped migration.
- 32 `ALTER TABLE ... ADD COLUMN` statements remain unguardable: SQLite has no
  `ADD COLUMN IF NOT EXISTS`. Reported, never silently skipped.

**The script change is merged (PR #17) and is inert. It does not fix this repo.**

`configure_builds.py` never reaches `register_workers_builds` here. Its `main()` returns at:

```
target_name   = github_repository.rsplit("/", 1)[-1]   # core-ai-tools
template_name = detect_template_name()                 # package.json name: core-ai-tools
if template_name == target_name:
    print("Template repository detected; skipping autoconfiguration.")
    return
```

The `configure-ci-cd` job log for `e21e447` contains exactly that one line and nothing else.
Because this repo's `package.json` name equals its GitHub repo name, the guard fires on
every push. So the earlier claim in AGENTS.md — that the script re-asserts the trigger on
every push — was wrong, and the trigger for `core-ai-tools` was configured by some other
route (dashboard, most likely).

The committed change is still right for a repo *generated from* this template, where the
names differ and the function does run. It simply has no effect here.

**Outstanding, needs Justin — one Cloudflare-side change:** set the live trigger's deploy
command to `pnpm run deploy:ci`, leaving the build command as `pnpm run build`.

1. **Dashboard** (no token needed): Workers & Pages → core-ai-tools → Settings → Build →
   Deploy command → `pnpm run deploy:ci`.
2. **MCP** `workers_cicd_configure` — returns a malformed MCP result for the whole
   `workers_*` family in this session, so it needs a client where that works.
3. **API** `PATCH /accounts/{id}/builds/triggers/{uuid}` — needs
   `CLOUDFLARE_USER_WRANGLER_API_TOKEN`; every token available here returns 12006 on
   `/builds/*`.

Until one of those happens, CI still deploys code without applying migrations, and
`0015`/`0016`/`0017` stay pending. The proof it worked is
`npx wrangler d1 migrations list DB --remote` coming back empty.

**Separate, and my hypothesis here was wrong — corrected the same hour.** I first wrote
that PR #17 (`.github/` only) produced no build and guessed a path filter. PR #18 touched no
`.github/` file and behaved identically, so that is falsified. What actually happens: the
`Workers Builds` check run is unreliable on this Worker in BOTH directions — absent entirely
for `e21e447` and `7c654c9`, and stuck `in_progress` for ten minutes on `8e06245` after its
deploy was live — while the deploy itself still lands. Version `017c96b1` deployed at
14:31:11Z, three minutes after the #18 merge, with no check run for the commit.

So CI **is** building and deploying. `/deployments` is the only reliable signal; never read a
missing or inconclusive check run as evidence about whether a deploy happened.
