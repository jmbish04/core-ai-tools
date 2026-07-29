/**
 * @fileoverview `/api/masks` — REST endpoints for creating and listing masks.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createCoreContext, createMask, listMasks } from "@/backend/core";

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
    const body = c.req.valid("json");
    const mask = await createMask(createCoreContext(c.env), {
      ...body,
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
