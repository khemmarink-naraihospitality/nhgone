"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import UserHeader from "./UserHeader";
import { supabase } from "@/lib/supabase";

interface MenuPermissions {
  dashboard: boolean;
  data_mart: boolean;
  bills: boolean;
  rr3: boolean;
  st_files: boolean;
  rv: boolean;
  bcp: boolean;
  rr4_tm30: boolean;
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

// Auto sign-out after 5 minutes with no mouse/keyboard/touch/scroll activity
// anywhere in the app - a shared front-desk workstation left unattended
// otherwise stays logged into whichever staff account opened it.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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

  // Admin section access guard: redirects away once the role_permissions
  // fetch has actually settled (permissionsLoaded) and the role isn't
  // allowed - waiting for that explicit signal (rather than just checking
  // menuPermissions !== null, which can't tell "still fetching" from
  // "fetched, no row") avoids kicking out a legitimate admin mid-fetch.
  useEffect(() => {
    if (onAdminPath && !isSuperAdminRole && permissionsLoaded && !menuPermissions?.admin) {
      router.push("/dashboard");
    }
  }, [onAdminPath, isSuperAdminRole, permissionsLoaded, menuPermissions, router]);

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
    rv: !isFinanceRole,
    bcp: !isFinanceRole,
    rr4_tm30: !isFinanceRole,
    admin: false,
  };
  const midSection = perms.data_mart || perms.bills || perms.rr3 || perms.st_files || perms.rv || perms.bcp || perms.rr4_tm30;
  const showTopDivider = perms.dashboard && midSection;
  // Log Import is no longer an individually-gated menu (used to be
  // perms.log_import) - it shows unconditionally for every role, since its
  // own page/API already show every property to whoever can reach it, so
  // per-role toggling never actually restricted anything.
  const showBottomDivider = midSection;

  // Shared between the desktop <aside> (always visible at md+) and the
  // mobile slide-in drawer below - written once so the two never drift out
  // of sync with each other.
  const navLinks = (
    <nav className="flex flex-col gap-1">
      {pathname.startsWith("/admin") ? (
        <>
          <Link href="/admin" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Dashboard</Link>
          <Link href="/admin/users" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/users" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>User Management</Link>
          <Link href="/admin/smtp" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/smtp" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Email SMTP</Link>
          <Link href="/admin/sync" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/sync" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Sync & Schedule</Link>
          <Link href="/admin/api-settings" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/api-settings" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>API</Link>
          <Link href="/admin/templates" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/templates" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Templates</Link>
          <Link href="/admin/logs" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/admin/logs" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Activity Log</Link>
        </>
      ) : (
        <>
          {perms.dashboard && (
            <Link href="/dashboard" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/dashboard" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Dashboard</Link>
          )}
          {showTopDivider && <div className="h-px bg-white/5 my-4 mx-4"></div>}
          {perms.data_mart && (
            <Link href="/data-mart" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/data-mart" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Data Mart</Link>
          )}
          {perms.bills && (
            <Link href="/bill-generator" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/bill-generator" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Bills</Link>
          )}
          {perms.rr3 && (
            <Link href="/rr3" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/rr3" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>RR3</Link>
          )}
          {perms.st_files && (
            <Link href="/st-files" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/st-files" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Statistic Files</Link>
          )}
          {perms.rv && (
            <Link href="/rv" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/rv" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Revenue Files</Link>
          )}
          {perms.bcp && (
            <Link href="/bcp" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/bcp" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>BCP</Link>
          )}
          {perms.rr4_tm30 && (
            <Link href="/rr4-tm30" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/rr4-tm30" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>RR4/TM30</Link>
          )}
          {showBottomDivider && <div className="h-px bg-white/5 my-4 mx-4"></div>}
          <Link href="/log-import" className={`px-4 py-3 md:py-2 border-l-2 transition-all text-[13px] md:text-[12px] tracked-caps ${pathname === "/log-import" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Log Import</Link>
        </>
      )}
    </nav>
  );

  const exitAdminLink = pathname.startsWith("/admin") && (
    <Link href="/dashboard" className="flex items-center gap-2 px-4 py-3 text-[11px] font-bold tracked-caps text-white/50 hover:text-white hover:bg-white/5 border border-white/10 transition-all group">
      <svg className="w-4 h-4 text-white/30 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      EXIT ADMIN
    </Link>
  );

  return (
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
          <div className="bg-white p-1 rounded-sm">
            <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" alt="NHG Logo" className="w-6 h-6 object-contain" />
          </div>
          <div className="text-lg font-bold font-display text-white tracking-tight leading-none">NHGOne</div>
        </div>
        <UserHeader />
      </div>

      {mobileNavOpen && (
        <div className="print:hidden lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="relative w-72 max-w-[82vw] h-full bg-[#152A00] p-4 flex flex-col gap-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white p-1.5 rounded-sm">
                  <img src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" alt="NHG Logo" className="w-8 h-8 object-contain" />
                </div>
                <div className="text-xl font-bold font-display text-white tracking-tight leading-none">NHGOne</div>
              </div>
              <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu" className="p-2 text-white/60 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {navLinks}
            <div className="mt-auto pb-2">{exitAdminLink}</div>
          </div>
        </div>
      )}

      <aside className="print:hidden w-48 border-r border-[#FFEFD2]/10 p-4 flex flex-col gap-6 hidden lg:flex shrink-0 bg-[#152A00] transition-colors duration-300">
        <div className="flex items-center gap-4 mb-2">
          <div className="bg-white p-1.5 rounded-sm">
            <img
              src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png"
              alt="NHG Logo"
              className="w-8 h-8 object-contain"
            />
          </div>
          <div className="text-xl font-bold font-display text-white tracking-tight leading-none">
            NHGOne
          </div>
        </div>
        {navLinks}

        <div className="mt-auto pb-4">{exitAdminLink}</div>
      </aside>
      <main className="flex-1 flex flex-col lg:h-screen overflow-hidden relative min-h-0">
        <div className="flex-1 overflow-y-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
