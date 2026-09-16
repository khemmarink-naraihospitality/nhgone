"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";

/**
 * The Google-account-style photo cropper: the crop box is fixed, the photo
 * moves behind it, and a zoom slider scales it. Used by every image upload in
 * the app (a user's profile photo, a property's logo and banner) so they all
 * behave the same way.
 *
 * The viewport IS the crop - whatever is visible inside the box is exactly
 * what gets written - so there is no separate "preview" that could disagree
 * with the result. The photo is clamped to always cover the box, so a crop can
 * never contain empty space.
 *
 * Nothing here reports through alert(): errors render inside the dialog. See
 * the memory rule about browser popups.
 */

const VIEW_W = 300;
const MAX_ZOOM = 4;

// Re-encode as JPEG if a PNG crop comes out heavier than this. Transparency is
// worth keeping for a logo, but not at the cost of failing the 5 MB upload cap
// on what is usually a photo that was only ever a PNG by accident.
const PNG_FALLBACK_BYTES = 3.5 * 1024 * 1024;

export interface ImageCropDialogProps {
  /** The file the user picked. The dialog owns its object URL from here on. */
  file: File;
  /** Crop box shape: width / height. 1 = square, 3 = a wide banner. */
  aspect?: number;
  /** A round mask (a logo or avatar) or a plain rectangle (a banner). */
  shape?: "round" | "rect";
  title?: string;
  /** Width of the written image in real pixels; height follows `aspect`. */
  outputWidth?: number;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export default function ImageCropDialog({
  file,
  aspect = 1,
  shape = "round",
  title = "Adjust your photo",
  outputWidth = 512,
  confirmLabel = "Save",
  busy = false,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const viewH = Math.round(VIEW_W / aspect);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Scale at which the photo exactly covers the crop box - zoom 1 means "as
  // zoomed out as this crop allows", never smaller, so no gap can appear.
  const baseScale = image ? Math.max(VIEW_W / image.naturalWidth, viewH / image.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const drawnW = image ? image.naturalWidth * scale : 0;
  const drawnH = image ? image.naturalHeight * scale : 0;

  const clamp = useCallback(
    (next: { x: number; y: number }, w: number, h: number) => ({
      x: Math.min(0, Math.max(VIEW_W - w, next.x)),
      y: Math.min(0, Math.max(viewH - h, next.y)),
    }),
    [viewH]
  );

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // The photo is centred here rather than in a follow-up effect: loading
      // is an external event, this is the first moment the natural size is
      // known, and it settles the whole initial view in one render.
      const cover = Math.max(VIEW_W / img.naturalWidth, viewH / img.naturalHeight);
      setImage(img);
      setError(null);
      setZoom(1);
      setOffset({
        x: (VIEW_W - img.naturalWidth * cover) / 2,
        y: (viewH - img.naturalHeight * cover) / 2,
      });
    };
    img.onerror = () => setError("That file could not be opened as an image.");
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, viewH]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Zoom around the middle of the crop box, so the thing the user framed stays
  // framed instead of drifting toward a corner.
  const applyZoom = (next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    if (!image) {
      setZoom(z);
      return;
    }
    const nextScale = baseScale * z;
    const nextW = image.naturalWidth * nextScale;
    const nextH = image.naturalHeight * nextScale;
    const ratio = nextScale / scale;
    const cx = VIEW_W / 2;
    const cy = viewH / 2;
    setZoom(z);
    setOffset((o) => clamp({ x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }, nextW, nextH));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!image || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setOffset(
      clamp({ x: drag.originX + (e.clientX - drag.startX), y: drag.originY + (e.clientY - drag.startY) }, drawnW, drawnH)
    );
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  const handleConfirm = async () => {
    if (!image) return;
    const outW = outputWidth;
    const outH = Math.round(outputWidth / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Your browser could not process this image.");
      return;
    }
    // The visible box maps straight back onto the source: the left edge of the
    // box sits -offset.x device pixels into the drawn photo, which is
    // -offset.x / scale pixels into the original.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -offset.x / scale, -offset.y / scale, VIEW_W / scale, viewH / scale, 0, 0, outW, outH);

    // Keep transparency for the formats that carry it, but don't ship a
    // needlessly huge PNG - see PNG_FALLBACK_BYTES.
    const wantsAlpha = /png|webp|gif/.test(file.type);
    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    let blob = await toBlob(wantsAlpha ? "image/png" : "image/jpeg", 0.92);
    if (blob && blob.type === "image/png" && blob.size > PNG_FALLBACK_BYTES) {
      blob = (await toBlob("image/jpeg", 0.92)) || blob;
    }
    if (!blob) {
      setError("Could not save the cropped image. Please try another file.");
      return;
    }
    onConfirm(blob);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs font-medium text-slate-500">Drag to reposition, then zoom to fit.</p>

        {error && (
          <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-center">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ width: VIEW_W, height: viewH, touchAction: "none" }}
            className={`relative select-none overflow-hidden bg-slate-100 ${
              shape === "round" ? "rounded-full" : "rounded-2xl"
            } ${image && !busy ? "cursor-grab active:cursor-grabbing" : ""} ring-1 ring-slate-200`}
          >
            {image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={image.src}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: offset.x,
                  top: offset.y,
                  width: drawnW,
                  height: drawnH,
                  maxWidth: "none",
                }}
              />
            ) : (
              !error && (
                <div className="flex h-full w-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              )
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!image || busy || zoom <= 1}
            onClick={() => applyZoom(zoom - 0.25)}
            className="rounded-full border border-slate-200 p-1.5 text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            aria-label="Zoom"
            disabled={!image || busy}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#AAA024] disabled:opacity-40"
          />
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!image || busy || zoom >= MAX_ZOOM}
            onClick={() => applyZoom(zoom + 0.25)}
            className="rounded-full border border-slate-200 p-1.5 text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset"
            disabled={!image || busy}
            onClick={() => applyZoom(1)}
            className="rounded-full border border-slate-200 p-1.5 text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!image || busy}
            className="flex-1 rounded-xl bg-[#AAA024] py-2.5 text-sm font-bold text-white shadow-lg shadow-[#AAA024]/20 transition-all hover:bg-[#8f871e] disabled:opacity-50"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
