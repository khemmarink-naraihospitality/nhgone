"use client";

import React from "react";
import UserHeader from "./UserHeader";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode; // For action buttons, search, etc.
}

export default function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
      <div className="flex-1 min-w-0 max-w-4xl">
        <h1 className="text-[48px] font-display text-[var(--text-primary)] mb-2 leading-[0.92] tracking-[-0.01em]">
          {title}
        </h1>
        {description && (
          <p className="text-[var(--text-primary)] text-sm opacity-70 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-6 pt-2 shrink-0">
        {children}
        <div className="h-10 w-px bg-[var(--text-primary)]/10 mx-2"></div>
        <UserHeader />
      </div>
    </div>
  );
}
