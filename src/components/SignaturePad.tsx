"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface SignaturePadProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

// Finds the pixel bounding box of whatever's actually been drawn (alpha>0),
// so the exported image can be cropped to it - without this, the exported
// PNG is the full blank 400x120 canvas with the ink positioned wherever the
// guest happened to draw it, and centering *that* on the printed form's
// underline doesn't center the visible signature at all.
function findInkBounds(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null;
}

// Plain <canvas> signature capture using Pointer Events, which unifies
// mouse/touch/stylus input into one handler set instead of needing separate
// mouse and touch listeners. Emits a PNG data URL cropped to the drawn ink
// (see findInkBounds) on each stroke, so the caller can embed it directly
// into the printed <<GuestSign>> slot already centered correctly.
export default function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  // Tracks the last data URL *this component itself* emitted via onChange,
  // so the redraw effect below can tell "the parent just echoed our own
  // stroke back down as a prop" (skip - already painted live) apart from
  // "the parent set/loaded a signature from outside" (e.g. a previously
  // saved Reg Card loading in asynchronously after this pad already
  // mounted blank, or being reset to null for a new guest) - that case
  // needs to actually draw it.
  const lastEmittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lastEmittedRef.current = null;
      return;
    }
    const img = new window.Image();
    img.onload = () => {
      // Drawn at natural size, centered - not stretched to fill the canvas.
      // A cropped-to-ink image (see findInkBounds) is always smaller than the
      // 400x120 canvas it came from, so stretching it back out would distort
      // the strokes; this instead reproduces exactly what was drawn.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, (canvas.width - img.width) / 2, (canvas.height - img.height) / 2);
    };
    img.src = value;
    lastEmittedRef.current = value;
  }, [value]);

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPos(e);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPointRef.current) return;
    const pos = getPos(e);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPointRef.current = pos;
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const bounds = findInkBounds(ctx, canvas.width, canvas.height);
    let dataUrl: string;
    if (bounds) {
      const PAD = 8;
      const x = Math.max(0, bounds.minX - PAD);
      const y = Math.max(0, bounds.minY - PAD);
      const w = Math.min(canvas.width, bounds.maxX + PAD + 1) - x;
      const h = Math.min(canvas.height, bounds.maxY + PAD + 1) - y;
      const cropped = document.createElement("canvas");
      cropped.width = w;
      cropped.height = h;
      const croppedCtx = cropped.getContext("2d");
      croppedCtx?.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      dataUrl = croppedCtx ? cropped.toDataURL("image/png") : canvas.toDataURL("image/png");
    } else {
      dataUrl = canvas.toDataURL("image/png");
    }
    lastEmittedRef.current = dataUrl;
    onChange(dataUrl);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastEmittedRef.current = null;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-[120px] bg-white border border-black/20 touch-none cursor-crosshair"
      />
      <button
        type="button"
        onClick={handleClear}
        className="mt-1 text-[10px] font-bold tracked-caps text-[var(--text-primary)]/50 hover:text-[var(--text-primary)] transition-colors"
      >
        Clear signature
      </button>
    </div>
  );
}
