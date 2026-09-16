-- Kiosk configuration - the back-office settings behind the /kiosk check-in
-- screens, edited at Admin Console > Kiosks. Modelled on MEWS's own Kiosk
-- configuration form so the two read the same way side by side.
--
-- Run once in the Supabase SQL Editor. The Kiosks admin page reports that
-- this file has not been run yet (and hands over the SQL) rather than
-- failing silently.
--
-- One row per kiosk, and a property can have several: MEWS keys them the
-- same way (Property > Services > Stay > Kiosks), and a hotel really does
-- run more than one terminal - a 6AM lobby kiosk and a late-night one can
-- carry different grace periods and messages.

create table if not exists public.kiosk_settings (
  id uuid primary key default gen_random_uuid(),
  property_name text not null,
  name text not null,

  theme text not null default 'Light',
  connector_integration text not null default 'NHG Kiosk',
  default_language text not null default 'English (United States)',

  -- Hardware integrations. Free text on purpose: we have no device registry
  -- to populate a dropdown from, and inventing one would imply these are
  -- wired up when nothing reads them yet.
  key_cutter text,
  key_issuing text,
  payment_method text,
  payment_terminal text,

  options_enabled text[] not null default '{}',

  -- How long after the scheduled time a guest may still use the kiosk.
  checkin_grace_hours integer not null default 0,
  checkin_grace_minutes integer not null default 0,
  early_checkin_fee text,
  checkout_grace_hours integer not null default 0,
  checkout_grace_minutes integer not null default 0,

  reservation_lookup text not null default 'Last name and confirmation number',

  take_key_instructions text,
  cut_key_instructions text,
  thank_you_message text,
  contact_instructions text,
  checkout_instructions text,

  cut_key_video_url text,
  screen_saver_video_url text,

  -- Unlocks the settings screen on the terminal itself. Generated on create.
  pin_code text,

  -- [{ "url": ..., "path": ... }] - path is kept so deleting an image can
  -- remove the stored object too, not just forget the link to it.
  images jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists kiosk_settings_property_idx
  on public.kiosk_settings (property_name);

-- RLS decision: enabled, with NO policies at all - a backend-only table.
-- Every read and write goes through /api/kiosks/* with the service role,
-- which bypasses RLS. This is deliberately stricter than
-- property_api_settings (authenticated read/write): the row carries pin_code,
-- which unlocks the settings screen on a terminal standing in a public lobby,
-- and there is no reason for the anon key - or any signed-in browser - to be
-- able to read it directly. The rls_enabled_no_policy INFO lint this produces
-- is expected, not a gap.
alter table public.kiosk_settings enable row level security;

-- Public-READ bucket for the kiosk images, 5 MB cap, images only.
--
-- OPTIONAL: the backend creates this itself with the service role on the
-- first upload if it is missing (ensure_public_bucket). Kept here so the
-- settings are reviewable in one place. Like property-images it gets NO
-- storage policies: the only writer is the backend, and reads go through
-- each object's public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kiosk-images',
  'kiosk-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;
