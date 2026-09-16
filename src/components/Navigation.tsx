"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ProfileMenu, ThemeToggle } from "./UserHeader";
import PropertySwitcher from "./PropertySwitcher";
import { supabase } from "@/lib/supabase";
import { SelectedPropertyProvider } from "@/lib/propertyContext";
import {
  ArrowLeft,
  BookUser,
  Building2,
  CalendarClock,
  ChartColumnBig,
  Database,
  FileSpreadsheet,
  Flag,
  Globe,
  History,
  IdCard,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  Mail,
  Menu,
  MonitorCog,
  MonitorSmartphone,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

// The desktop sidebar's collapsed/expanded choice, remembered per browser.
const SIDEBAR_COLLAPSED_KEY = "nhgone.sidebarCollapsed";

type NavEntry = { href: string; label: string; icon: LucideIcon; active: boolean };

// One sidebar link: icon + label when expanded, icon alone with a hover/focus
// tooltip when collapsed. Module-level (not defined inside Navigation) so a
// re-render of the shell doesn't remount every link and drop keyboard focus.
function NavItem({ href, label, icon: Icon, active, collapsed }: NavEntry & { collapsed: boolean }) {
  return (
    <Link
      href={href}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 border-l-2 rounded-r-md transition-colors duration-150 ${
        collapsed ? "justify-center py-2.5" : "px-3 py-2.5 lg:py-2"
      } ${
        active
          ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]"
          : "text-white/50 border-transparent hover:text-white hover:bg-white/5"
      }`}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={active ? 2.25 : 1.75}
        className={`w-[18px] h-[18px] shrink-0 transition-colors ${
          active ? "text-[#FFEFD2]" : "text-white/45 group-hover:text-white"
        }`}
      />
      {!collapsed && (
        <span className="truncate whitespace-nowrap text-[13px] lg:text-[12px] tracked-caps">{label}</span>
      )}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-md bg-[#0d1a00] px-2.5 py-1.5 text-[11px] font-bold tracked-caps text-white opacity-0 shadow-lg ring-1 ring-[#FFEFD2]/15 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
        >
          {label}
        </span>
      )}
    </Link>
  );
}

interface MenuPermissions {
  dashboard: boolean;
  data_mart: boolean;
  bills: boolean;
  rr3: boolean;
  st_files: boolean;
  revenue: boolean;
  rv: boolean;
  bcp: boolean;
  rr4_tm30: boolean;
  reconciliation: boolean;
  users_report: boolean;
  kiosk: boolean;
  admin: boolean;
}

function PendingApprovalScreen({ email }: { email: string }) {
  const router = useRouter();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFEFD2] p-4 font-sans text-[#152A00]">
      <div className="relative w-full max-w-sm bg-white border border-[#152A00]/10 rounded-sm shadow-[20px_20px_60px_rgba(21,42,0,0.05)] p-8 md:p-10 text-center">
        <div className="mx-auto mb-6 w-14 h-14 rounded-full bg-[#AAA024]/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-black font-display mb-6 tracking-tight">Waiting for Approval</h1>
        <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8">
          Your account (<span className="font-bold">{email}</span>) is still pending approval. Please contact the IT Department if you need this expedited.
        </p>
        <button
          onClick={handleSignOut}
          className="w-full py-3 border border-[#152A00] rounded-sm text-[11px] font-bold tracked-caps text-[#152A00] hover:bg-[#152A00] hover:text-[#FFEFD2] transition-all"
        >
          SIGN OUT
        </button>
      </div>
    </div>
  );
}

function ForcePasswordChangeScreen({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session expired. Please sign in again.");
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) throw pwError;
      // Only cleared after the password itself actually changed, so a failed
      // update leaves the account still gated behind this screen rather than
      // waved through with the emailed password still live.
      const { error: flagError } = await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id);
      if (flagError) throw flagError;
      // Full reload rather than router.push: re-runs the auth guard from
      // scratch so the app shell mounts with the cleared flag.
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFEFD2] p-4 font-sans text-[#152A00]">
      <div className="relative w-full max-w-sm bg-white border border-[#152A00]/10 rounded-sm shadow-[20px_20px_60px_rgba(21,42,0,0.05)] p-8 md:p-10">
        <div className="mx-auto mb-6 w-14 h-14 rounded-full bg-[#AAA024]/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-xl font-black font-display mb-3 tracking-tight text-center">Choose a New Password</h1>
        <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8 text-center">
          <span className="font-bold">{email}</span> is signing in with a password that was emailed to you. Please replace it before continuing.
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-bold tracked-caps text-[#152A00]/60 ml-1">New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-sm border border-[#152A00]/10 focus:border-[#AAA024] outline-none transition-all text-sm bg-[#FFEFD2]/10"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold tracked-caps text-[#152A00]/60 ml-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your new password"
              required
              className="w-full px-4 py-3 rounded-sm border border-[#152A00]/10 focus:border-[#AAA024] outline-none transition-all text-sm bg-[#FFEFD2]/10"
            />
          </div>
          {error && (
            <p className="text-red-600 text-[11px] font-bold leading-relaxed bg-red-50 p-3 border-l-2 border-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985] disabled:opacity-70"
          >
            {saving ? "SAVING..." : "SET PASSWORD & CONTINUE"}
          </button>
        </form>
        <button
          onClick={handleSignOut}
          className="w-full mt-3 py-3 border border-[#152A00]/20 rounded-sm text-[11px] font-bold tracked-caps text-[#152A00]/60 hover:border-[#152A00] hover:text-[#152A00] transition-all"
        >
          SIGN OUT
        </button>
      </div>
    </div>
  );
}

// Auto sign-out after 30 minutes with no mouse/keyboard/touch/scroll activity
// anywhere in the app - a shared front-desk workstation left unattended
// otherwise stays logged into whichever staff account opened it.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// The only two Admin Console pages a role can reach on the strength of its
// RR4/TM30 menu permission alone. They hold the nationality code lookup
// tables the RR4/TM30 government filing depends on - reference data the
// staff filing those forms have to be able to correct themselves, which is a
// different thing from administering the system. Every other /admin page
// stays behind the full `admin` permission.
const ADMIN_NATIONALITY_PATHS = ["/admin/rr4-nationality", "/admin/tm30-nationality"];

export default function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/";
  // Where a Supabase recovery link lands. Deliberately outside the auth
  // guard entirely: the visitor arrives holding a one-time recovery token
  // rather than a normal session, and the page itself is what validates it.
  const isResetPasswordPage = pathname === "/reset-password";
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  // Set for an Internal Auth account still on the password that was emailed
  // to it (profiles.must_change_password) - blocks the app shell behind
  // ForcePasswordChangeScreen, the same way Pending does.
  const [mustChangePasswordEmail, setMustChangePasswordEmail] = useState<string | null>(null);
  const [menuPermissions, setMenuPermissions] = useState<MenuPermissions | null>(null);
  // Distinguishes "haven't fetched yet" from "fetched, got nothing" (both
  // otherwise look like menuPermissions === null) - without this the admin
  // guard below couldn't tell when it's safe to make a final allow/deny
  // decision and would spin forever on a failed fetch instead of redirecting.
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  // Mobile-only slide-in drawer - the desktop <aside> sidebar is `hidden` below
  // the md breakpoint, so without this there was no way to navigate at all on
  // a phone. Closes automatically on every route change (see the effect
  // below) rather than staying open across a Link click.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Closes the drawer on every route change - adjusted during render (React's
  // documented pattern for "reset state when a prop changes") rather than a
  // useEffect, which would fire a wasted extra render after every navigation.
  const [mobileNavPathname, setMobileNavPathname] = useState(pathname);
  if (pathname !== mobileNavPathname) {
    setMobileNavPathname(pathname);
    setMobileNavOpen(false);
  }
  // Desktop sidebar collapsed to icons only (the hamburger at its top), the
  // way MEWS's own left menu does. Read straight from localStorage in the
  // initializer: the shell itself only renders once the client-side auth
  // check has resolved (the server render is the spinner below), so there is
  // no server markup for this to disagree with and no flash of the wrong width.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Private mode / blocked storage: the toggle still works for this visit.
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      // The reset-password page runs its own token check and must stay
      // reachable with no session at all - never redirect away from it.
      if (isResetPasswordPage) {
        setIsAuthorized(true);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        if (!isLoginPage) {
          router.push("/");
          setIsAuthorized(false);
        } else {
          setIsAuthorized(true);
        }
        return;
      }

      // If user is logged in, must have a profile
      // We check by ID and fallback to Email to be absolute
      // select("*") rather than an explicit column list, for the same reason
      // role_permissions is read that way below: a column added in code
      // before it exists in the database (must_change_password, auth_method)
      // would make an explicit list fail the whole query - and here that
      // means every user losing their profile and being signed out as
      // unauthorized, not just one link going missing.
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      let finalProfile = profile;

      // Secondary check by email if ID check didn't return data (just in case of sync issues,
      // or on first Google OAuth login where profile was pre-registered with a different UUID)
      if (!finalProfile && user.email) {
        const { data: emailProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("email", user.email)
          .single();
        finalProfile = emailProfile;

        // First-time Google login: profile exists by email but was pre-registered with a
        // different UUID. Update profile.id to match the real Google auth user UUID so
        // subsequent logins are found by ID directly.
        if (finalProfile && finalProfile.id !== user.id) {
          await supabase
            .from("profiles")
            .update({ id: user.id })
            .eq("email", user.email);
          finalProfile = { ...finalProfile, id: user.id };
        }
      }

      if (error && error.code !== 'PGRST116' && !finalProfile) {
         console.error("Auth Guard Error:", error);
      }

      if (!finalProfile) {
        // First-time login (Google or email/password) with no pre-registered
        // invite - auto-provision a pending profile instead of kicking them
        // out immediately, so a Super Admin can approve them from Admin >
        // Users (with a real role) rather than having to pre-register every
        // email in advance.
        try {
          const res = await fetch("/api/admin/self-register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: user.id,
              email: user.email,
              full_name: user.user_metadata?.full_name || user.user_metadata?.name || "",
            }),
          });
          const result = await res.json();
          if (result.status === "success") {
            setPendingEmail(user.email || "");
            setIsAuthorized(true);
            return;
          }
        } catch (err) {
          console.error("Self-registration failed:", err);
        }
        // Self-registration failed - fall back to the original unauthorized flow.
        if (!isLoginPage) {
          console.warn("Unauthorized access attempt. User email:", user.email, "User ID:", user.id);
          await supabase.auth.signOut();
          // Force hard redirect to be absolutely sure the session is dead and error shows
          window.location.href = "/?error=unauthorized";
          setIsAuthorized(false);
        } else {
          // If already on login page but somehow have a user without profile, sign out
          await supabase.auth.signOut();
          setIsAuthorized(true);
        }
      } else if (finalProfile.status === "Pending") {
        // Approved but not yet reviewed - show the waiting screen instead of
        // the normal app shell/menus (see PendingApprovalScreen above).
        setPendingEmail(finalProfile.email || user.email || "");
        setIsAuthorized(true);
      } else if (finalProfile.status === "Inactive") {
        // A Super Admin deactivating a user (Admin > Users) must actually
        // revoke access, not just change a label - this used to fall through
        // to the "else" branch below and sign the account straight into the
        // full app with its normal role permissions. Hard redirect (not
        // router.push) for the same reason as the unauthorized/idle-timeout
        // paths above: be certain the session is actually dead rather than
        // leaving stale client state around sensitive data.
        console.warn("Inactive account attempted access:", user.email, user.id);
        await supabase.auth.signOut();
        window.location.href = "/?error=inactive";
        setIsAuthorized(false);
      } else if (finalProfile.must_change_password) {
        // Internal Auth account still on the password that was emailed to it
        // - a credential the user never chose and that sat in a mailbox in
        // plain text. Gate the app behind the change screen until it's
        // replaced (see ForcePasswordChangeScreen).
        setMustChangePasswordEmail(finalProfile.email || user.email || "");
        setIsAuthorized(true);
      } else {
        // Authorized!
        setPendingEmail(null);
        setMustChangePasswordEmail(null);
        setUserRole(finalProfile.role || null);
        if (finalProfile.role) {
          // select("*") instead of an explicit column list: if a newly added
          // menu column (e.g. st_files) hasn't been created in the DB yet, an
          // explicit list would make the whole query fail and silently throw
          // every role back to the hardcoded fallback below - with "*" the
          // missing column is just undefined (falsy -> that one link hidden).
          const { data: permRow } = await supabase
            .from("role_permissions")
            .select("*")
            .eq("role", finalProfile.role)
            .single();
          setMenuPermissions((permRow as MenuPermissions | null) || null);
          if (isLoginPage && pathname === "/") {
            router.push("/dashboard");
          }
        } else {
          setMenuPermissions(null);
          if (isLoginPage && pathname === "/") {
            router.push("/dashboard");
          }
        }
        setPermissionsLoaded(true);
        setIsAuthorized(true);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setIsAuthorized(false);
        setPendingEmail(null);
        setMustChangePasswordEmail(null);
        setMenuPermissions(null);
        setPermissionsLoaded(false);
        router.push("/");
      } else if (event === 'SIGNED_IN') {
        checkAuth();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, isLoginPage, isResetPasswordPage, router]);

  const isSuperAdminRole = userRole === "Super Admin" || userRole?.toLowerCase() === "super_admin";
  const onAdminPath = pathname.startsWith("/admin");

  const hasFullAdmin = isSuperAdminRole || !!menuPermissions?.admin;
  const canEnterAdmin = hasFullAdmin || !!menuPermissions?.rr4_tm30;
  // Nationality-only admins: everything under /admin is off-limits except the
  // two pages above - including /admin itself, whose dashboard reports on
  // logins and user counts.
  const adminNationalityOnly = !hasFullAdmin && !!menuPermissions?.rr4_tm30;

  // Users Report is guarded on the route, not just by hiding its link -
  // the same reasoning /admin/* has, and for the same kind of content: it
  // lists every account's name, email, role and sign-in history, so a role
  // without the box ticked shouldn't reach it by typing the URL either.
  // (Like every role_permissions check in this app this is client-side; the
  // profiles table itself is readable by any signed-in session under its own
  // policy. It closes the front door, it isn't a server-side boundary.)
  //
  // Super Admin is not special-cased here the way it is for /admin: sidebar
  // menus are read straight from role_permissions, and the migration that
  // adds this column switches it on for Super Admin explicitly.
  const onUsersReportPath = pathname === "/users-report";
  useEffect(() => {
    if (!onUsersReportPath || !permissionsLoaded) return;
    if (!menuPermissions?.users_report) router.push("/dashboard");
  }, [onUsersReportPath, permissionsLoaded, menuPermissions, router]);

  // Kiosk is route-guarded rather than merely link-hidden, for the same
  // reason /users-report and /admin are: it renders full-screen with no
  // sidebar, so hiding the link would leave a typed URL as a way into a
  // screen that looks like the property's own front desk. Super Admin is not
  // special-cased - kiosk_menu.sql switches the column on for it explicitly.
  const onKioskPath = pathname === "/kiosk" || pathname.startsWith("/kiosk/");
  useEffect(() => {
    if (!onKioskPath || !permissionsLoaded) return;
    if (!menuPermissions?.kiosk) router.push("/dashboard");
  }, [onKioskPath, permissionsLoaded, menuPermissions, router]);

  // Admin section access guard: redirects away once the role_permissions
  // fetch has actually settled (permissionsLoaded) and the role isn't
  // allowed - waiting for that explicit signal (rather than just checking
  // menuPermissions !== null, which can't tell "still fetching" from
  // "fetched, no row") avoids kicking out a legitimate admin mid-fetch.
  // The second branch is the real boundary for nationality-only roles:
  // hiding the sidebar links alone would still leave every other admin page
  // reachable by typing its URL.
  useEffect(() => {
    if (!onAdminPath || !permissionsLoaded) return;
    if (!canEnterAdmin) {
      router.push("/dashboard");
    } else if (adminNationalityOnly && !ADMIN_NATIONALITY_PATHS.includes(pathname)) {
      router.push("/admin/rr4-nationality");
    }
  }, [onAdminPath, permissionsLoaded, canEnterAdmin, adminNationalityOnly, pathname, router]);

  // Idle sign-out - only runs once actually signed in (not on the login page
  // itself, and not for a still-Pending account, which already only shows
  // its own waiting screen with a manual sign-out button). Hard redirect
  // (window.location.href), same as the unauthorized-access path above, to
  // be sure the session is actually dead rather than relying on client
  // router state that a long-idle tab may have gone stale on.
  useEffect(() => {
    // Same exclusions as the Pending waiting screen: the reset-password page
    // and the forced-change screen both show no app data and carry their own
    // way out, and timing out mid-password-entry would just destroy the
    // session the user is there to fix.
    if (!isAuthorized || isLoginPage || pendingEmail || isResetPasswordPage || mustChangePasswordEmail) return;
    let timer: ReturnType<typeof setTimeout>;
    const handleIdleTimeout = async () => {
      await supabase.auth.signOut();
      window.location.href = "/?error=session_timeout";
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
    };
    const activityEvents = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [isAuthorized, isLoginPage, pendingEmail, isResetPasswordPage, mustChangePasswordEmail]);

  // Status poll - the Inactive/Pending checks in checkAuth above only re-run
  // on navigation (the effect is keyed on pathname), so a Super Admin
  // changing someone's status mid-session (Inactive, or reverting them to
  // Pending via Detail Profile's Status dropdown) wouldn't actually take
  // effect until that tab happened to navigate somewhere. Given the
  // sensitive data behind this login, poll the row directly every minute so
  // a still-open, never-navigated tab is caught within that window too.
  // Pending reloads rather than signing out, matching checkAuth's own
  // non-destructive handling (the waiting screen keeps its own manual
  // sign-out button) - only Inactive forces a hard sign-out.
  useEffect(() => {
    if (!isAuthorized || isLoginPage || pendingEmail || isResetPasswordPage || mustChangePasswordEmail) return;
    const checkStillActive = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("status").eq("id", user.id).single();
      if (profile?.status === "Inactive") {
        await supabase.auth.signOut();
        window.location.href = "/?error=inactive";
      } else if (profile?.status === "Pending") {
        window.location.reload();
      }
    };
    const interval = setInterval(checkStillActive, 60_000);
    return () => clearInterval(interval);
  }, [isAuthorized, isLoginPage, pendingEmail, isResetPasswordPage, mustChangePasswordEmail]);

  // Stands alone with no shell and no guard - see isResetPasswordPage above.
  if (isResetPasswordPage) {
    return <>{children}</>;
  }

  // Loading state to prevent flicker
  if (isAuthorized === null && !isLoginPage) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
      </div>
    );
  }

  // If not authorized and not on login page, don't show anything (redirect will happen)
  if (!isAuthorized && !isLoginPage) {
    return null;
  }

  // Pending approval takes priority over isLoginPage so a pending user landing
  // back on "/" sees the waiting screen instead of the login form again.
  if (pendingEmail) {
    return <PendingApprovalScreen email={pendingEmail} />;
  }

  // Same priority reasoning as pendingEmail above: takes precedence over
  // isLoginPage so landing back on "/" mid-flow doesn't hand back the login
  // form (and a route the user typed can't slip past it either).
  if (mustChangePasswordEmail) {
    return <ForcePasswordChangeScreen email={mustChangePasswordEmail} />;
  }

  if (isLoginPage) {
    return <>{children}</>;
  }

  // The kiosk is a check-in terminal, not a back-office page: it renders
  // full-screen with no sidebar, no top bar and no property switcher, the
  // way /reset-password stands alone - but *inside* the auth guard above,
  // never outside it. The provider still wraps it, since the kiosk screens
  // read the selected property through useSelectedProperty(). While
  // permissions are still resolving, show the same spinner the admin path
  // uses rather than flashing the terminal at a role that can't have it.
  if (onKioskPath) {
    if (!permissionsLoaded || !menuPermissions?.kiosk) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
        </div>
      );
    }
    return (
      <SelectedPropertyProvider>
        {children}
      </SelectedPropertyProvider>
    );
  }

  // Block rendering admin content for a non-Super-Admin: either permissions
  // are still resolving (show the spinner, matching the isAuthorized===null
  // state above) or they've resolved and access is denied (render nothing -
  // the effect above is already redirecting to /dashboard).
  if (onAdminPath && !isSuperAdminRole && (!permissionsLoaded || !menuPermissions?.admin)) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
      </div>
    );
  }

  // Falls back to the pre-Role-Settings hardcoded rule (Finance = Bills only,
  // everyone else = full menu) whenever menuPermissions hasn't loaded yet or
  // the role has no row in role_permissions - so a missing/misconfigured row
  // can never hide every link and strand a user with an empty sidebar.
  const isFinanceRole = userRole?.toLowerCase() === "finance";
  const perms: MenuPermissions = menuPermissions || {
    dashboard: !isFinanceRole,
    data_mart: !isFinanceRole,
    bills: true,
    rr3: !isFinanceRole,
    st_files: !isFinanceRole,
    revenue: !isFinanceRole,
    rv: !isFinanceRole,
    bcp: !isFinanceRole,
    rr4_tm30: !isFinanceRole,
    reconciliation: !isFinanceRole,
    // See the same field in src/lib/menuPermissions.ts for why this one
    // stays off in the fallback where its neighbours don't.
    users_report: false,
    // Off for the same reason: the fallback exists so a missing row can't
    // strand someone with an empty sidebar, and a full-screen guest check-in
    // terminal is not part of that floor.
    kiosk: false,
    admin: false,
  };
  const midSection = perms.data_mart || perms.bills || perms.rr3 || perms.st_files || perms.revenue || perms.rv || perms.bcp || perms.rr4_tm30 || perms.reconciliation || perms.users_report || perms.kiosk;
  const showTopDivider = perms.dashboard && midSection;
  // Log Import is no longer an individually-gated menu (used to be
  // perms.log_import) - it shows unconditionally for every role, since its
  // own page/API already show every property to whoever can reach it, so
  // per-role toggling never actually restricted anything.
  const showBottomDivider = midSection;

  // Shared between the desktop <aside> and the mobile slide-in drawer below -
  // one list rendered twice, so the two never drift out of sync. Every menu
  // keeps exactly the role_permissions gate it had before icons were added.
  const DIVIDER = "divider" as const;
  const navEntries: (NavEntry | typeof DIVIDER)[] = pathname.startsWith("/admin")
    ? [
        ...(!adminNationalityOnly
          ? [
              { href: "/admin", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/admin" },
              { href: "/admin/users", label: "User Management", icon: UserCog, active: pathname === "/admin/users" },
              { href: "/admin/smtp", label: "Email SMTP", icon: Mail, active: pathname === "/admin/smtp" },
              { href: "/admin/sync", label: "Sync & Schedule", icon: CalendarClock, active: pathname === "/admin/sync" },
              { href: "/admin/api-settings", label: "Property & API", icon: Building2, active: pathname === "/admin/api-settings" },
              { href: "/admin/templates", label: "Email Template", icon: LayoutTemplate, active: pathname === "/admin/templates" },
              { href: "/admin/revenue-settings", label: "Revenue Settings", icon: SlidersHorizontal, active: pathname === "/admin/revenue-settings" },
              { href: "/admin/kiosks", label: "Kiosks", icon: MonitorCog, active: pathname === "/admin/kiosks" },
            ]
          : []),
        { href: "/admin/rr4-nationality", label: "RR4-Nationality", icon: Flag, active: pathname === "/admin/rr4-nationality" },
        { href: "/admin/tm30-nationality", label: "TM30-Nationality", icon: Globe, active: pathname === "/admin/tm30-nationality" },
        ...(!adminNationalityOnly
          ? [{ href: "/admin/logs", label: "Activity Log", icon: ScrollText, active: pathname === "/admin/logs" }]
          : []),
      ]
    : [
        ...(perms.dashboard ? [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/dashboard" }] : []),
        ...(showTopDivider ? [DIVIDER] : []),
        ...(perms.data_mart ? [{ href: "/data-mart", label: "Data Mart", icon: Database, active: pathname === "/data-mart" }] : []),
        ...(perms.bills ? [{ href: "/bill-generator", label: "Bills", icon: ReceiptText, active: pathname === "/bill-generator" }] : []),
        ...(perms.rr3 ? [{ href: "/rr3", label: "RR3", icon: IdCard, active: pathname === "/rr3" }] : []),
        ...(perms.st_files ? [{ href: "/st-files", label: "Statistic Files", icon: ChartColumnBig, active: pathname === "/st-files" }] : []),
        ...(perms.rv ? [{ href: "/rv", label: "Revenue Files", icon: FileSpreadsheet, active: pathname === "/rv" }] : []),
        ...(perms.bcp ? [{ href: "/bcp", label: "BCP", icon: LifeBuoy, active: pathname === "/bcp" }] : []),
        ...(perms.rr4_tm30 ? [{ href: "/rr4-tm30", label: "RR4/TM30", icon: BookUser, active: pathname.startsWith("/rr4-tm30") }] : []),
        ...(perms.revenue ? [{ href: "/revenue", label: "Revenue", icon: TrendingUp, active: pathname === "/revenue" }] : []),
        ...(perms.reconciliation ? [{ href: "/reconciliation", label: "Reconciliation", icon: Scale, active: pathname === "/reconciliation" }] : []),
        ...(perms.users_report ? [{ href: "/users-report", label: "Users Report", icon: Users, active: pathname === "/users-report" }] : []),
        ...(perms.kiosk ? [{ href: "/kiosk", label: "Kiosk", icon: MonitorSmartphone, active: pathname.startsWith("/kiosk") }] : []),
        ...(showBottomDivider ? [DIVIDER] : []),
        { href: "/log-import", label: "Log Import", icon: History, active: pathname === "/log-import" },
      ];

  const renderNav = (collapsed: boolean) => (
    <nav className="flex flex-col gap-1">
      {navEntries.map((entry, i) =>
        entry === DIVIDER ? (
          <div key={`divider-${i}`} className={`h-px bg-white/5 my-3 ${collapsed ? "mx-2" : "mx-3"}`} />
        ) : (
          <NavItem key={entry.href} {...entry} collapsed={collapsed} />
        )
      )}
    </nav>
  );

  const renderExitAdmin = (collapsed: boolean) =>
    pathname.startsWith("/admin") && (
      <Link
        href="/dashboard"
        aria-label={collapsed ? "Exit Admin" : undefined}
        className={`group relative flex items-center gap-2 rounded-md border border-white/10 text-[11px] font-bold tracked-caps text-white/50 hover:text-white hover:bg-white/5 transition-all ${
          collapsed ? "justify-center py-2.5" : "px-4 py-3"
        }`}
      >
        <ArrowLeft aria-hidden="true" className="w-4 h-4 shrink-0 text-white/30 group-hover:text-white transition-colors" />
        {collapsed ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-md bg-[#0d1a00] px-2.5 py-1.5 text-[11px] font-bold tracked-caps text-white opacity-0 shadow-lg ring-1 ring-[#FFEFD2]/15 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
          >
            Exit Admin
          </span>
        ) : (
          "EXIT ADMIN"
        )}
      </Link>
    );

  return (
    // The one property every page reads (useSelectedProperty) - mounted only
    // here, inside the signed-in shell, so its list is fetched with a session
    // and after the role is known.
    <SelectedPropertyProvider>
    <div className="min-h-full flex flex-col lg:flex-row bg-background text-foreground w-full transition-colors duration-300">
      {/* Mobile top bar - the desktop <aside> below is hidden under lg, so
          this is the only way to reach the hamburger drawer (and therefore
          any other page) on a phone or tablet. lg (1024px) rather than md
          (768px) specifically so iPad portrait (768-834px across Mini/Air/
          Pro 11") gets the full-width hamburger layout instead of a fixed
          192px sidebar eating a quarter of an already-narrow screen -
          iPad landscape (1024px+) still gets the full desktop sidebar. */}
      <div className="app-topbar print:hidden lg:hidden flex items-center justify-between px-4 py-3 bg-[#152A00] border-b border-[#FFEFD2]/10 sticky top-0 z-40 shrink-0">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="p-2 -ml-2 text-white/80 hover:text-white"
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
        <div className="flex items-center gap-2">
          <img src="https://guideline.lubd.com/wp-content/uploads/2026/09/NHG100.png" alt="NHG Logo" className="w-8 h-8 object-contain" />
          <div className="text-lg font-light font-sans text-white tracking-tight leading-none">NHGOne</div>
        </div>
        <div className="flex items-center gap-2">
          <PropertySwitcher compact />
          <ThemeToggle />
          <ProfileMenu variant="topbar" />
        </div>
      </div>

      {mobileNavOpen && (
        <div className="print:hidden lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="relative w-72 max-w-[82vw] h-full bg-[#152A00] p-4 flex flex-col gap-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between">
              {onAdminPath ? (
                <div className="flex items-center gap-3 px-3 py-3 bg-[#FFEFD2]/10 border border-[#FFEFD2]/20 rounded-sm flex-1 mr-2">
                  <div className="w-8 h-8 rounded-sm bg-[#FFEFD2]/15 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-[#FFEFD2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold font-display text-white tracking-tight leading-none">ADMIN CONSOLE</div>
                    <div className="text-[9px] font-bold tracked-caps text-[#FFEFD2]/60 mt-1">SUPER ADMIN ACCESS</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <img src="https://guideline.lubd.com/wp-content/uploads/2026/09/NHG100.png" alt="NHG Logo" className="w-11 h-11 object-contain" />
                  <div className="text-xl font-light font-sans text-white tracking-tight leading-none">NHGOne</div>
                </div>
              )}
              <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu" className="p-2 text-white/60 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {renderNav(false)}
            <div className="mt-auto pb-2">{renderExitAdmin(false)}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar. The hamburger at its top collapses it to icons only
          (each link then shows its name as a tooltip), the way MEWS's own left
          menu works, and the choice is remembered per browser. Overflow is
          opened up only while collapsed so those tooltips can escape the 72px
          rail - expanded, a long menu still scrolls inside the sidebar. */}
      <aside
        className={`print:hidden hidden lg:flex lg:h-screen shrink-0 flex-col gap-4 overflow-visible border-r border-[#FFEFD2]/10 bg-[#152A00] py-4 transition-[width] duration-200 ease-out ${
          sidebarCollapsed ? "w-[72px] px-2" : `${onAdminPath ? "w-60" : "w-56"} px-3`
        }`}
      >
        <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "gap-2.5"}`}>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!sidebarCollapsed}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md text-white/70 hover:text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFEFD2]/40 transition-colors"
          >
            <Menu aria-hidden="true" className="w-5 h-5" strokeWidth={2} />
          </button>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="https://guideline.lubd.com/wp-content/uploads/2026/09/NHG100.png"
                alt="NHG Logo"
                className="w-9 h-9 object-contain shrink-0"
              />
              <div className="text-lg font-light font-sans text-white tracking-tight leading-none truncate">
                NHGOne
              </div>
            </div>
          )}
        </div>

        {onAdminPath &&
          (sidebarCollapsed ? (
            // Collapsed, the Admin Console badge shrinks to its shield, so the
            // rail still says which area you are in.
            <div className="group relative flex justify-center">
              <div
                aria-label="Admin Console"
                className="w-10 h-10 rounded-md bg-[#FFEFD2]/10 border border-[#FFEFD2]/20 flex items-center justify-center"
              >
                <ShieldCheck aria-hidden="true" className="w-[18px] h-[18px] text-[#FFEFD2]" />
              </div>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-md bg-[#0d1a00] px-2.5 py-1.5 text-[11px] font-bold tracked-caps text-white opacity-0 shadow-lg ring-1 ring-[#FFEFD2]/15 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
              >
                Admin Console
              </span>
            </div>
          ) : (
            // Admin-only badge - visually marks "you're in a different,
            // higher-privilege area" the way EXIT ADMIN does at the bottom of
            // this same sidebar.
            <div className="flex items-center gap-3 px-3 py-3 bg-[#FFEFD2]/10 border border-[#FFEFD2]/20 rounded-md">
              <div className="w-8 h-8 rounded-sm bg-[#FFEFD2]/15 flex items-center justify-center shrink-0">
                <ShieldCheck aria-hidden="true" className="w-4 h-4 text-[#FFEFD2]" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold font-display text-white tracking-tight leading-none">
                  ADMIN CONSOLE
                </div>
                <div className="text-[9px] font-bold tracked-caps text-[#FFEFD2]/60 mt-1">
                  SUPER ADMIN ACCESS
                </div>
              </div>
            </div>
          ))}

        {/* Only the link list scrolls. The sidebar itself keeps its overflow
            visible so the collapsed rail's tooltips - and the account menu
            below - can escape the 72px rail instead of being clipped by it. */}
        <div className={`flex-1 min-h-0 ${sidebarCollapsed ? "" : "overflow-y-auto overflow-x-hidden"}`}>
          {renderNav(sidebarCollapsed)}
        </div>

        {/* The signed-in user, at the bottom of the sidebar the way MEWS puts
            it - not in the page header, which now carries the property
            switcher instead. */}
        <div className="flex flex-col gap-3 pb-1">
          {renderExitAdmin(sidebarCollapsed)}
          <div className="border-t border-white/10 pt-3">
            <ProfileMenu variant="sidebar" collapsed={sidebarCollapsed} />
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col lg:h-screen overflow-hidden relative min-h-0">
        <div className="flex-1 overflow-y-auto w-full">
          {children}
        </div>
      </main>
    </div>
    </SelectedPropertyProvider>
  );
}
