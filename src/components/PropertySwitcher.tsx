"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useSelectedProperty, type PropertyInfo } from "@/lib/propertyContext";

// A property's initials for when no logo has been uploaded: "Lub d Bangkok
// Chinatown" -> "BC". The shared "Lub d" prefix is skipped, or every badge in
// the list would read "LD".
export function propertyInitials(name: string): string {
  const words = name.replace(/^Lub d\s+/i, "").split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join("") || name.slice(0, 2)).toUpperCase();
}

const BADGE_COLORS = ["#152A00", "#8A8220", "#0F766E", "#9A3412", "#1D4ED8", "#6D28D9", "#BE185D", "#4D7C0F"];

function badgeColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length];
}

/** A property's round logo, or its initials on a stable colour when it has none. */
export function PropertyAvatar({
  property,
  name,
  size = 36,
  className = "",
}: {
  property?: PropertyInfo | null;
  name?: string;
  size?: number;
  className?: string;
}) {
  const label = property?.name || name || "";
  const url = property?.profileImageUrl;
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary Supabase Storage URLs, not configured for next/image
      <img
        src={url}
        alt=""
        className={`shrink-0 rounded-full bg-white object-cover ring-1 ring-black/5 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 rounded-full flex items-center justify-center font-bold text-white ${className}`}
      style={{ width: size, height: size, background: badgeColor(label), fontSize: Math.round(size * 0.36) }}
    >
      {propertyInitials(label)}
    </span>
  );
}

/**
 * The property switcher at the top-right of every page, modelled on MEWS's
 * own: a banner with the current property's background image and name, a
 * search box, and every property the signed-in role may see.
 */
export default function PropertySwitcher({ compact = false }: { compact?: boolean }) {
  const { properties, selectedProperty, current, setSelectedProperty, loaded } = useSelectedProperty();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? properties.filter((p) => p.name.toLowerCase().includes(q)) : properties;
  }, [properties, query]);

  if (!loaded || properties.length === 0) return null;

  const toggle = () => {
    setQuery("");
    setOpen((o) => !o);
  };
  const choose = (name: string) => {
    setSelectedProperty(name);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Property: ${selectedProperty}. Switch property`}
        title={compact ? selectedProperty : undefined}
        className={`flex items-center gap-2.5 rounded-full border border-[var(--text-primary)]/12 bg-[var(--paper)] text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--text-primary)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#AAA024]/50 ${
          compact ? "p-0.5" : "py-1 pl-1 pr-3"
        }`}
      >
        <PropertyAvatar property={current} name={selectedProperty} size={compact ? 32 : 34} />
        {!compact && (
          <>
            <span className="max-w-[200px] truncate text-[13px] font-semibold">{selectedProperty}</span>
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 opacity-50 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-black/10 bg-white text-slate-900 shadow-2xl">
          <div className="relative h-24 bg-gradient-to-br from-[#152A00] via-[#2f4a0f] to-[#AAA024]">
            {current?.backgroundImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary Supabase Storage URLs, not configured for next/image
              <img src={current.backgroundImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
            <div className="absolute inset-x-4 bottom-3 flex items-center gap-3">
              <PropertyAvatar property={current} name={selectedProperty} size={40} className="ring-2 ring-white/80" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">Current property</div>
                <div className="truncate text-[15px] font-bold text-white drop-shadow">{selectedProperty}</div>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-100 p-3">
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 transition-colors focus-within:border-[#152A00] focus-within:ring-2 focus-within:ring-[#152A00]/10">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search property"
                aria-label="Search property"
                className="w-full bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
              />
            </label>
          </div>

          <ul className="max-h-[320px] overflow-y-auto py-1">
            {filtered.map((p) => {
              const active = p.name === selectedProperty;
              return (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => choose(p.name)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      active ? "bg-[#152A00]/[0.06]" : "hover:bg-slate-50"
                    }`}
                  >
                    <PropertyAvatar property={p} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">{p.name}</span>
                      <span className="block text-[11px] text-slate-500">Property</span>
                    </span>
                    {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-[#152A00]" />}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-center text-[12px] text-slate-400">No property matches &ldquo;{query}&rdquo;</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
