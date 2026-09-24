-- Follow-up to avatars_storage_policy.sql - run that one FIRST if you
-- haven't yet, this one alone does not fix the upload.
--
-- The `storage.objects` policies in avatars_storage_policy.sql were
-- confirmed correct (a service-role upload to the exact same path
-- succeeds), yet the browser upload still fails with the same "new row
-- violates row-level security policy" after that file was run. The cause
-- is a second table: newer Supabase Storage servers (this project runs
-- 1.77.5 - confirmed via GET /storage/v1/version) track folder hierarchy in
-- a separate `storage.prefixes` table, populated by an internal trigger
-- every time an object is inserted. That table has RLS enabled the same as
-- `storage.objects`, and until now had no policy either - so the trigger's
-- own insert into `storage.prefixes` was the thing actually failing, one
-- level below the error the browser reported.
--
-- Mirrors the same three policies, scoped to `<uid>/...` for the
-- `authenticated` role. Wrapped in a guard that only runs if the table
-- exists, so this file is harmless (a silent no-op) on an older Supabase
-- project that predates `storage.prefixes` - the plain `storage.objects`
-- policies are already the whole fix there.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query),
-- after avatars_storage_policy.sql. Safe to run more than once.

do $$
begin
    if to_regclass('storage.prefixes') is not null then
        execute 'drop policy if exists "avatars_prefixes_insert_own_folder" on storage.prefixes';
        execute $policy$
            create policy "avatars_prefixes_insert_own_folder"
            on storage.prefixes for insert
            to authenticated
            with check (
                bucket_id = 'avatars'
                and (storage.foldername(name))[1] = auth.uid()::text
            )
        $policy$;

        execute 'drop policy if exists "avatars_prefixes_update_own_folder" on storage.prefixes';
        execute $policy$
            create policy "avatars_prefixes_update_own_folder"
            on storage.prefixes for update
            to authenticated
            using (
                bucket_id = 'avatars'
                and (storage.foldername(name))[1] = auth.uid()::text
            )
            with check (
                bucket_id = 'avatars'
                and (storage.foldername(name))[1] = auth.uid()::text
            )
        $policy$;

        execute 'drop policy if exists "avatars_prefixes_delete_own_folder" on storage.prefixes';
        execute $policy$
            create policy "avatars_prefixes_delete_own_folder"
            on storage.prefixes for delete
            to authenticated
            using (
                bucket_id = 'avatars'
                and (storage.foldername(name))[1] = auth.uid()::text
            )
        $policy$;
    end if;
end $$;

-- Verify (expect 3 rows if storage.prefixes exists here, 0 if it doesn't -
-- both are fine):
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'prefixes'
--      AND policyname LIKE 'avatars_%';
