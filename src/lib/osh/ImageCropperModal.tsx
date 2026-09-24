"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/**
 * The prototype's photo handling, as it was: a photo already near 4:3 (or
 * 3:4) is shrunk to 800px wide and kept; anything else opens this cropper,
 * which exports exactly 800x600. Both produce a JPEG data URL, which the form
 * then uploads (the prototype stored the data URL itself in localStorage).
 */

/** Max 800px wide, JPEG 0.7 - the prototype's compressImage. */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't an image."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let targetWidth = img.width;
        let targetHeight = img.height;
        if (targetWidth > 800) {
          targetHeight = Math.floor(targetHeight * (800 / targetWidth));
          targetWidth = 800;
        }
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No canvas available."));
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Whether a photo is close enough to 4:3 landscape or 3:4 portrait to keep
 * as-is - the prototype's own tolerance. */
export function readAspectRatioOk(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't an image."));
      img.onload = () => {
        const ratio = img.width / img.height;
        const isLandscape43 = ratio >= 1.2 && ratio <= 1.5;
        const isPortrait34 = ratio >= 0.65 && ratio <= 0.85;
        resolve(isLandscape43 || isPortrait34);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageCropperModal({
  file,
  onCrop,
  onCancel,
}: {
  file: File;
  onCrop: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [minScale, setMinScale] = useState(1);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const i = new Image();
      i.onload = () => {
        // Target canvas 800x600 (4:3), cover-fitted and centred.
        const s = Math.max(800 / i.width, 600 / i.height);
        setMinScale(s);
        setScale(s);
        setPos({ x: (800 - i.width * s) / 2, y: (600 - i.height * s) / 2 });
        setImg(i);
      };
      i.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [file]);

  useEffect(() => {
    if (!img || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 800, 600);
    ctx.drawImage(img, pos.x, pos.y, img.width * scale, img.height * scale);
    // Rule-of-thirds grid, for framing only - not exported.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(800 / 3, 0); ctx.lineTo(800 / 3, 600);
    ctx.moveTo((800 * 2) / 3, 0); ctx.lineTo((800 * 2) / 3, 600);
    ctx.moveTo(0, 600 / 3); ctx.lineTo(800, 600 / 3);
    ctx.moveTo(0, (600 * 2) / 3); ctx.lineTo(800, (600 * 2) / 3);
    ctx.stroke();
  }, [img, scale, pos]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartPos({ x: pos.x, y: pos.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragStart.x) * (800 / rect.width);
    const dy = (e.clientY - dragStart.y) * (600 / rect.height);
    setPos({ x: startPos.x + dx, y: startPos.y + dy });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleConfirm = () => {
    if (!img || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    // Redrawn without the grid before exporting.
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 800, 600);
    ctx.drawImage(img, pos.x, pos.y, img.width * scale, img.height * scale);
    onCrop(canvasRef.current.toDataURL("image/jpeg", 0.8));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/90 p-4">
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b bg-slate-50 p-4">
          <h3 className="font-bold text-slate-800">ปรับขนาดและครอบภาพ (4:3)</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-red-500" aria-label="ยกเลิก">
            <X size={20} />
          </button>
        </div>

        <div className="flex touch-none select-none justify-center bg-slate-200 p-4">
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="h-auto w-full max-w-md cursor-move touch-none border border-slate-400 bg-slate-300 shadow-inner"
            style={{ aspectRatio: "4/3" }}
          />
        </div>

        <div className="space-y-4 border-t p-4">
          <div>
            <label className="mb-2 block text-xs font-bold text-slate-500">
              เลื่อนซ้ายขวาบนล่างที่ภาพเพื่อจัดตำแหน่ง หรือปรับซูมที่นี่
            </label>
            <input
              type="range"
              min={minScale}
              max={minScale * 3}
              step="0.01"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onCancel} className="rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-700 hover:bg-slate-200">
              ยกเลิก
            </button>
            <button
              onClick={handleConfirm}
              disabled={!img}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Check size={18} /> ยืนยันการครอบภาพ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
