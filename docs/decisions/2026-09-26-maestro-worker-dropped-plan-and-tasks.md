---
date: 2026-09-26
status: open
owner: Justin
tags: [colby-maestro, control-plane, data-loss]
---

# Colby Maestro's Worker silently dropped a whole project's plan and 27 tasks

## What happened

Between 18:59 and 19:15 today I filed, through the Maestro **Worker** MCP connector
(`mcp__<uuid>__execute` → `codemode.request`), for `project_key: core-ai-tools`:

- one plan — `40b751e01189`, "ReUI frontend rebuild + folder/asset/agent platform",
  returned with a console URL and a revision id;
- 5 epics and 22 child tasks — every one returning `status: ok` with a real task id;
- one successful claim on `9ef99476b06e` (claim key issued, expiry set).

Roughly ten minutes later, all of it was gone from the Worker:

```
GET /api/plans/40b751e01189        → {"status":"error","error":"Unknown plan_id: 40b751e01189"}
GET /api/tasks/9ef99476b06e        → {"status":"error","error":"Unknown task_id: 9ef99476b06e"}
GET /api/tasks?project_key=core-ai-tools → {"status":"ok","tasks":[],"task_tree":[]}
GET /api/tasks?project_key=core-ai-tools&include_deleted=true → 0 rows
GET /api/projects                  → 23 projects, core-ai-tools NOT among them
```

Other projects are unaffected — `core-sg-data`, `colby-maestro`, `core-guardian` and
`colby-ecosystem` all still return tasks.

**The work is not lost.** The local SQLite mirror still holds all 27 rows:

```
GET http://127.0.0.1:4318/api/tasks?project_key=core-ai-tools → 27 tasks, all status=backlog
```

So the Worker is missing rows the mirror has. `com.colby.maestro` is running (pid 51145).
Note the statuses: my two `done` transitions never landed — the PATCH failed with
`Unknown task_id` at a point when the row still existed minutes earlier.

## Why it matters to you

1. **A write that returns `ok` with an id is not proof of durability.** Every agent on
   this machine files work through that connector and then moves on. If records can
   disappear ten minutes later, "it is in Maestro" stops meaning anything — and nobody
   would notice until they looked, which is how `core-ai-tools` would have quietly
   become a project with no plan behind 3,000 lines of shipped code.
2. **It is silent.** No error, no partial write, no 5xx. The failure only shows if you
   re-read what you wrote.
3. **It contradicts the documented model.** `~/AGENTS-maestro.md` says the Worker is the
   source of truth and the mirror is the convenience copy. Today the mirror is the only
   copy, which is the exact inversion the file warns against.

I have not tried to repair it myself: a blind re-file could collide with whatever the
reconciler does on its next pass, and a project-shaped hole in the control plane is
worth understanding before it is papered over.

## Update, ~90 minutes later — the diagnosis above was incomplete

Watching it for another hour showed a cycle, not a one-off deletion:

1. All 27 tasks came back on their own, from the local mirror — but **stripped**: no plan
   links, no worklog entries, no claim.
2. I re-filed the plan as `6f2df993d527` and relinked the epics to it. That worked.
3. A cycle later, `6f2df993d527` was gone and the ORIGINAL `40b751e01189` was back,
   alive, at revision 1, with all 27 tasks linked to its sections again.
4. My task status updates were reverted with it: ten tasks I had marked `done` were
   `backlog` again. Re-applying them worked, and one (`W1.1`) still errored.

So the earlier claim in this file — "plans are not mirrored" — is **wrong**, and I am
correcting it rather than leaving it to mislead. What the evidence actually shows is that
the local mirror periodically pushes its own snapshot over the Worker, and that snapshot
wins: Worker-side writes it does not know about are reverted (my statuses, my new plan),
and rows it still holds are restored (the "deleted" plan and tasks). The first symptom —
a whole project vanishing — fits a push from a moment when the mirror had never heard of
`core-ai-tools`, because the project was created Worker-side.

That makes this worse than a lost record, and worth saying plainly: **a write through the
documented door can be silently undone minutes later.** Every agent on this machine files
status through that door and then moves on. Nothing errors. The only way to notice is to
re-read what you wrote, which nobody does.

It also puts `~/AGENTS-maestro.md` in a bind it does not acknowledge: it says the Worker
is the source of truth and to never write tracking state through the local server — but
in practice the local mirror is overwriting the Worker, and the local server cannot send
a plan heading, which the Worker now requires.

## The question

Do you want this chased in the `colby-maestro` repo now, and how should I re-file this
project's plan in the meantime?

## Options

1. **(Recommended) Fix the reconciler in `colby-maestro` so a mirror push cannot revert
   a newer Worker write, and open a bug with this timeline.** The mirror's job is to keep
   an agent from blocking on a round trip, not to arbitrate truth. A per-row
   `updated_at` comparison in the push direction — or simply not deleting Worker rows the
   mirror has never seen — would close both symptoms. This is the only option that makes
   "it is in Maestro" mean something again, for every project, not just this one.
2. **Make the reconciler one-way (Worker → mirror only) until that lands.** Smaller, and
   it stops the data loss immediately, but any work an agent files while the Worker is
   unreachable would then be dropped rather than replayed.
3. **Live with it and re-read after every write.** Zero work on the control plane, and it
   pushes the cost onto every agent forever — including the ones that will not remember
   to check.

## What I will do if you say nothing

Nothing further to the control plane. The plan and all 27 tasks are currently alive on
the Worker at `40b751e01189`, linked and with Wave 1-2 marked done. I will keep filing
status there as normal, and I will re-read after each batch — but I will not re-file a
third copy of anything, because a second plan is how this project ended up with two.

## Decision

_(pending)_
