"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The idle screen saver, driven by the kiosk's own "Screen saver video URL"
 * setting (Admin Console > Kiosks).
 *
 * Renders nothing at all when no URL is configured - a kiosk with no video
 * should stay on whatever screen it is on, not go black.
 *
 * Any touch, click or key press dismisses it and restarts the idle count.
 * The timer is deliberately generous: a guest reading the registration
 * screen is not idle, and a screen saver that interrupts them is worse than
 * one that comes on late.
 */

const IDLE_MS = 90_000;

export default function ScreenSaver({ videoUrl }: { videoUrl: string | null | undefined }) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url = (videoUrl || "").trim();
    if (!url) return;

    const reset = () => {
      setIdle(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), IDLE_MS);
    };

    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [videoUrl]);

  const url = (videoUrl || "").trim();
  if (!url || !idle) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black"
      // Dismissed by the window-level listeners above; this only stops a tap
      // from reaching whatever screen is underneath it.
      onPointerDown={(e) => e.stopPropagation()}
      aria-hidden="true"
    >
      <video
        src={url}
        className="h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
      />
      <p className="absolute bottom-10 left-1/2 -translate-x-1/2 text-sm uppercase tracking-[0.3em] text-white/50">
        Touch to begin
      </p>
    </div>
  );
}
