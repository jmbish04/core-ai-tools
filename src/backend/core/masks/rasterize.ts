/**
 * @fileoverview Server-side mask rasterisation — turn a geometric mask (bbox or
 * polygon, normalised 0–1) into the white=edit / transparent=preserve PNG the
 * provider consumes. Without this, a geometric mask persists but has no
 * `cf_image_id`, so `maskBase64` is undefined at edit time and the mask does
 * nothing (see revisions/execute.ts). Raster (brush) masks already arrive as a
 * PNG and skip this path.
 *
 * Output matches the browser brush tool (MaskBrushModal.rasterizeMask): a
 * grayscale+alpha PNG, opaque white inside the region, fully transparent
 * outside — so geometric and painted masks are pixel-identical downstream.
 *
 * No image library: PNG is assembled by hand (IHDR/IDAT/IEND + CRC32) and the
 * single IDAT is zlib-compressed via the runtime CompressionStream. Colour
 * type 4 (grayscale + alpha), 8-bit.
 *
 * ponytail: aspect is taken from source width/height when known, else a 1024²
 * canvas. A square canvas over a non-square image distorts the region when a
 * provider stretches the mask to the image; the target (Gemini, mask-emulated)
 * tolerates it. Upgrade path: always carry real source dimensions.
 */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Fallback canvas edge when the source image's pixel size is unknown. */
export const DEFAULT_MASK_EDGE = 1024;

export type BboxGeometry = { x: number; y: number; w: number; h: number };
export type PolygonGeometry = { points: Array<{ x: number; y: number }> };

// --- CRC32 (PNG polynomial 0xEDB88320) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** Assemble a PNG chunk: length + type + data + CRC(type+data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream("deflate") emits zlib format (header + adler32), which is
  // exactly what a PNG IDAT expects.
  const cs = new CompressionStream("deflate");
  const stream = new Response(new Blob([bytes as BufferSource]).stream().pipeThrough(cs));
  return new Uint8Array(await stream.arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Encode an inside-region predicate into a grayscale+alpha PNG.
 * `inside(px, py)` receives integer pixel coords; true = opaque white (edit).
 */
async function encodeMaskPng(
  width: number,
  height: number,
  inside: (px: number, py: number) => boolean,
): Promise<Uint8Array> {
  // Raw scanlines: each row is [filter=0, (gray, alpha) * width].
  const stride = width * 2;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const on = inside(x, y);
      const off = rowStart + 1 + x * 2;
      raw[off] = on ? 255 : 0; // gray
      raw[off + 1] = on ? 255 : 0; // alpha
    }
  }
  const ihdr = concat([
    u32(width),
    u32(height),
    new Uint8Array([8, 4, 0, 0, 0]), // bitDepth=8, colorType=4 (gray+alpha), deflate, filter, no interlace
  ]);
  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Even-odd point-in-polygon test on integer pixel coords for a 0–1 polygon. */
function pointInPolygon(pts: Array<{ x: number; y: number }>, px: number, py: number, w: number, h: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x * w;
    const yi = pts[i].y * h;
    const xj = pts[j].x * w;
    const yj = pts[j].y * h;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface RasterizeInput {
  kind: "bbox" | "polygon";
  geometry: unknown;
  /** Source pixel size, when known — drives the mask canvas aspect. */
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}

/** Rasterise a bbox/polygon mask to PNG bytes. Throws on malformed geometry. */
export async function rasterizeMaskPng(input: RasterizeInput): Promise<ArrayBuffer> {
  const width = input.sourceWidth && input.sourceWidth > 0 ? input.sourceWidth : DEFAULT_MASK_EDGE;
  const height = input.sourceHeight && input.sourceHeight > 0 ? input.sourceHeight : DEFAULT_MASK_EDGE;

  let inside: (px: number, py: number) => boolean;
  if (input.kind === "bbox") {
    const g = input.geometry as BboxGeometry;
    if (![g?.x, g?.y, g?.w, g?.h].every((v) => typeof v === "number")) {
      throw new Error("bbox geometry must be { x, y, w, h } in 0–1 coordinates.");
    }
    const x0 = g.x * width;
    const y0 = g.y * height;
    const x1 = (g.x + g.w) * width;
    const y1 = (g.y + g.h) * height;
    inside = (px, py) => px >= x0 && px < x1 && py >= y0 && py < y1;
  } else {
    const g = input.geometry as PolygonGeometry;
    if (!Array.isArray(g?.points) || g.points.length < 3) {
      throw new Error("polygon geometry must be { points: [{x,y}, …] } with ≥3 points in 0–1 coordinates.");
    }
    inside = (px, py) => pointInPolygon(g.points, px, py, width, height);
  }

  const png = await encodeMaskPng(width, height, inside);
  // ArrayBuffer copy (the view may be a slice of a larger buffer).
  return png.slice().buffer;
}

/** Read back a PNG's IHDR width/height — used by the self-check. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
