"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useSelectedProperty } from "@/lib/propertyContext";
import { useKioskConfig } from "./kioskConfig";

/**
 * The welcome screen's bottom-left caption, made switchable.
 *
 * It still reads as the quiet caption it was - this is a lobby terminal, and
 * a guest standing at it has no business changing which hotel it belongs to.
 * It is a STAFF affordance, which is why it stays small and faint rather than
 * becoming a header control: the screen already says "Staff Mode", and the
 * whole /kiosk route sits behind the app's auth guard and its own
 * `role_permissions.kiosk` route guard.
 *
 * ACCESS IS NOT RE-IMPLEMENTED HERE. The list comes from
 * `useSelectedProperty()`, whose properties were already resolved through
 * `getAllowedProperties()` - so a role restricted to one hotel can only ever
 * switch within its own, by the same rule that governs the switcher on every
 * other page. Writing a second check here would be a second thing to keep in
 * step, and the one that got it wrong would be the security hole.
 *
 * With nothing to switch to (one property, or the list still loading) it
 * renders as plain text, not a button that opens an empty menu.
 */
export default function KioskPropertySwitcher() {
  const { properties, selectedProperty, setSelectedProperty, loaded } = useSelectedProperty();
  const { config } = useKioskConfig();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const label = config?.name || `${selectedProperty || "NHG"} Kiosk`;
  const canSwitch = loaded && properties.length > 1;

  // Close on a tap anywhere else, or Escape on a terminal with a keyboard.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!canSwitch) {
    return <p className="px-8 pb-4 text-sm text-[var(--kiosk-text-faint)]">{label}</p>;
  }

  return (
    <div ref={rootRef} className="relative px-8 pb-4">
      {/* Opens UPWARD: the caption sits on the bottom edge, so a menu
          dropping down would be off-screen. */}
      {open && (
        <div
          role="listbox"
          aria-label="Property"
          className="absolute bottom-full left-8 z-50 mb-2 max-h-[60vh] w-[22rem] overflow-y-auto rounded-2xl bg-[var(--kiosk-surface)] p-2 shadow-2xl ring-1 ring-[var(--kiosk-border)]"
        >
          {properties.map((property) => {
            const isCurrent = property.name === selectedProperty;
            return (
              <button
                key={property.name}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  setSelectedProperty(property.name);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  isCurrent ? "bg-[var(--kiosk-surface-alt)] font-semibold" : "hover:bg-[var(--kiosk-hover)]"
                }`}
              >
                {property.profileImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={property.profileImageUrl}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--kiosk-border)]"
                  />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-full bg-[var(--kiosk-surface-alt)]" />
                )}
                <span className="flex-1 truncate text-base text-[var(--kiosk-text)]">{property.name}</span>
                {isCurrent && (
                  <Check size={18} className="shrink-0 text-[var(--kiosk-accent)]" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded-md text-sm text-[var(--kiosk-text-faint)] transition-colors hover:text-[var(--kiosk-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kiosk-accent)]"
      >
        {label}
      </button>
    </div>
  );
}
