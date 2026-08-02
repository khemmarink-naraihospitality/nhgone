import { supabase } from "@/lib/supabase";

// Drop-in replacement for the native fetch() for every /api/* call - the
// FastAPI backend now rejects requests with no valid Supabase session (see
// api/app/deps.py), so every call site needs the signed-in user's access
// token attached as a Bearer header. Same signature/return type as fetch()
// so existing `await res.json()` call sites don't need to change.
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}
