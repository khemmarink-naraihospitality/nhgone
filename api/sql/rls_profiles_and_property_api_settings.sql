-- =====================================================================
-- Finish the RLS rollout: profiles + property_api_settings
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- WHY THIS FILE EXISTS: the other 15 tables were switched on directly, but
-- these two carry legacy policies that must be DROPPED first, and dropping
-- policies is blocked from the agent tooling. Everything else is done.
--
-- RLS: this ENABLES row level security on both tables. Both are reached
-- from the browser with the PUBLIC anon key (it ships inside the JS
-- bundle), so today anyone on the internet can read them without an
-- account. Every frontend call to them happens after
-- supabase.auth.getUser(), so scoping access to the `authenticated` role
-- removes anonymous access while changing nothing for real users.
-- The FastAPI backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- entirely and is unaffected.
--
-- The three policies dropped below are currently DORMANT (RLS is off, so
-- they do nothing). Each would be actively harmful the moment RLS is
-- enabled, which is why they are replaced rather than kept:
--
--   profiles "Profiles are viewable by everyone"
--       SELECT / role `public` / USING (true). `public` includes anon, so
--       enabling RLS with this in place would leave every user profile
--       readable by the whole internet - i.e. no fix at all.
--
--   profiles "Super Admins can update any profile"
--       Its USING clause runs `SELECT ... FROM profiles` against the very
--       table the policy guards. Postgres re-enters the policy to evaluate
--       that subquery and raises "infinite recursion detected in policy for
--       relation profiles", which would break profile updates outright.
--
--   profiles "Users can update their own profiles"
--       USING (auth.uid() = id) looks right but breaks first-time Google
--       sign-in. Navigation.tsx repairs a profile that was pre-registered
--       under a different UUID by updating it BY EMAIL, at a moment when
--       the row's id still does NOT equal auth.uid() - the USING test is
--       applied to the OLD row, so the repair is rejected and the user is
--       signed out as unauthorized.
--
--   property_api_settings "Enable all for service role"
--       Despite the name it is ALL / role `public` / USING (true) - the
--       service role never needed a policy (it bypasses RLS). In practice
--       this grants full read AND write on the encrypted MEWS token table
--       to anyone holding the anon key.
--
--   property_api_settings "Enable select for all"
--       SELECT / role `public` / USING (true) - same public-read problem.
--
-- The surviving "Allow authenticated users to update sync settings" policy
-- on property_api_settings is already correct (UPDATE / authenticated) and
-- is deliberately left in place - it is what Admin > Property & API and
-- Admin > Sync use to save settings.
--
-- TO ROLL BACK (if anything misbehaves), run:
--   ALTER TABLE public.profiles              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.property_api_settings DISABLE ROW LEVEL SECURITY;
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "Profiles are viewable by everyone"   ON public.profiles;
DROP POLICY IF EXISTS "Super Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profiles" ON public.profiles;

DROP POLICY IF EXISTS "Enable all for service role"         ON public.property_api_settings;
DROP POLICY IF EXISTS "Enable select for all"               ON public.property_api_settings;

-- profiles: read is needed by the auth guard, the admin user list, and the
-- role/permission lookups; update is needed by Profile, reset-password and
-- the first-Google-login id repair described above.
CREATE POLICY "authenticated_read"  ON public.profiles
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write" ON public.profiles
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- property_api_settings: the browser only ever SELECTs non-secret columns
-- here (property_name, sync_*, st_files_email_*) - never the encrypted
-- tokens. Updates keep flowing through the existing authenticated policy.
CREATE POLICY "authenticated_read"  ON public.property_api_settings
    FOR SELECT TO authenticated USING (true);

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_api_settings ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verify (expect rls_enabled = true for both, and only the policies above):
--   SELECT c.relname, c.relrowsecurity
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
--   -- should return zero rows once this has run.
