/**
 * @fileoverview `/api/revisions` — submit/fork/retry + lifecycle, zod-openapi.
 * Handlers throw on error (global onError maps). `idempotency_key` via header or body.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import {
  approveRevision,
  cancelRevision,
  createCoreContext,
  executeRevision,
  forkRevision,
  pinRevision,
  rejectRevision,
  retryRevision,
  submitEdit,
} from "@/backend/core";

export const revisionsRouter = new OpenAPIHono<{ Bindings: Env }>();
const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };
const jsonBody = <T extends z.ZodTypeAny>(schema: T) => ({ content: { "application/json": { schema } } });
const idParam = z.object({ id: z.string() });

const EditFields = {
  promptText: z.string().optional(),
  editPayload: z.any(),
  requestedModel: z.string(),
  provider: z.string().nullish(),
  maskId: z.string().nullish(),
  maskMode: z.enum(["none", "inpaint", "preserve"]).optional(),
  idempotencyKey: z.string().nullish(),
  createdVia: z.enum(["ui", "api", "mcp"]).optional(),
};
const idem = (c: Context, k?: string | null) => k ?? c.req.header("Idempotency-Key") ?? null;

/**
 * Fire-and-forget execution for a freshly-`queued` revision. The revision is
 * returned to the caller immediately; execution runs in the background and its
 * progress reaches the UI via the session's realtime events. Without this, a
 * submitted edit sits in `queued` forever (nothing else picks up the seam).
 * `awaiting_approval` revisions are NOT auto-run — they execute on approval.
 */
function autoExecute(c: Context, rev: unknown): void {
  const r = rev as { id?: string; status?: string };
  if (r?.status === "queued" && r.id) {
    c.executionCtx.waitUntil(
      executeRevision(createCoreContext(c.env), { revisionId: r.id, surface: "api" }).catch((err) =>
        console.error("[revisions] auto-execute failed:", err instanceof Error ? err.message : String(err)),
      ),
    );
  }
}

revisionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/revisions",
    tags: ["revisions"],
    request: { body: jsonBody(z.object({ sessionUuid: z.string(), parentRevisionId: z.string(), ...EditFields })) },
    responses: ok,
  }),
  async (c) => {
    const b = c.req.valid("json");
    const rev = await submitEdit(createCoreContext(c.env), { ...b, idempotencyKey: idem(c, b.idempotencyKey), createdVia: b.createdVia ?? "api" });
    autoExecute(c, rev);
    return c.json(rev);
  },
);

revisionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/revisions/fork",
    tags: ["revisions"],
    request: { body: jsonBody(z.object({ fromRevisionId: z.string(), ...EditFields })) },
    responses: ok,
  }),
  async (c) => {
    const b = c.req.valid("json");
    const rev = await forkRevision(createCoreContext(c.env), { ...b, idempotencyKey: idem(c, b.idempotencyKey) });
    autoExecute(c, rev);
    return c.json(rev);
  },
);

revisionsRouter.openapi(
  createRoute({ method: "post", path: "/api/revisions/{id}/retry", tags: ["revisions"], request: { params: idParam }, responses: ok }),
  async (c) => {
    const rev = await retryRevision(createCoreContext(c.env), { revisionId: c.req.valid("param").id, idempotencyKey: idem(c), createdVia: "api" });
    autoExecute(c, rev);
    return c.json(rev);
  },
);

revisionsRouter.openapi(
  createRoute({ method: "post", path: "/api/revisions/{id}/pin", tags: ["revisions"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await pinRevision(createCoreContext(c.env), { revisionId: c.req.valid("param").id })),
);

revisionsRouter.openapi(
  createRoute({ method: "post", path: "/api/revisions/{id}/cancel", tags: ["revisions"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await cancelRevision(createCoreContext(c.env), c.req.valid("param").id)),
);

revisionsRouter.openapi(
  createRoute({ method: "post", path: "/api/revisions/{id}/execute", tags: ["revisions"], request: { params: idParam }, responses: ok }),
  async (c) => c.json(await executeRevision(createCoreContext(c.env), { revisionId: c.req.valid("param").id, surface: "api" })),
);

revisionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/revisions/{id}/approve",
    tags: ["revisions"],
    request: { params: idParam, body: jsonBody(z.object({ surface: z.enum(["ui", "api", "mcp"]).default("api") })) },
    responses: ok,
  }),
  async (c) => {
    const rev = await approveRevision(createCoreContext(c.env), { revisionId: c.req.valid("param").id, approvedBySurface: c.req.valid("json").surface });
    autoExecute(c, rev);
    return c.json(rev);
  },
);

revisionsRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/revisions/{id}/reject",
    tags: ["revisions"],
    request: { params: idParam, body: jsonBody(z.object({ reason: z.string().nullish(), surface: z.enum(["ui", "api", "mcp"]).default("api") })) },
    responses: ok,
  }),
  async (c) => {
    const b = c.req.valid("json");
    return c.json(await rejectRevision(createCoreContext(c.env), { revisionId: c.req.valid("param").id, rejectionReason: b.reason, rejectedBySurface: b.surface }));
  },
);
