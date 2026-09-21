"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { ChevronsUpDown, LogOut, Moon, ShieldCheck, Sun, UserRound, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Bump this if the default theme ever needs to be force-reset again.
const THEME_DEFAULT_RESET_KEY = "theme_default_reset_v1";

/** Light / Dark switch. */
export function ThemeToggle() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    // Initial theme check. Light Mode became the app-wide default here -
    // anyone whose browser still has an old "dark" value saved from before
    // that change gets switched to light once (marked by
    // THEME_DEFAULT_RESET_KEY so it only happens the one time); toggling to
    // dark afterward is respected normally, same as any other preference.
    const resetDone = localStorage.getItem(THEME_DEFAULT_RESET_KEY) === "1";
    const savedTheme = resetDone ? (localStorage.getItem("theme") || "light") : "light";
    if (!resetDone) {
      localStorage.setItem("theme", "light");
      localStorage.setItem(THEME_DEFAULT_RESET_KEY, "1");
    }
    setTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`p-2 rounded-xl border transition-all shadow-sm ${
        theme === "dark"
          ? "bg-slate-900/50 border-white/10 text-slate-400 hover:text-white hover:bg-slate-800"
          : "bg-white border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
      }`}
      title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
      aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
    >
      {theme === "dark" ? <Sun className="w-5 h-5" aria-hidden="true" /> : <Moon className="w-5 h-5" aria-hidden="true" />}
    </button>
  );
}

interface ProfileRow {
  role: string | null;
  full_name: string | null;
}

function MenuLink({ href, icon: Icon, label, onClick, tone = "default" }: {
  href: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "admin";
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
        tone === "admin" ? "text-[#E6DC6A] hover:bg-[#AAA024]/10" : "text-white/80 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

/**
 * The signed-in user's avatar and account menu (Admin Console, Profile
 * Settings, Log out).
 *
 * variant="sidebar" is the MEWS-style placement at the bottom of the desktop
 * sidebar: avatar + name + role when expanded, avatar alone (name as a
 * tooltip) when the sidebar is collapsed, and the menu opens upward / to the
 * right so it never covers the link that opened it.
 * variant="topbar" is the plain avatar button the mobile top bar uses.
 */
export function ProfileMenu({ variant, collapsed = false }: { variant: "sidebar" | "topbar"; collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [canAccessAdmin, setCanAccessAdmin] = useState(false);
  // Where the Admin Console link points: "/admin" for full admins, and the
  // one page they ARE allowed for roles let in on a single ordinary menu
  // permission - /admin itself is not one of those pages and would just
  // redirect. Kept in step with ADMIN_NATIONALITY_PATHS / ADMIN_REVENUE_PATHS
  // in Navigation.tsx, which is what actually enforces this.
  const [adminHref, setAdminHref] = useState("/admin");
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const { data, error } = await supabase
          .from("profiles")
          .select("role, full_name")
          .eq("id", user.id)
          .single();

        if (error || !data) {
          console.warn("Unauthorized access detected. No profile found for:", user.email);
          await supabase.auth.signOut();
          router.push("/?error=unauthorized");
          return;
        }
        setProfile(data);

        // Super Admin always sees the Admin Console link regardless of the
        // Role Settings grid (locked in the UI - see admin/users Role
        // Settings tab). Other roles depend on their role_permissions.admin
        // flag, driven by the same grid - or on one of the two permissions
        // that grant a cut-down Admin Console: rr4_tm30 opens the two
        // nationality code tables, revenue opens Email Template (where the
        // Stop Sale & Re-open mail is configured). Navigation.tsx's
        // ADMIN_NATIONALITY_PATHS / ADMIN_REVENUE_PATHS are what actually
        // enforce this; the link target below just has to match, since
        // /admin itself redirects for those roles.
        // select("*") rather than a column list, same reason Navigation.tsx
        // uses it: a column missing in the DB would otherwise fail the whole
        // query and hide the link from legitimate admins.
        if (data.role === "Super Admin" || data.role === "super_admin") {
          setCanAccessAdmin(true);
        } else if (data.role) {
          const { data: permRow } = await supabase
            .from("role_permissions")
            .select("*")
            .eq("role", data.role)
            .single();
          setCanAccessAdmin(!!permRow?.admin || !!permRow?.rr4_tm30 || !!permRow?.revenue);
          setAdminHref(
            permRow?.admin ? "/admin"
              : permRow?.rr4_tm30 ? "/admin/rr4-nationality"
                : "/admin/templates");
        }
      }
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) getUser();
    });
    return () => subscription.unsubscribe();
  }, [router]);

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
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const close = () => setOpen(false);
  const displayName = profile?.full_name || user?.email || "User";
  const role = profile?.role || "User";
  const initials = (
    profile?.full_name?.split(" ").map((n) => n[0]).join("") || user?.email?.substring(0, 2) || "U"
  ).slice(0, 2).toUpperCase();
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;

  const avatar = (size: number) =>
    avatarUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage / Google avatar URLs, not configured for next/image
      <img src={avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    ) : (
      <span
        aria-hidden="true"
        className="shrink-0 rounded-full bg-gradient-to-tr from-[#AAA024] to-emerald-600 flex items-center justify-center font-bold text-white"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      >
        {initials}
      </span>
    );

  const panelPosition =
    variant === "topbar" ? "right-0 top-full mt-2" : collapsed ? "left-full bottom-0 ml-3" : "left-0 bottom-full mb-2";

  return (
    <div className="relative" ref={rootRef}>
      {variant === "topbar" ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Account: ${displayName}`}
          className="rounded-full border-2 border-white/10 shadow-lg shadow-black/20 transition-all hover:border-[#AAA024] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#AAA024]/50"
        >
          {avatar(36)}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={collapsed ? `Account: ${displayName}` : undefined}
          className={`group relative flex w-full items-center gap-3 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEFD2]/40 ${
            collapsed ? "justify-center py-1.5" : "overflow-hidden px-2 py-2 hover:bg-white/5"
          } ${open ? "bg-white/10" : ""}`}
        >
          {avatar(36)}
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-semibold text-white">{displayName}</span>
                <span className="block truncate text-[11px] text-white/50">{role}</span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-white/40" />
            </>
          )}
          {collapsed && !open && (
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-md bg-[#0d1a00] px-2.5 py-1.5 text-[11px] font-bold tracked-caps text-white opacity-0 shadow-lg ring-1 ring-[#FFEFD2]/15 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
            >
              {displayName}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0d1a00] font-sans text-white shadow-2xl ${panelPosition}`}
        >
          <div className="flex items-center gap-3 border-b border-white/10 p-4">
            {avatar(40)}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold">{displayName}</div>
              <div className="truncate text-[11px] text-white/50">{user?.email}</div>
              <span className="mt-1.5 inline-block rounded bg-[#AAA024]/20 px-2 py-0.5 text-[10px] font-bold text-[#E6DC6A]">
                {role}
              </span>
            </div>
          </div>
          <div className="p-1.5">
            {canAccessAdmin && (
              <MenuLink href={adminHref} icon={ShieldCheck} label="Admin Console" onClick={close} tone="admin" />
            )}
            <MenuLink href="/profile" icon={UserRound} label="Profile Settings" onClick={close} />
            <div className="mx-2 my-1 h-px bg-white/10" />
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
            >
              <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Theme toggle + account menu together - the mobile top bar's pair. */
export default function UserHeader() {
  return (
    <div className="z-50 flex items-center gap-3 font-sans">
      <ThemeToggle />
      <ProfileMenu variant="topbar" />
    </div>
  );
}
