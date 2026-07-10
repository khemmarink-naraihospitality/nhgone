"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import UserHeader from "./UserHeader";
import { supabase } from "@/lib/supabase";

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
        <h1 className="text-xl font-black font-display mb-2 tracking-tight">Waiting for Approval</h1>
        <p className="text-[10px] font-bold tracked-caps text-[#152A00]/50 mb-6">รอการอนุมัติจากผู้ดูแลระบบ</p>
        <p className="text-sm text-[#152A00]/70 leading-relaxed mb-1">
          Your account (<span className="font-bold">{email}</span>) has been created and is pending approval from a Super Admin.
        </p>
        <p className="text-xs text-[#152A00]/50 leading-relaxed mb-8">
          บัญชีของคุณถูกสร้างแล้ว กรุณารอ Super Admin อนุมัติสิทธิ์การใช้งานก่อนเข้าสู่ระบบ
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

export default function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/";
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
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
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("id, email, role, status")
        .eq("id", user.id)
        .single();

      let finalProfile = profile;

      // Secondary check by email if ID check didn't return data (just in case of sync issues,
      // or on first Google OAuth login where profile was pre-registered with a different UUID)
      if (!finalProfile && user.email) {
        const { data: emailProfile } = await supabase
          .from("profiles")
          .select("id, email, role, status")
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
      } else if (finalProfile.status === "pending") {
        // Approved but not yet reviewed - show the waiting screen instead of
        // the normal app shell/menus (see PendingApprovalScreen above).
        setPendingEmail(finalProfile.email || user.email || "");
        setIsAuthorized(true);
      } else {
        // Authorized!
        setPendingEmail(null);
        setUserRole(finalProfile.role || null);
        if (isLoginPage && pathname === "/") {
          router.push("/dashboard");
        }
        setIsAuthorized(true);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setIsAuthorized(false);
        setPendingEmail(null);
        router.push("/");
      } else if (event === 'SIGNED_IN') {
        checkAuth();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, isLoginPage, router]);

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

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-full flex bg-background text-foreground w-full transition-colors duration-300">
      <aside className="w-48 border-r border-[#FFEFD2]/10 p-4 flex flex-col gap-6 hidden md:flex shrink-0 bg-[#152A00] transition-colors duration-300">
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
        <nav className="flex flex-col gap-1">
          {pathname.startsWith("/admin") ? (
            <>
              <Link href="/admin" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Dashboard</Link>
              <Link href="/admin/users" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/users" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>User Management</Link>
              <Link href="/admin/smtp" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/smtp" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Email SMTP</Link>
              <Link href="/admin/sync" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/sync" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Auto Sync</Link>
              <Link href="/admin/api-settings" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/api-settings" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>API Setting</Link>
              <Link href="/admin/templates" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/templates" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Templates</Link>
              <Link href="/admin/logs" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/logs" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Activity Log</Link>
            </>
          ) : userRole?.toLowerCase() === "finance" ? (
            <Link href="/bill-generator" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/bill-generator" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Bills</Link>
          ) : (
            <>
              <Link href="/dashboard" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/dashboard" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Dashboard</Link>
              <div className="h-px bg-white/5 my-4 mx-4"></div>
              <Link href="/data-mart" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/data-mart" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Data Mart</Link>
              <Link href="/bill-generator" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/bill-generator" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Bills</Link>
              <Link href="/rr3" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/rr3" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>RR3</Link>
              <div className="h-px bg-white/5 my-4 mx-4"></div>
              <Link href="/log-import" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/log-import" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Log Import</Link>
            </>
          )}
        </nav>

        <div className="mt-auto pb-4">
           {pathname.startsWith("/admin") && (
             <Link href="/dashboard" className="flex items-center gap-2 px-4 py-3 text-[11px] font-bold tracked-caps text-white/50 hover:text-white hover:bg-white/5 border border-white/10 transition-all group">
                <svg className="w-4 h-4 text-white/30 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                EXIT ADMIN
             </Link>
           )}
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <div className="flex-1 overflow-y-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
