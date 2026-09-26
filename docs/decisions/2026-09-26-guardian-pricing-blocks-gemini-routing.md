---
date: 2026-09-26
status: open
owner: Justin
tags: [core-guardian, ai-routing, pricing, core-ai-tools]
---

# core-guardian cannot price our pinned image models, so Gemini calls fall back to direct

## What happened

`core-ai-tools` now routes its Gemini image calls through core-guardian's AI router
(`GuardianRpc.run` over the existing `GUARDIAN` service binding, `mode: "gateway"`,
which targets `v1beta/interactions` — the API our adapter actually uses). The wiring
is deployed and proven: guardian validates our payload, executes the request, and
returns a verdict.

The verdict today is a refusal. Guardian's router fails closed on any `provider:
"google"` call whose model it cannot price:

```
422 {"error":"Model \"gemini-3.1-flash-image\" is not priceable in the catalog; ..."}
```

Measured 2026-09-26 against the live guardian: `GET /api/ai-router/pricing` returns
171 rows, 18 of them image models, keyed by **display name** — `Gemini 2.5 Flash
Image (Nano Banana)`, `Gemini 3 Pro Image (Nano Banana Pro)`. Neither of our pinned
ids (`gemini-3.1-flash-image`, `gemini-3-pro-image`) resolves, and
`POST /api/ai-models/registry/sync` did not change that (`changed: false`, google
scope 39 rows). `gpt-image-2.5-flare` / `-sunburst` are absent from guardian's
registry entirely (`{"group":null,"cheapestConfigured":null}`).

So every Gemini call currently takes the fallback path described below, and OpenAI
usage records come back `priced: "unmatched"`.

## Why it matters to you

Three consequences, in order of how much they cost you:

1. **Spend on image generation is not being priced by guardian.** Usage records
   still land through `POST /api/guardian/usage/register`, but with no catalog match
   guardian cannot attach a cost, so the image spend does not show up in the
   budget/breaker numbers you rely on.
2. **The circuit breaker cannot protect these calls.** A breaker only bites on the
   routed path. On the fallback path there is nothing between this worker and Gemini.
3. **It is not visible unless you read the logs.** The fallback is deliberately
   loud in `wrangler tail` (`[guardian] <model> is not priceable …`), but nothing
   surfaces it in a dashboard.

I deliberately did **not** invent prices to make the 422 go away. Prices are billing
data; a guessed number would quietly corrupt every cost report built on it.

## The behaviour I shipped in the meantime

A 422 "not priceable" is guardian saying *"I cannot meter this"*, which is different
from *"you may not spend"*. They are now handled differently
(`src/backend/ai/providers/google-image.ts`):

- **422 + "not priceable"** → log loudly, fall back to the direct Gemini call, keep
  emitting `usage/register` exactly as before routing existed. Availability preserved.
- **Anything else (429 breaker trip, budget rejection, provider fault)** → surfaced
  as an error. A spend control is never bypassed.

## The question

How do you want guardian to learn the prices for these five model ids —
`gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`,
`gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`?

## Options

1. **(Recommended) Fix it in core-guardian: make `canPrice` resolve ids through the
   model registry's aliases, then inject the missing per-image rates.** Guardian
   already knows these models in its *registry* (`/api/ai-models/registry/lookup`
   returns `Nano Banana 2` for `gemini-3.1-flash-image`); it is only the *pricing*
   lookup that misses. That makes this a guardian-side bug plus a data top-up via
   `POST /api/ai-router/pricing/inject`, and it fixes every consumer at once, not
   just this worker. Needs you (or a session in that repo) to supply the real rates.
2. **Inject prices only, leave the id matching alone.** Faster, but the rates must
   be keyed exactly as our pinned ids, and the next model id we pin regresses to the
   same 422.
3. **Leave the fallback in place and accept unpriced image spend.** Zero work.
   Acceptable only while image volume is low — and it keeps the breaker blind.

## What I will do if you say nothing

Nothing further. The fallback keeps generation working and keeps emitting usage, and
the loud log is the signal. I will not inject prices on my own, and I will not remove
the fallback (that would take image generation down over a catalog gap).

## Decision

_(pending)_
