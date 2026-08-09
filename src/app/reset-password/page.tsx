"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * Where the "Forgot password" email's recovery link lands.
 *
 * The link is a Supabase recovery action_link minted server-side (see the
 * FastAPI auth router) and sent through this app's own SMTP. Clicking it
 * bounces through Supabase's /verify endpoint, which redirects here with the
 * session in the URL fragment; supabase-js picks that up on its own
 * (detectSessionInUrl defaults to true), so by the time this page settles
 * there is a real - if short-lived and recovery-scoped - session to call
 * updateUser with.
 *
 * Navigation.tsx deliberately renders this route with no auth guard and no
 * app shell (isResetPasswordPage), because the visitor arrives holding a
 * one-time token rather than a normal login.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  // null = still waiting to hear whether the recovery link produced a session
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let settled = false;

    // Two ways to learn the token worked, because the race between them
    // depends on how fast the fragment is parsed: the PASSWORD_RECOVERY event
    // if supabase-js is still mid-parse when this mounts, or an already-live
    // session if it finished first.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
        settled = true;
        setHasSession(true);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        settled = true;
        setHasSession(true);
      }
    });

    // Nothing arrived - an expired, already-used, or hand-typed link. Give
    // the fragment parse a moment before saying so, rather than flashing an
    // error at someone whose link is perfectly fine.
    const timer = setTimeout(() => {
      if (!settled) setHasSession(false);
    }, 2500);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

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
      if (!user) throw new Error("This reset link is no longer valid. Please request a new one.");
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) throw pwError;
      // They just chose this password themselves, so the forced-change gate
      // (set when an admin creates an Internal Auth account) no longer
      // applies - clearing it here stops the change screen greeting them
      // again the moment they land on the dashboard.
      await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setSaving(false);
    }
  };

  const shell = (inner: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-[#FFEFD2] p-4 font-sans text-[#152A00]">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-1/2 border-l border-b border-[#152A00]" />
        <div className="absolute bottom-0 left-0 w-1/4 h-1/4 border-r border-t border-[#152A00]" />
      </div>
      <div className="relative w-full max-w-sm bg-white border border-[#152A00]/10 rounded-sm shadow-[20px_20px_60px_rgba(21,42,0,0.05)] p-8 md:p-10">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-6 p-2 border border-[#152A00]/10 rounded-sm bg-white">
            <img
              src="https://guideline.lubd.com/wp-content/uploads/2025/11/NHG128.png"
              alt="NHG Logo"
              className="w-8 h-8 object-contain"
            />
          </div>
          <h1 className="text-4xl font-black font-display mb-2 tracking-tight text-[#152A00]">NHGOne</h1>
          <p className="text-[#152A00] text-[9px] text-center font-bold tracked-caps opacity-60">
            Enterprise Narai Hospitality Group Data Assets
          </p>
        </div>
        {inner}
      </div>
    </div>
  );

  if (hasSession === null) {
    return shell(
      <div className="flex justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#AAA024]" />
      </div>
    );
  }

  if (hasSession === false) {
    return shell(
      <div className="text-center">
        <h2 className="text-lg font-black font-display mb-3 tracking-tight">Link Expired</h2>
        <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8">
          This password reset link is no longer valid. Reset links can only be used once and expire within the hour.
        </p>
        <button
          onClick={() => router.push("/")}
          className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985]"
        >
          BACK TO LOGIN
        </button>
      </div>
    );
  }

  if (done) {
    return shell(
      <div className="text-center">
        <div className="mx-auto mb-6 w-14 h-14 rounded-full bg-[#AAA024]/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-[#AAA024]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-black font-display mb-3 tracking-tight">Password Updated</h2>
        <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8">
          Your new password is ready to use.
        </p>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985]"
        >
          CONTINUE TO NHGONE
        </button>
      </div>
    );
  }

  return shell(
    <>
      <h2 className="text-lg font-black font-display mb-2 tracking-tight text-center">Set a New Password</h2>
      <p className="text-sm text-[#152A00]/70 leading-relaxed mb-8 text-center">
        Choose a new password for your NHGOne account.
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
          <p className="text-red-600 text-[11px] font-bold leading-relaxed bg-red-50 p-3 border-l-2 border-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 bg-[#152A00] text-[#FFEFD2] rounded-sm text-[11px] font-bold tracked-caps hover:bg-[#250719] transition-all active:scale-[0.985] disabled:opacity-70"
        >
          {saving ? "SAVING..." : "UPDATE PASSWORD"}
        </button>
      </form>
    </>
  );
}
