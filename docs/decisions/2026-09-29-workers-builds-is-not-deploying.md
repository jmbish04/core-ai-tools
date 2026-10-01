# Workers Builds on core-ai-tools: it deploys, and it was already applying migrations

- **Date:** 2026-09-29 (corrected 2026-09-30, corrected again 2026-10-01)
- **Status:** DECIDED and IMPLEMENTED — the live trigger now runs `pnpm run deploy:ci`
- **Raised by:** Claude (session_01HdpUxmx9TLnT9R47NdFPdZ)

## Read this before the rest: both of my original findings were wrong

This file has been wrong twice, in two different ways, and the corrections are the only
part of it worth keeping. Stated up front so nobody acts on a dead premise again:

1. **"Workers Builds is not deploying this Worker."** Wrong. It deploys every merge to
   `main`.
2. **"CI deploys code but never schema."** Also wrong, and this is the bigger error.
   The live trigger's deploy command was **`pnpm run deploy`**, which includes
   `migrate:deploy`. **CI has been applying D1 migrations on every deploy all along.**

### Why #1 was wrong

It came from reading `deployments[].source == "wrangler"` as "a person ran wrangler".
**Workers Builds deploys by running the wrangler CLI inside its build container.** So every
CI deploy is `source: "wrangler"`, `author_email: smart-home@126colby.com`,
`workers/triggered_by: version_upload` — indistinguishable from a laptop deploy by that
field, in either direction. I had earlier read `modified_on` moving as a positive; the same
class of mistake, opposite sign.

The discriminator that does work is the GitHub check run from the Cloudflare Workers and
Pages app (app id `85455`):

```
GET /repos/jmbish04/core-ai-tools/commits/53bd00a…/check-runs
→ name: "Workers Builds: core-ai-tools"   conclusion: success
  Build ID:   59d53926-a179-45cb-a67f-9a6a57cb9428
  Version ID: a2293181-76e4-47c3-8cf3-46f0d101b25f
```

That Version ID is the exact version `/workers/scripts/core-ai-tools/versions` reported as
`source: "wrangler"`. **Workers Builds built and deployed PR #13's merge. Merging to `main`
IS a deploy on this project.**

### Why #2 was wrong, and the lesson that generalises

I read these two lines out of `.github/scripts/configure_builds.py` and treated them as
live Cloudflare config:

```python
"build_command":  "pnpm run build",
"deploy_command": "npx wrangler deploy",
```

Then — in this same document — I proved that script **never executes in this repo**. Its
`main()` returns at the template guard:

```
target_name   = github_repository.rsplit("/", 1)[-1]   # core-ai-tools
template_name = detect_template_name()                 # package.json name: core-ai-tools
if template_name == target_name:
    print("Template repository detected; skipping autoconfiguration.")
    return
```

The `configure-ci-cd` job log for `e21e447` is exactly that one line and nothing else.
And I **kept quoting the dead file's values as live config anyway**, in the same file that
killed it.

> **Proving a source dead does not retract what you already derived from it.** Every claim
> descended from a dead source has to be re-derived or dropped, in the same pass that kills
> the source. That is the reusable lesson from this whole episode.

The session that owns `cloudflare-api-mcp` read the **actual** trigger on 2026-09-30:

```
build_command    ""                   <- EMPTY, not "pnpm run build"
deploy_command   "pnpm run deploy"    <- not "npx wrangler deploy"
```

`pnpm run deploy` is `build && cp .assetsignore dist/ && migrate:deploy && wrangler deploy`,
so CI was already building, copying `.assetsignore`, and applying migrations. That is why
all 18 migrations are applied on the production D1 with nobody having run `migrate:remote`
by hand — my "someone applied them manually" was an invention to explain data I had
mis-modelled.

### That error nearly broke CI

I asked for a **one-field** change (`deploy_command` → `pnpm run deploy:ci`), justified by
"`build_command` already runs `pnpm run build`". It was empty. `deploy:ci` deliberately does
not build and opens with `cp .assetsignore dist/.assetsignore`, so the single-field write
would have left nothing building and failed on its first command — while the config write
itself looked successful. The `cloudflare-api-mcp` session caught it and set both:

```
build_command    ""                 ->  "pnpm run build"
deploy_command   "pnpm run deploy"  ->  "pnpm run deploy:ci"
```

Rollback, if ever needed: `build_command ""` / `deploy_command "pnpm run deploy"`.

## The question that was actually asked

Should CI apply D1 migrations automatically on every merge to `main`?

(It already was. The question stands as asked, and the answer below is what shipped.)

## Options as presented

1. **`deploy_command: pnpm run deploy`** — matches the documented rule and the local command.
2. **A named `deploy:ci` script** — same effect without a second build when `build_command`
   is also set; one script referenced once, so the chain is not duplicated.
3. **Leave CI code-only and migrate by hand** — safest for the database, but every schema
   change needs someone at a terminal and a merge deploys code against the old schema.

## Decision

**2026-09-30 — Justin: yes, CI should apply migrations.** Shipped as option 2:

```
deploy:ci = cp .assetsignore dist/.assetsignore && pnpm run migrate:deploy && npx wrangler deploy
```

**Implemented 2026-10-01** by the `cloudflare-api-mcp` session, which set `build_command`
and `deploy_command` together (see above). Net behavioural change: **one fewer redundant
build.** Migrations were already being applied, so the migration half of this decision was
already true before it was decided — stated plainly rather than claimed as a fix.

Justin also asked for the migration files themselves to be made re-runnable. Shipped:

- `db:generate` chains the managed `fix-d1-migrations.mjs`, so new migrations are idempotent
  at birth.
- `scripts/check-migrations.mjs` gates `migrate:local` / `migrate:remote` / `migrate:deploy`
  and fails on any migration that is not re-runnable. It drives the managed fixer as a child
  process against a **copy** — importing it rewrites every file in `drizzle/` as a side
  effect, which it did once to 16 shipped migrations during a read-only measurement.
- The 16 already-shipped non-idempotent migrations are grandfathered in
  `scripts/migration-idempotency-baseline.txt` rather than rewritten, because rewriting a
  shipped migration is forbidden. The baseline fails **both ways**, so it also detects an
  edit to a shipped migration.
- 32 `ALTER TABLE ... ADD COLUMN` statements remain unguardable: SQLite has no
  `ADD COLUMN IF NOT EXISTS`. Reported, never silently skipped.

**The `configure_builds.py` change (PR #17) is committed and inert here.** It is still right
for a repo *generated from* this template, where the names differ and the function runs. It
has never affected `core-ai-tools`, whose trigger was created by some other route (the
dashboard, most likely).

## Who can change a build trigger — corrected

An earlier version of this file said a trigger change "needs the dashboard". Wrong, and the
`cloudflare-api-mcp` session disproved it by doing it:

- **`workers_cicd_configure` works** — it is served **locally** by that Worker and calls
  Cloudflare with a token that does reach `/builds/*`.
- The `12006 Invalid token` wall measured from this session is only about **`execute`**,
  which is forwarded **upstream** carrying an account-scoped token. Right surface, wrong
  generalisation.
- The whole `workers_*` tool family returns a result this session's client rejects
  (`missing required resultType`, MCP revision 2026-07-28). The owner session cannot
  reproduce it — but **that does not make it client-local, and I nearly wrote that it did.**
  Maestro `c34778a38547` already carried an independent reproduction from a *different*
  session (a core-delegation PR-triage sweep, on `workers_pr_build_logs_get`). Two
  independent strict clients reject it; one lenient client accepts it. That is what a server
  declaring revision 2026-07-28 while those handlers return the pre-revision envelope looks
  like, and "cannot reproduce" from a lenient client is consistent with the defect existing.
  Checking the task before answering is what caught this. `/builds/*` token confusion is
  `f14b1bca77ba`.

## Verification still owed

The config was proved by **reading it back**, not by running a build. The first build on
`main` after 2026-10-01 is the real proof. Confirm it the only reliable way:

```
GET /accounts/{id}/workers/scripts/core-ai-tools/deployments
→ newest entry's created_on + versions[].percentage == 100
```

**Never read a missing or inconclusive `Workers Builds` check run as evidence about whether
a deploy happened.** It is unreliable on this Worker in both directions — absent entirely
for `e21e447` and `7c654c9`, stuck `in_progress` for ten minutes on `8e06245` after its
deploy was already live at 100%. Use the check run to **attribute** a deploy to CI; use
`/deployments` to confirm one landed.

The migration ledger is readable from a sandbox, without a user-scoped token:

```
POST /accounts/{id}/d1/database/98b592ba-c5a3-47f4-950d-77a108b8d613/query
{ "sql": "SELECT name, applied_at FROM d1_migrations ORDER BY id" }
```
