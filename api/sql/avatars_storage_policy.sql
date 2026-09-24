-- Fixes "new row violates row-level security policy" on Profile > avatar
-- upload. The avatars bucket (created manually in Supabase, never tracked
-- here - see CLAUDE.md's "Storage buckets" note) is the one bucket this app
-- writes to straight from the browser rather than through the backend, so
-- it needs REAL storage.objects RLS policies for the `authenticated` role,
-- not just the bucket existing. `storage.objects` has RLS enabled by
-- default in every Supabase project, so a bucket with no policies denies
-- every client-side read/write - which is exactly this symptom, confirmed
-- 24-Sep-2026: the service role (bypasses RLS) could upload to `avatars`
-- fine, but the signed-in browser session got the RLS error.
--
-- src/app/profile/page.tsx uploads to `<user.id>/avatar.<png|jpg>` - one
-- file per user, keyed by their own auth.uid(). The three policies below
-- let a signed-in user write ONLY inside their own folder (upsert can hit
-- either INSERT or UPDATE depending on whether they've uploaded before, so
-- both are needed; DELETE is included for completeness even though the
-- page has no remove-photo button today). No SELECT policy is needed: the
-- bucket is public (`public = true`), so `getPublicUrl()` reads are served
-- by Storage's public object endpoint, which bypasses RLS entirely for
-- GETs - the same reason property-images/kiosk-images need no policies at
-- all (those are backend-only for writes instead).
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once - each policy is dropped and recreated rather
-- than requiring a fresh name, since Postgres has no
-- "CREATE POLICY IF NOT EXISTS".

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
on storage.objects for update
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

-- Verify (expect 3 rows):
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'avatars_%';
