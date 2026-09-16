-- Property branding for the MEWS-style property switcher (top-right of every
-- page): a profile image (logo) and a background image per property, set at
-- Admin > Property & API > Edit.
--
-- Run once in the Supabase SQL Editor. Until it runs, every property simply
-- shows its initials and a plain banner, and the upload buttons report that
-- this file has not been run yet - nothing else in the app depends on it.

alter table public.property_api_settings
  add column if not exists profile_image_url text,
  add column if not exists background_image_url text;

-- RLS decision for the new columns: none needed. They inherit
-- property_api_settings' existing policies (authenticated read/write, anon
-- blocked by block_anon), which is what the switcher's browser read uses. The
-- browser selects ONLY property_name + these two columns - never "*", since
-- this table also holds the encrypted MEWS tokens.

-- Public-READ bucket for the two images, 5 MB cap, images only.
--
-- RLS decision for storage: deliberately NO storage.objects policies. The only
-- writer is the backend (POST/DELETE /admin/sync/properties/{id}/image), which
-- uses the service role and bypasses RLS, so nobody - signed in or not - can
-- write to this bucket from a browser. Reads go through each object's public
-- URL, which a public bucket serves without a policy; these are hotel logos
-- and photos, meant to be seen.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-images',
  'property-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;
