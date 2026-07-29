/**
 * @fileoverview Image comparison / diff viewer component (matching Turn 4 in Session View.dc.html).
 * Provides identical-stage pixel-aligned comparison between a revision's output image
 * and its parent image (or seed image).
 * Modes:
 *   - Slider mode: draggable split divider (default).
 *   - Side-by-Side mode: synchronized pan & zoom across both panes.
 *   - Onion Skin mode: opacity blend slider + Perspective Drift Edge Detection overlay toggle.
 * Deep-linkable via `?compare=1`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Columns,
  Eye,
  Layers,
  Maximize2,
  Minimize2,
  Move,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageDiffViewerProps {
  parentImageUrl: string;
  currentImageUrl: string;
  parentLabel?: string;
  currentLabel?: string;
}

export function ImageDiffViewer({
  parentImageUrl,
  currentImageUrl,
  parentLabel = "Parent Output",
  currentLabel = "Current Edit",
}: ImageDiffViewerProps) {
  const [mode, setMode] = useState<"slider" | "sideBySide" | "onionSkin">("slider");
  const [sliderPos, setSliderPos] = useState(50); // 0..100
  const [onionOpacity, setOnionOpacity] = useState(50); // 0..100
  const [edgeOverlay, setEdgeOverlay] = useState(false);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Pan / Zoom sync state for side-by-side
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDownSlider = () => setIsDraggingSlider(true);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDraggingSlider && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        setSliderPos(pct);
      }
      if (isPanning) {
        setPan((prev) => ({
          x: prev.x + (e.clientX - panStartRef.current.x),
          y: prev.y + (e.clientY - panStartRef.current.y),
        }));
        panStartRef.current = { x: e.clientX, y: e.clientY };
      }
    },
    [isDraggingSlider, isPanning],
  );

  const handleMouseUp = useCallback(() => {
    setIsDraggingSlider(false);
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (isDraggingSlider || isPanning) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingSlider, isPanning, handleMouseMove, handleMouseUp]);

  const handlePanStart = (e: React.MouseEvent) => {
    if (mode === "sideBySide") {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/40">
      {/* Diff Mode Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-1.5 rounded-lg bg-muted p-1 text-xs">
          <button
            onClick={() => setMode("slider")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === "slider"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sliders className="h-3.5 w-3.5" /> Slider
          </button>
          <button
            onClick={() => setMode("sideBySide")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === "sideBySide"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Columns className="h-3.5 w-3.5" /> Side by Side
          </button>
          <button
            onClick={() => setMode("onionSkin")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === "onionSkin"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="h-3.5 w-3.5" /> Onion Skin
          </button>
        </div>

        {/* Mode-specific controls */}
        <div className="flex items-center gap-3">
          {mode === "onionSkin" && (
            <>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">Opacity:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={onionOpacity}
                  onChange={(e) => setOnionOpacity(Number(e.target.value))}
                  className="h-1.5 w-24 accent-primary"
                />
                <span className="font-mono text-xs text-foreground w-8">{onionOpacity}%</span>
              </div>

              <button
                onClick={() => setEdgeOverlay(!edgeOverlay)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-mono transition-colors ring-1 ${
                  edgeOverlay
                    ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                    : "bg-background text-muted-foreground ring-border/40 hover:text-foreground"
                }`}
                title="Perspective Drift Edge Detection — exposes wall/geometry shifts"
              >
                <Zap className="h-3.5 w-3.5" /> Drift Check
              </button>
            </>
          )}

          {mode === "sideBySide" && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
                className="h-7 w-7 p-0"
              >
                -
              </Button>
              <span className="font-mono text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
                className="h-7 w-7 p-0"
              >
                +
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="h-7 px-2 text-xs"
              >
                Reset
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Diff Stage Container */}
      <div
        ref={containerRef}
        className="relative min-h-[420px] w-full overflow-hidden rounded-xl bg-canvas ring-1 ring-border/40 select-none"
      >
        {/* SLIDER MODE */}
        {mode === "slider" && (
          <div className="relative h-full w-full min-h-[420px]">
            {/* Background Parent Image */}
            <img
              src={parentImageUrl}
              alt={parentLabel}
              className="absolute inset-0 h-full w-full object-contain pointer-events-none"
            />
            {/* Foreground Current Edit (Clipped) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${sliderPos}%` }}
            >
              <img
                src={currentImageUrl}
                alt={currentLabel}
                className="absolute inset-0 h-full w-full object-contain pointer-events-none max-w-none"
                style={{ width: containerRef.current?.clientWidth ?? "100%" }}
              />
            </div>

            {/* Draggable Divider Line */}
            <div
              onMouseDown={handleMouseDownSlider}
              style={{ left: `${sliderPos}%` }}
              className="absolute bottom-0 top-0 w-1 -translate-x-1/2 cursor-ew-resize bg-primary shadow-[0_0_10px_rgba(0,0,0,0.8)] flex items-center justify-center group"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-110">
                <Move className="h-4 w-4" />
              </div>
            </div>

            {/* Floating Labels */}
            <div className="absolute bottom-3 left-3 rounded-md bg-black/70 px-2.5 py-1 font-mono text-xs text-white backdrop-blur">
              {currentLabel}
            </div>
            <div className="absolute bottom-3 right-3 rounded-md bg-black/70 px-2.5 py-1 font-mono text-xs text-white backdrop-blur">
              {parentLabel}
            </div>
          </div>
        )}

        {/* SIDE BY SIDE MODE */}
        {mode === "sideBySide" && (
          <div
            onMouseDown={handlePanStart}
            className="grid h-full w-full min-h-[420px] grid-cols-2 gap-2 p-2 cursor-grab active:cursor-grabbing"
          >
            {/* Left: Parent */}
            <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-background/50 ring-1 ring-border/40">
              <img
                src={parentImageUrl}
                alt={parentLabel}
                style={{
                  transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                  transition: isPanning ? "none" : "transform 0.1s ease-out",
                }}
                className="h-full w-full object-contain pointer-events-none"
              />
              <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white">
                {parentLabel}
              </div>
            </div>

            {/* Right: Current */}
            <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-background/50 ring-1 ring-border/40">
              <img
                src={currentImageUrl}
                alt={currentLabel}
                style={{
                  transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                  transition: isPanning ? "none" : "transform 0.1s ease-out",
                }}
                className="h-full w-full object-contain pointer-events-none"
              />
              <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px] text-white">
                {currentLabel}
              </div>
            </div>
          </div>
        )}

        {/* ONION SKIN MODE */}
        {mode === "onionSkin" && (
          <div className="relative h-full w-full min-h-[420px]">
            {/* Base Parent Image */}
            <img
              src={parentImageUrl}
              alt={parentLabel}
              className={`absolute inset-0 h-full w-full object-contain pointer-events-none ${
                edgeOverlay ? "filter contrast-200 grayscale" : ""
              }`}
            />
            {/* Blended Current Image */}
            <img
              src={currentImageUrl}
              alt={currentLabel}
              style={{ opacity: onionOpacity / 100 }}
              className={`absolute inset-0 h-full w-full object-contain pointer-events-none transition-opacity ${
                edgeOverlay ? "filter invert contrast-200 mix-blend-difference" : ""
              }`}
            />

            {edgeOverlay && (
              <div className="absolute top-3 left-3 rounded-md bg-amber-500/20 px-3 py-1 font-mono text-xs text-amber-300 ring-1 ring-amber-500/40 backdrop-blur">
                Drift edge overlay active &bull; Highlighting structural misalignment
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
