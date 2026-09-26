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

## The question

Do you want this chased in the `colby-maestro` repo now, and how should I re-file this
project's plan in the meantime?

## Options

1. **(Recommended) Re-file into the Worker, then verify it survives two reconcile
   cycles (~10 min), and open a bug in `colby-maestro` with this evidence.** Cheap,
   restores the plan, and the verification step is the thing that was missing the first
   time. If it vanishes again, that is a reproducible bug with a timestamped trail.
2. **Leave the records in the local mirror and let the reconciler push them up.** Zero
   work, but it assumes mirror→Worker replication works for a project the Worker has
   never heard of — which is precisely what is in doubt.
3. **Treat the local mirror as authoritative for this project and stop writing to the
   Worker for it.** Fastest, and wrong in the long run: it is the drift
   `~/AGENTS-maestro.md` exists to prevent, and no other session or device would see
   the work.

## What I will do if you say nothing

Option 1, minus the bug report: re-file the plan and the 27 tasks into the Worker and
re-read them after two reconcile cycles. If they hold, I carry on and mention it. If
they vanish again, I stop writing to the Worker for this project and tell you, rather
than filing the same records a third time.

## Decision

_(pending)_
