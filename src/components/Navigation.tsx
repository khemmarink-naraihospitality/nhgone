"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import UserHeader from "./UserHeader";
import { supabase } from "@/lib/supabase";

export default function Navigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/";
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

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
        .select("id, email")
        .eq("id", user.id)
        .single();

      let finalProfile = profile;
      
      // Secondary check by email if ID check didn't return data (just in case of sync issues)
      if (!finalProfile && user.email) {
        const { data: emailProfile } = await supabase
          .from("profiles")
          .select("id, email")
          .eq("email", user.email)
          .single();
        finalProfile = emailProfile;
      }

      if (error && error.code !== 'PGRST116' && !finalProfile) {
         console.error("Auth Guard Error:", error);
      }

      if (!finalProfile) {
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
      } else {
        // Authorized!
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
              <Link href="/admin/logs" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/admin/logs" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Activity Log</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/dashboard" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Dashboard</Link>
              <div className="h-px bg-white/5 my-4 mx-4"></div>
              <Link href="/live-data" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/live-data" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Live Data</Link>
              <Link href="/data-mart" className={`px-4 py-2 border-l-2 transition-all text-[12px] tracked-caps ${pathname === "/data-mart" ? "text-white font-bold bg-[#FFEFD2]/10 border-[#FFEFD2]" : "text-white/40 border-transparent hover:text-white"}`}>Data Mart</Link>
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
