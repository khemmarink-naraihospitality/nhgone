-- OSH Checklist - the Occupational Safety & Health inspection form, its
-- submitted reports, and its settings (sidebar "OSH", the form itself;
-- Report and Setting moved to Admin Console > OSH, 24-Sep-2026). Ported
-- from a standalone React prototype that kept
-- everything in the browser's localStorage; here every piece of it is shared
-- state in Supabase instead, so a report submitted on a tablet is the report
-- head office reads, and a checklist edited in Setting is the one every
-- property's next inspection gets.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run the pages still open, but
-- saving anything reports that this file needs running.

-- ---------------------------------------------------------------------------
-- 1. Two permissions, not one - and NOT a Form/Report vs. Setting split
-- ---------------------------------------------------------------------------
-- osh_checklist  - the sidebar "OSH" menu ONLY: the inspection form itself,
--                  for whoever actually fills it in.
-- osh_settings   - the whole back-office OSH area in Admin Console, Report
--                  AND Setting TOGETHER (one grant, not per-page) - e.g. a
--                  "P&C"-style role that reviews every property's filed
--                  reports and configures the checklist/recipients, as
--                  opposed to an "OSH" role that only fills the form. This
--                  was corrected 24-Sep-2026: an earlier version of this
--                  split put Report under osh_checklist alongside the Form,
--                  which the user pointed out doesn't match how the module
--                  is actually staffed - a role that fills the form has no
--                  particular need to read every property's history back.
-- Both default to false for every existing role; Super Admin is switched on
-- explicitly because ordinary sidebar menus are read straight from this
-- table (only the Admin menu is hardcoded to pass for Super Admin). The two
-- Admin Console sub-pages use Navigation.tsx's limitedAdminPaths mechanism
-- (same one RR4/TM30-Nationality and Email Template use) so a role with
-- osh_settings reaches both without needing the `admin` column too.
alter table public.role_permissions
    add column if not exists osh_checklist boolean not null default false,
    add column if not exists osh_settings boolean not null default false;

update public.role_permissions
   set osh_checklist = true, osh_settings = true
 where role = 'Super Admin';

-- No RLS change needed on role_permissions - it already has an
-- authenticated-only policy, and Navigation.tsx reads it with select("*") so
-- a column that doesn't exist yet only hides the link.

-- ---------------------------------------------------------------------------
-- 2. Settings - one row per setting, mirroring the prototype's localStorage
--    keys one-for-one so the port stays easy to compare against it.
-- ---------------------------------------------------------------------------
-- key: 'properties' | 'categories' | 'checklist' | 'emails' | 'template'
-- A key with no row means "use the built-in default" (src/lib/osh/defaults.ts),
-- exactly as the prototype fell back when localStorage was empty.
create table if not exists public.osh_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by text
);

-- ---------------------------------------------------------------------------
-- 3. Drafts - one in-progress form per signed-in user
-- ---------------------------------------------------------------------------
-- The prototype kept one draft per BROWSER, which on a shared front-office PC
-- meant one inspector's half-finished form greeting the next. Keyed by user
-- instead, and stored server-side so a form started on a tablet can be
-- finished on a laptop.
create table if not exists public.osh_drafts (
    user_id text primary key,
    header jsonb,
    items jsonb,
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Submitted reports
-- ---------------------------------------------------------------------------
-- header/items are the form exactly as submitted (a snapshot - later edits to
-- the checklist in Setting never rewrite a filed report). Photos are NOT
-- stored inline: items[].photo holds a URL into the osh-photos storage
-- bucket, because at up to 136 photos a report, base64 in a jsonb row is
-- what made bcp_snapshots the largest table in this database.
create table if not exists public.osh_reports (
    id uuid primary key default gen_random_uuid(),
    property_name text not null,
    year text,
    period text,
    report_date date,
    operator_name text,
    header jsonb not null,
    items jsonb not null,
    score integer not null default 0,
    submitted_at timestamptz not null default now(),
    submitted_by text,
    submitted_by_email text,
    email_status text,          -- 'sent' | 'not_configured' | 'failed'
    email_detail text
);

-- Added after the initial run (24-Sep-2026): Submitted Reports History needs
-- to show WHO submitted, not just their display name - `submitted_by` alone
-- can't be traced back to an account. Safe to run again; a column that
-- already exists is a no-op.
alter table public.osh_reports add column if not exists submitted_by_email text;

create index if not exists osh_reports_property_idx
    on public.osh_reports (property_name, submitted_at desc);

-- ---------------------------------------------------------------------------
-- RLS: all three tables are backend-only - RLS on, NO policies - the same
-- shape as kiosk_settings / checkin_form_settings. The browser never queries
-- them; everything goes through api/app/routers/osh.py with the service role.
-- ---------------------------------------------------------------------------
alter table public.osh_settings enable row level security;
alter table public.osh_drafts enable row level security;
alter table public.osh_reports enable row level security;

-- The osh-photos storage bucket is created by the backend on the first photo
-- upload (storage_buckets.ensure_public_bucket), public-read with no storage
-- policies - only the service role can write to it, the same arrangement as
-- property-images and kiosk-images. Object paths are random UUIDs.

-- Verify (expect 3 rows):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'osh_%';
