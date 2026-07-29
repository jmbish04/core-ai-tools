/**
 * @fileoverview `/api/video/:id` — Worker-proxied video delivery (Range + 410 on
 * purge) + `PATCH /api/assets/:id/ttl`. Delivery is a raw handler (streamed
 * body); the TTL route is zod-openapi.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/backend/db";
import { libraryImages } from "@/backend/db/schema";
import { createCoreContext, setAssetTtl } from "@/backend/core";

export const videoRouter = new OpenAPIHono<{ Bindings: Env }>();

// Binary delivery with Range — raw (streamed body, not JSON).
videoRouter.get("/api/video/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const [asset] = await db
    .select()
    .from(libraryImages)
    .where(and(eq(libraryImages.id, id), eq(libraryImages.mediaType, "video")))
    .limit(1);

  if (!asset) return c.json({ error: "Video not found", code: "not_found" }, 404);
  if (asset.bytesPurgedAt) {
    return c.json(
      { error: "This video expired and its bytes were purged. Regenerate to recreate it.", code: "gone", purgedAt: asset.bytesPurgedAt },
      410,
    );
  }
  if (!asset.r2Key) return c.json({ error: "No R2 object", code: "not_found" }, 404);

  const range = c.req.header("Range");
  if (range) {
    const obj = await c.env.R2_VIDEO_BUCKET.get(asset.r2Key, { range: parseRange(range) });
    if (!obj) return c.json({ error: "Object missing", code: "not_found" }, 404);
    const size = obj.size ?? asset.bytes ?? 0;
    const headers = new Headers();
    obj.writeHttpMetadata?.(headers);
    headers.set("Accept-Ranges", "bytes");
    if (obj.range && "offset" in obj.range) {
      const start = obj.range.offset ?? 0;
      const length = obj.range.length ?? size - start;
      headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${size}`);
    }
    return new Response(obj.body as unknown as BodyInit, { status: 206, headers });
  }

  const obj = await c.env.R2_VIDEO_BUCKET.get(asset.r2Key);
  if (!obj) return c.json({ error: "Object missing", code: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata?.(headers);
  headers.set("Accept-Ranges", "bytes");
  return new Response(obj.body as unknown as BodyInit, { status: 200, headers });
});

function parseRange(header: string): { offset: number; length?: number } | undefined {
  const m = /bytes=(\d+)-(\d*)/.exec(header);
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined ? { offset: start, length: end - start + 1 } : { offset: start };
}

videoRouter.openapi(
  createRoute({
    method: "patch",
    path: "/api/assets/{id}/ttl",
    tags: ["video"],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: z.object({ ttlDays: z.number().nullable(), surface: z.enum(["ui", "api", "mcp"]).default("api") }) } } },
    },
    responses: { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } },
  }),
  async (c) => {
    const b = c.req.valid("json");
    return c.json(await setAssetTtl(createCoreContext(c.env), { assetId: c.req.valid("param").id, ttlDays: b.ttlDays, surface: b.surface }));
  },
);
