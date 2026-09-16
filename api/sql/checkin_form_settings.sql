-- Check-in form field configuration, edited at Admin Console > Kiosks >
-- Check In Form. Modelled on MEWS's own "Check in form" screen: which guest
-- profile fields are collected during self-service check-in, per category
-- (General / Address / Documents / Verification) and per guest type
-- (Reservation owner / Other adults / Children), each set to
-- Default / Required / Optional / Hidden.
--
-- Run once in the Supabase SQL Editor. Until it runs, the page reports that
-- this file has not been run yet (and hands over the SQL) rather than
-- failing silently, the same pattern as api/sql/kiosk_settings.sql.
--
-- One row per property, not per kiosk device - guests fill out the same form
-- regardless of which physical terminal they use, unlike kiosk_settings
-- (theme, grace periods, PIN) which is genuinely per-device.

create table if not exists public.checkin_form_settings (
  id uuid primary key default gen_random_uuid(),
  property_name text not null unique,

  -- { "<category>": { "<field key>": "Default" | "Required" | "Optional" | "Hidden", ... }, ... }
  -- Only unlocked fields are ever written here - a field the UI marks
  -- `locked` in its own FIELD_CATEGORIES config (src/app/admin/kiosks/
  -- checkin-form/page.tsx) is never editable, so there is nothing to store
  -- for it; the UI computes its fixed value the same way on every load.
  fields jsonb not null default '{}'::jsonb,

  -- Whether the Other adults / Children columns collect data at all. Off
  -- greys out that whole column in the editor rather than deleting its
  -- stored values, so re-enabling it restores what was configured before.
  other_adults_enabled boolean not null default true,
  children_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- RLS decision: enabled, with NO policies - a backend-only table, same
-- shape as kiosk_settings. Every read and write goes through
-- /api/checkin-form with the service role, which bypasses RLS. Nothing here
-- is as sensitive as kiosk_settings.pin_code, but there is no browser
-- reader for this table either, so there is no reason to open it up.
alter table public.checkin_form_settings enable row level security;
