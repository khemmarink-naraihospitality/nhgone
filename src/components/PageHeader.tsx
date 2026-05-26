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
    <div className="flex flex-col md:flex-row md:items-start justify-between gap-10">
      <div className="max-w-2xl">
        <h1 className="text-[64px] font-display text-[#152A00] mb-4 leading-[0.92] tracking-[-0.01em]">
          {title}
        </h1>
        {description && (
          <p className="text-[#152A00] text-sm opacity-70 leading-relaxed max-w-md">
            {description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-6 pt-4">
        {children}
        <div className="h-10 w-px bg-[#152A00]/10 mx-2"></div>
        <UserHeader />
      </div>
    </div>
  );
}
