"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import { getBaseUrl } from "@/lib/url";
import { Suspense } from "react";

function LoginContent() {
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Swaps the email/password form for the single-field reset request, rather
  // than opening a separate page - the email is usually already typed.
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const isUnauthorized = searchParams.get("error") === "unauthorized";
  const isSessionTimeout = searchParams.get("error") === "session_timeout";
  const isInactive = searchParams.get("error") === "inactive";
  const displayError = isUnauthorized
    ? "Unauthorized access. Your account is not registered in the system. Please contact BusinessTech Team"
    : isSessionTimeout
    ? "You were signed out due to inactivity. Please sign in again."
    : isInactive
    ? "Your account has been deactivated. Please contact the IT Department."
    : errorMsg;

  const handleEmailLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      
      if (error) throw error;
      
      router.push("/dashboard");
    } catch (err: any) {
      console.error("Email Auth Error", err);
      setErrorMsg(err.message || "Failed to login");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setForgotSending(true);
    setErrorMsg("");
    try {
      // Same-origin path, not NEXT_PUBLIC_API_URL - see the Admin > Users
      // create-user call for why that env var can't be trusted here.
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch (err) {
      console.error("Forgot password request failed", err);
    } finally {
      // Always the same confirmation, success or not: the endpoint itself is
      // deliberately blind to whether the address exists (see its docstring),
      // and a UI that reported failures would undo that.
      setForgotSending(false);
      setForgotSent(true);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${getBaseUrl()}/dashboard`,
        },
      });
      if (error) throw error;
    } catch (err) {
      console.error("Google Auth Error", err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFEFD2] p-4 font-sans text-[#152A00]">
      {/* Background Architectural Elements */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-1/2 border-l border-b border-[#152A00]" />
        <div className="absolute bottom-0 left-0 w-1/4 h-1/4 border-r border-t border-[#152A00]" />
      </div>
      
      <div className="relative w-full max-w-sm bg-white border border-[#152A00]/10 rounded-sm shadow-[20px_20px_60px_rgba(21,42,0,0.05)] p-8 md:p-10 transition-all">
        <div className="flex flex-col items-center">
          {/* Logo */}
          <div className="mb-6 p-2 border border-[#152A00]/10 rounded-sm bg-white">
             <img 
               src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png" 
               alt="NHG Logo" 
               className="w-8 h-8 object-contain"
             />
          </div>

          <h1 className="text-4xl font-black font-display mb-2 tracking-tight text-[#152A00]">NHGOne</h1>
          <p className="text-[#152A00] text-[9px] mb-8 text-center font-bold tracked-caps opacity-60">Enterprise Narai Hospitality Group Data Assets</p>

          {/* Google Button */}
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-4 py-3.5 px-6 border border-[#152A00] rounded-sm text-[11px] font-bold tracked-caps text-[#152A00] bg-white hover:bg-[#152A00] hover:text-[#FFEFD2] transition-all active:scale-[0.985]"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="fill-current">
              <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" />
              <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957273V13.0418C2.43818 15.9832 5.48182 18 9 18Z" />
              <path d="M3.96409 10.71C3.78409 10.1741 3.68182 9.60136 3.68182 9C3.68182 8.39864 3.78409 7.82591 3.96409 7.29V4.95818H0.957273C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957273 13.0418L3.96409 10.71Z" />
              <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957273 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative w-full flex items-center my-8">
            <div className="flex-grow border-t border-[#152A00]/10"></div>
            <button 
              onClick={() => setShowEmailLogin(!showEmailLogin)}
              className="flex-shrink mx-4 text-[10px] font-bold tracked-caps text-[#AAA024] hover:text-[#152A00] transition-colors"
            >
              INTERNAL USERS
            </button>
            <div className="flex-grow border-t border-[#152A00]/10"></div>
          </div>

          {/* Redirect-driven errors (unauthorized/session_timeout/inactive) must
              show regardless of whether Internal Auth is expanded - this used
              to live inside the form below, so it silently never rendered
              for anyone who landed here without already having clicked
              "Internal Auth" (i.e. everyone redirected here from Google
              sign-in, which is the common case). */}
          {displayError && (
            <p className="w-full text-red-600 text-[11px] font-bold leading-relaxed bg-red-50 p-3 border-l-2 border-red-600 mb-2">
              {displayError}
            </p>
          )}

          {/* Conditional Email Input */}
          {showEmailLogin && !forgotMode && (
            <form onSubmit={handleEmailLogin} className="w-full space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracked-caps text-[#152A00]/60 ml-1">Your Alias Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@naraihospitality.com"
                  required
                  className="w-full px-4 py-3 rounded-sm border border-[#152A00]/10 focus:border-[#AAA024] outline-none transition-all text-sm bg-[#FFEFD2]/10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracked-caps text-[#152A00]/60 ml-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full px-4 py-3 rounded-sm border border-[#152A00]/10 focus:border-[#AAA024] outline-none transition-all text-sm bg-[#FFEFD2]/10"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985] disabled:opacity-70"
              >
                {loading ? "SIGNING IN..." : "LOGIN"}
              </button>

              <button
                type="button"
                onClick={() => { setForgotMode(true); setErrorMsg(""); }}
                className="w-full text-[10px] font-bold tracked-caps text-[#152A00]/50 hover:text-[#AAA024] transition-colors"
              >
                Forgot Password?
              </button>
            </form>
          )}

          {/* Forgot-password request - replaces the sign-in form rather than
              sitting below it, so there's only ever one submit button on
              screen and the shared email field can't be ambiguous. */}
          {showEmailLogin && forgotMode && (
            forgotSent ? (
              <div className="w-full text-center">
                <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-[#AAA024]/10 flex items-center justify-center">
                  <svg className="w-6 h-6 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8">
                  If that email belongs to an NHGOne account, a reset link is on its way. It can only be used once and expires within the hour.
                </p>
                <button
                  type="button"
                  onClick={() => { setForgotMode(false); setForgotSent(false); }}
                  className="w-full py-3 border border-[#152A00] rounded-sm text-[11px] font-bold tracked-caps text-[#152A00] hover:bg-[#152A00] hover:text-[#FFEFD2] transition-all"
                >
                  BACK TO LOGIN
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="w-full space-y-6">
                <p className="text-xs text-[#152A00]/60 leading-relaxed">
                  Enter your alias email and we&apos;ll send you a link to set a new password.
                </p>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold tracked-caps text-[#152A00]/60 ml-1">Your Alias Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@naraihospitality.com"
                    required
                    className="w-full px-4 py-3 rounded-sm border border-[#152A00]/10 focus:border-[#AAA024] outline-none transition-all text-sm bg-[#FFEFD2]/10"
                  />
                </div>
                <button
                  type="submit"
                  disabled={forgotSending}
                  className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985] disabled:opacity-70"
                >
                  {forgotSending ? "SENDING..." : "SEND RESET LINK"}
                </button>
                <button
                  type="button"
                  onClick={() => setForgotMode(false)}
                  className="w-full text-[10px] font-bold tracked-caps text-[#152A00]/50 hover:text-[#AAA024] transition-colors"
                >
                  Back to Login
                </button>
              </form>
            )
          )}
          
          <div className="mt-8 text-center text-[8px] text-gray-400 font-light italic tracked-caps leading-relaxed max-w-[280px]">
            AUTHORISED PERSONNEL ONLY. ACCESS IS LOGGED AND MONITORED.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f0f2f5]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#AAA024]"></div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
