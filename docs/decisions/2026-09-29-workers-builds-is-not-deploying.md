# Workers Builds is not deploying core-ai-tools

- **Date:** 2026-09-29
- **Status:** open — needs Justin
- **Raised by:** Claude (session_01HdpUxmx9TLnT9R47NdFPdZ)

## What happened

PR #12 merged to `main` at 16:01 UTC. Two hours later the Worker's `modified_on` was
still `2026-09-28T19:00:28Z` — the previous day. No deploy fired.

Reading the deployment history rather than inferring from the timestamp:

```
GET /accounts/{id}/workers/scripts/core-ai-tools/deployments
→ every entry: source: "wrangler", author_email: "smart-home@126colby.com"
  2026-09-28T19:00:26Z · 19:00:07Z · 17:29:57Z · 17:29:19Z
last_deployed_from: "wrangler"
```

**Not one deployment came from a build.** So Workers Builds is either not connected, not
triggering, or failing — and merging to `main` is not a deploy on this project.

This also corrects an inference I recorded in `AGENTS.md` earlier the same week: I saw
`modified_on` move 90 seconds after PR #11 merged and wrote that the merge "deployed
through Workers Builds". It did not. That was a human or agent running `wrangler deploy`
around the same moment — correlation read as causation, and it went into the briefing as
a rule.

## Why it matters

PR #12 ships **no runtime code** (0 files under `src/`; it is `scripts/`, `AGENTS.md` and
`.claude/settings.json`), so nothing is stale *because of this PR*. The cost is for the
next change that does touch `src/`: it will merge green, look deployed, and not be.

## Why I could not fix or diagnose it

- `pnpm run deploy` in this container: the build succeeds, then `migrate:deploy` fails —
  `it's necessary to set a CLOUDFLARE_API_TOKEN environment variable`. No token here and
  no `tokens` CLI (`which tokens` → nothing).
- The deployed host is firewalled from this container: `curl https://core-ai-tools.hacolby.workers.dev/health`
  → `CONNECT tunnel failed, response 403`.
- The build status that would say *why* is behind `/builds/*`, which returns
  `401 / 12006 Invalid token` for the account-scoped credential the Cloudflare connector
  carries. It needs `CLOUDFLARE_USER_WRANGLER_API_TOKEN` (see maestro `c9c075bd52a7`).

## The question

Should Workers Builds be the deploy path for `core-ai-tools`, or is `wrangler deploy` from
your Mac the intended mechanism?

## Options

1. **Fix Workers Builds** (recommended). With `CLOUDFLARE_USER_WRANGLER_API_TOKEN` exported,
   `workers_cicd_get` / `workers_builds_list` say whether a trigger exists and whether
   builds are failing. If the deploy command is stored as the stock `npx wrangler deploy`,
   that is the known break for this Astro SSR Worker — it must be `pnpm run deploy`.
2. **Decide it is manual** and say so in `AGENTS.md`, so no future session reports a merge
   as a deploy. Cheapest, but every runtime change then needs you at a terminal.
3. **Leave it.** Next runtime change silently does not ship.

## Default if you say nothing

I will not report a merge as a deploy, and `AGENTS.md` now says merging is not a deploy
here. Nothing else changes.

## Decision

_(awaiting Justin)_
