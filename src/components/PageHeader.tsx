"use client";

import React from "react";
import PropertySwitcher from "./PropertySwitcher";
import { ThemeToggle } from "./UserHeader";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode; // For action buttons, search, etc.
}

export default function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6">
      <div className="flex-1 min-w-0 max-w-4xl">
        <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-display text-[var(--text-primary)] mb-2 leading-[0.98] md:leading-[0.92] tracking-[-0.01em]">
          {title}
        </h1>
        {description && (
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 md:gap-6 pt-2 shrink-0 flex-wrap">
        {children}
        <div className="hidden lg:block h-10 w-px bg-[var(--text-primary)]/10 mx-2"></div>
        {/* Hidden below lg - Navigation.tsx's own top bar shows the same
            controls there instead (same breakpoint it switches to the
            hamburger menu at). The property switcher replaced every page's
            own "Select Property" dropdown; the signed-in user's own account
            menu lives at the bottom of the sidebar, MEWS-style, not here. */}
        <div className="hidden lg:flex items-center gap-3">
          <ThemeToggle />
          <PropertySwitcher />
        </div>
      </div>
    </div>
  );
}
