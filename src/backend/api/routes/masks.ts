/**
 * @fileoverview `/api/masks` — REST endpoints for creating and listing masks.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createCoreContext, createMask, listMasks, uploadImageBytes } from "@/backend/core";

/** Decode a base64 PNG (no data: prefix) to an ArrayBuffer. */
function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export const masksRouter = new OpenAPIHono<{ Bindings: Env }>();

const ok = { 200: { description: "ok", content: { "application/json": { schema: z.any() } } } };

masksRouter.openapi(
  createRoute({
    method: "post",
    path: "/api/masks",
    tags: ["masks"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              sessionUuid: z.string().nullish(),
              sourceImageId: z.string(),
              kind: z.enum(["bbox", "polygon", "raster", "semantic"]),
              geometry: z.any(),
              cfImageId: z.string().nullish(),
              /** Base64 PNG (no data: prefix) of a painted raster mask; uploaded
               * to CF Images server-side and stored as the mask's cf_image_id. */
              rasterPngBase64: z.string().nullish(),
              featherPx: z.number().optional(),
              label: z.string().nullish(),
              coverageRatio: z.number().nullish(),
              derivedFromMaskId: z.string().nullish(),
              state: z.enum(["proposed", "confirmed", "rejected"]).optional(),
            }),
          },
        },
      },
    },
    responses: ok,
  }),
  async (c) => {
    const { rasterPngBase64, ...body } = c.req.valid("json");
    // A painted raster mask: upload the PNG to CF Images and store its id so the
    // mask captures exact pixels (circle/freeform), not just a bounding box.
    let cfImageId = body.cfImageId ?? null;
    if (rasterPngBase64) {
      const up = await uploadImageBytes(c.env, b64ToBytes(rasterPngBase64), {
        filename: `mask-${body.sourceImageId}.png`,
        metadata: { kind: "mask" },
      });
      cfImageId = up.cfImageId;
    }
    const mask = await createMask(createCoreContext(c.env), {
      ...body,
      cfImageId,
      createdVia: "ui",
    });
    return c.json(mask);
  },
);

masksRouter.openapi(
  createRoute({
    method: "get",
    path: "/api/masks",
    tags: ["masks"],
    request: {
      query: z.object({
        sessionUuid: z.string().optional(),
      }),
    },
    responses: ok,
  }),
  async (c) => {
    const q = c.req.valid("query");
    const masksList = await listMasks(createCoreContext(c.env), {
      sessionUuid: q.sessionUuid,
    });
    return c.json({ masks: masksList });
  },
);
