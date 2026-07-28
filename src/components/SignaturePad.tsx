"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface SignaturePadProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

// Plain <canvas> signature capture using Pointer Events, which unifies
// mouse/touch/stylus input into one handler set instead of needing separate
// mouse and touch listeners. Emits a PNG data URL on each stroke so the
// caller can embed it directly into the printed <<GuestSign>> slot.
export default function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Redraw from `value` when it's cleared/replaced from outside (e.g. the
  // parent resetting it to null for a new guest) - not on every local stroke,
  // since those already paint the canvas directly.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const img = new window.Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (canvas) onChange(canvas.toDataURL("image/png"));
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
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
