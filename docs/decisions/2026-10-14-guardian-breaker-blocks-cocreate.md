---
date: 2026-10-14
status: decided
owner: Justin
tags: [core-guardian, ai-routing, budget, core-ai-tools, cocreate]
---

# core-guardian's breaker refuses every core-ai-tools Gemini call, so the co-creator cannot run live

## What happened

The new prompt co-creator (`/cocreate`) sends four kinds of text call to the
`understand` model (belief graph, clarifying questions, refine, consultant) and uses
`image_generate` for pictures. All of them go through `dispatch`, which routes Gemini
through core-guardian.

To check the model's replies match the co-creator's JSON schemas, I sent the exact
instructions through guardian's metered door on 2026-10-14. Guardian refused both
times, before any model ran:

```
429 {"isCircuitBreaker":true,"circuitBrokenMessage":"project core-ai-tools has usage-based fallback disabled"}
request_uuid 854d2e79-e9c4-4b2f-aaa7-bbc12b5b39cf (importance low)
request_uuid 7ca5050d-44a3-4b4c-96bb-2d4db4b7f42f (importance medium — the production adapter's value)
```

## Why it matters to you

The production adapter (`providers/google-image.ts`) surfaces a 429 breaker as an
error — it only falls back to a direct call on guardian's 422 "not priceable". So,
until this changes, every co-creator step that needs the model (Analyze, Different
questions, Refine, Generate, Ask the consultant) will show this error. It almost
certainly blocks the existing Gemini edit/generate paths too; I did not test those.

Everything that needs no model works and is verified: sessions, the version log and
diffs, answering/skipping, importing answers across sessions, archive.

## The question

Should core-ai-tools be allowed usage-based spend through guardian, so its Gemini calls run?

## Options

1. **Enable usage-based fallback for project `core-ai-tools` in guardian** (recommended).
   Calls run, stay metered and stay under the breaker. Smallest change; it is the
   control working as configured, just configured off.
2. Raise or reset the project's included budget instead, if the breaker means "quota spent".
3. Leave it off. The co-creator stays a record-keeping tool until you change it.

Not an option: sending the calls direct or under another project name to dodge the
breaker. That escapes the spend control the breaker exists for.

## What I will do if you say nothing

Nothing further — the PR ships the feature with the model steps erroring loudly, not
silently. The first live run after you flip the setting is the remaining check:
analyze one prompt and confirm the graph and questions render.

## Decision

**2026-10-14, Justin:** "core-ai-tools should ONLY use core-guardian as its singular ai
source."

What that resolved, measured the same day:

- The 429 is guardian's project policy, not a spent budget: `GET /api/guardian/projects/core-ai-tools`
  → `allowUsageBasedFallback: false`, `spendThisMonthUsd: 0`, no circuit tripped. Guardian
  documents the flag as "whether a project may use metered API providers as last resort".
  Pinning `provider: google` asks for a metered provider, so it is refused.
- With NO provider/model pinned, guardian routes core-ai-tools to `ollama/glm-5.3` at
  $0.00. All four co-creator instructions (graph, questions, refine, consultant) returned
  valid output that way.
- **Done:** the co-creator's text calls now go only to guardian's router, unpinned, with no
  fallback (`core/cocreate/ai.ts`). A missing binding or a refusal is an error.
- **Still blocked:** image generation. Guardian has no free image route for this project
  (its `image_editing` use case maps only to text LLMs), and Gemini/OpenAI image models are
  metered. Images need either `allowUsageBasedFallback: true` for core-ai-tools (still
  guardian-only — it permits metered providers *through* guardian), or a free image route in
  guardian.
- **Not yet aligned with the decision (outside the co-creator):** `providers/google-image.ts`
  falls back to a direct Gemini SDK call when guardian answers 422 "not priceable" or is
  unreachable, and `providers/openai-image.ts` calls OpenAI through AI Gateway, never
  guardian (OpenAI is the `image_edit` default). Raised separately for a decision.

Status: decided.
