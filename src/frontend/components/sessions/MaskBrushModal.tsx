/**
 * @fileoverview Interactive Canvas Mask Brush Tool Modal.
 * Allows drawing a raster mask over an image, selecting a rectangular bbox, or typing
 * a semantic region description ("the countertop"). Computes normalized 0-1 geometry,
 * coverage ratio, creates a mask row via `POST /api/masks`, and attaches the `mask_id`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Circle,
  Eraser,
  Loader2,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiSend } from "@/lib/api";

interface MaskBrushModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  sourceImageId: string;
  sessionUuid?: string;
  derivedFromMaskId?: string | null;
  onMaskCreated: (mask: { id: string; label?: string | null; mode: "inpaint" | "preserve" }) => void;
}

export function MaskBrushModal({
  open,
  onOpenChange,
  imageUrl,
  sourceImageId,
  sessionUuid,
  derivedFromMaskId,
  onMaskCreated,
}: MaskBrushModalProps) {
  const [tool, setTool] = useState<"brush" | "erase" | "rect" | "circle" | "semantic">("brush");
  const [brushSize, setBrushSize] = useState(24);
  const [semanticLabel, setSemanticLabel] = useState("");
  const [maskMode, setMaskMode] = useState<"inpaint" | "preserve">("inpaint");
  const [maskColor, setMaskColor] = useState("#ef4444");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const isDrawing = useRef(false);
  // Shape drag: remember the start point + a snapshot of the committed canvas so
  // the rectangle/ellipse preview can be re-rendered live without stacking.
  const shapeStart = useRef<{ x: number; y: number } | null>(null);
  const snapshot = useRef<ImageData | null>(null);

  const PRESET_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#ffffff"];

  /** Hex (#rrggbb) → rgba() string at the given alpha. */
  const rgba = (hex: string, a: number) => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  };

  // Initialize canvas
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 600;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const handleImageLoad = () => {
    initCanvas();
  };

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  /** Draw a filled rectangle or ellipse from the shape start to the cursor. */
  const drawShape = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const start = shapeStart.current;
    if (!start) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rgba(maskColor, 0.6);
    ctx.strokeStyle = rgba(maskColor, 0.95);
    ctx.lineWidth = 2;
    if (tool === "rect") {
      const w = x - start.x;
      const h = y - start.y;
      ctx.beginPath();
      ctx.rect(start.x, start.y, w, h);
      ctx.fill();
      ctx.stroke();
    } else if (tool === "circle") {
      const rx = Math.abs(x - start.x) / 2;
      const ry = Math.abs(y - start.y) / 2;
      const cx = (x + start.x) / 2;
      const cy = (y + start.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === "semantic") return;
    isDrawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { x, y } = getCanvasCoords(e);

    if (tool === "rect" || tool === "circle") {
      // Snapshot the committed canvas so each drag frame can restore + redraw.
      shapeStart.current = { x, y };
      snapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = rgba(maskColor, 0.7);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || tool === "semantic") return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCanvasCoords(e);
    if (tool === "brush" || tool === "erase") {
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if ((tool === "rect" || tool === "circle") && snapshot.current) {
      ctx.putImageData(snapshot.current, 0, 0); // restore committed pixels
      drawShape(ctx, x, y); // live preview of the shape
    }
  };

  const stopDrawing = (e?: React.MouseEvent<HTMLCanvasElement>) => {
    if ((tool === "rect" || tool === "circle") && shapeStart.current && e) {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && snapshot.current) {
        const { x, y } = getCanvasCoords(e);
        ctx.putImageData(snapshot.current, 0, 0);
        drawShape(ctx, x, y); // commit the final shape
      }
    }
    isDrawing.current = false;
    shapeStart.current = null;
    snapshot.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Calculate coverage ratio and bounding box / geometry
  const computeMaskGeometry = () => {
    const canvas = canvasRef.current;
    if (!canvas) return { coverageRatio: 0.1, geometry: { type: "raster" } };

    const ctx = canvas.getContext("2d");
    if (!ctx) return { coverageRatio: 0.1, geometry: { type: "raster" } };

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let filledPixels = 0;
    let minX = canvas.width,
      maxX = 0,
      minY = canvas.height,
      maxY = 0;

    for (let i = 0; i < imgData.data.length; i += 4) {
      const alpha = imgData.data[i + 3];
      if (alpha > 10) {
        filledPixels++;
        const pixelIdx = i / 4;
        const x = pixelIdx % canvas.width;
        const y = Math.floor(pixelIdx / canvas.width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const total = canvas.width * canvas.height;
    const ratio = Math.min(1, Math.max(0.01, filledPixels / total));

    // Normalized bbox 0..1
    const normBbox = {
      x: minX / canvas.width,
      y: minY / canvas.height,
      w: (maxX - minX) / canvas.width,
      h: (maxY - minY) / canvas.height,
    };

    return {
      coverageRatio: ratio,
      geometry: {
        type: tool === "semantic" ? "semantic" : "bbox",
        bbox: normBbox,
      },
    };
  };

  const handleSaveMask = async () => {
    setSaving(true);
    try {
      let kind: "raster" | "bbox" | "semantic" = "raster";
      let geometryData: unknown = {};
      let coverageRatio = 0.1;
      let label: string | null = null;

      if (tool === "semantic") {
        kind = "semantic";
        label = semanticLabel || "Region mask";
        geometryData = { query: label };
      } else {
        const computed = computeMaskGeometry();
        kind = "raster";
        geometryData = computed.geometry;
        coverageRatio = computed.coverageRatio;
        label = `Mask ${kind} (${(coverageRatio * 100).toFixed(0)}% area)`;
      }

      const res = await apiSend<{ id: string; label: string | null }>("POST", "masks", {
        sessionUuid: sessionUuid || null,
        sourceImageId,
        kind,
        geometry: geometryData,
        coverageRatio,
        label,
        derivedFromMaskId: derivedFromMaskId || null,
        state: "confirmed",
      });

      onMaskCreated({
        id: res.id,
        label: label || res.label || "Custom Mask",
        mode: maskMode,
      });

      onOpenChange(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create mask");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-card text-foreground ring-1 ring-border/40 p-5">
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border/40 pb-3">
          <DialogTitle className="text-lg font-semibold flex items-center gap-2">
            <Paintbrush className="h-5 w-5 text-primary" /> Mask Region Tool
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-xl ring-1 ring-border/40 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTool("brush")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                tool === "brush" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Paintbrush className="h-3.5 w-3.5" /> Brush
            </button>
            <button
              onClick={() => setTool("rect")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                tool === "rect" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Square className="h-3.5 w-3.5" /> Rect
            </button>
            <button
              onClick={() => setTool("circle")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                tool === "circle" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Circle className="h-3.5 w-3.5" /> Circle
            </button>
            <button
              onClick={() => setTool("erase")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                tool === "erase" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eraser className="h-3.5 w-3.5" /> Erase
            </button>
            <button
              onClick={() => setTool("semantic")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                tool === "semantic" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              <Type className="h-3.5 w-3.5" /> Semantic Region
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearCanvas}
              className="h-8 gap-1 ring-1 ring-border/40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>

          {(tool === "brush" || tool === "erase") && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-mono">Brush size:</span>
              <input
                type="range"
                min="8"
                max="64"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="h-1.5 w-20 accent-primary"
              />
              <span className="font-mono text-foreground">{brushSize}px</span>
            </div>
          )}

          {/* Mask color — applies to brush + shapes (erase/semantic ignore it). */}
          {tool !== "semantic" && tool !== "erase" && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground font-mono">Color:</span>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setMaskColor(c)}
                  aria-label={`Mask color ${c}`}
                  className={`h-5 w-5 rounded-full ring-1 transition-transform ${
                    maskColor === c ? "ring-2 ring-primary scale-110" : "ring-border/40"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={maskColor}
                onChange={(e) => setMaskColor(e.target.value)}
                aria-label="Custom mask color"
                className="h-5 w-6 cursor-pointer rounded bg-transparent p-0"
              />
            </div>
          )}

          <div className="flex items-center gap-2 border-l border-border/40 pl-3">
            <span className="font-mono text-muted-foreground">Mode:</span>
            <button
              onClick={() => setMaskMode("inpaint")}
              className={`rounded-md px-2.5 py-1 font-mono transition-colors ${
                maskMode === "inpaint"
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                  : "text-muted-foreground"
              }`}
            >
              Inpaint
            </button>
            <button
              onClick={() => setMaskMode("preserve")}
              className={`rounded-md px-2.5 py-1 font-mono transition-colors ${
                maskMode === "preserve"
                  ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40"
                  : "text-muted-foreground"
              }`}
            >
              Preserve
            </button>
          </div>
        </div>

        {/* Interactive Canvas Area */}
        <div className="relative min-h-[400px] max-h-[500px] w-full flex items-center justify-center overflow-hidden rounded-xl bg-canvas ring-1 ring-border/40 select-none">
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Source"
            onLoad={handleImageLoad}
            className="max-h-[500px] w-full object-contain pointer-events-none"
          />
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            className="absolute inset-0 h-full w-full object-contain cursor-crosshair"
          />

          {tool === "semantic" && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="w-full max-w-md bg-card p-5 rounded-xl ring-1 ring-border/40 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Type className="h-4 w-4 text-primary" /> Describe Region by Name
                </h4>
                <p className="text-xs text-muted-foreground">
                  Type what you want to edit (e.g. &quot;kitchen countertop&quot;, &quot;the lamp on the left&quot;). The server will segment this region.
                </p>
                <Input
                  type="text"
                  placeholder="e.g. kitchen island countertop"
                  value={semanticLabel}
                  onChange={(e) => setSemanticLabel(e.target.value)}
                  className="bg-background ring-1 ring-border/40"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <span className="font-mono text-xs text-muted-foreground">
            {maskMode === "inpaint" ? "Changes apply ONLY inside mask" : "Changes apply EVERYTHING EXCEPT inside mask"}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveMask}
              disabled={saving}
              className="gap-2 bg-primary text-primary-foreground font-medium"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Attach Mask
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
