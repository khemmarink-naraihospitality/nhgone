-- Peak-period stop-sale threshold overrides (Revenue > Occupancy By Type
-- Calendar). The property's single global Stop-Sale threshold (client-side
-- only, never persisted - see revenue_settings.stop_sale_pin) is the
-- default for every night; a row here overrides it for its own date range,
-- so a property can run at 90% all December except a 23-31 Dec peak at 50%.
--
-- One row per property per period - a property can have several, including
-- several inside the same month (e.g. a short New Year spike AND a longer
-- shoulder period either side of it at a different rate).
--
-- RLS: backend-only (RLS on, no policies), same shape as
-- kiosk_settings/checkin_form_settings - the browser never queries this
-- table directly, only through api/app/routers/occupancy.py with the
-- service role. Reading the list needs no PIN (matching the single
-- threshold field, visible to anyone who can see the calendar); every
-- write (POST/PUT/DELETE) is checked server-side against the same
-- Stop-Sale PIN (Admin > Revenue Settings) the field itself uses - see
-- stop_sale_periods_service.py. This is a deliberately STRONGER check than
-- the single threshold gets, because that value is never persisted at all
-- (nothing to protect) where this table is real, durable state a client
-- calling the API directly could otherwise write to bypassing the PIN
-- entirely.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run, the feature degrades
-- quietly: GET returns an empty list and every night falls back to the
-- single global threshold, exactly as before this feature existed.

create table if not exists public.stop_sale_periods (
    id uuid primary key default gen_random_uuid(),
    property_name text not null,
    start_date date not null,
    end_date date not null,
    threshold smallint not null check (threshold between 1 and 100),
    label text,
    created_at timestamptz not null default now(),
    created_by text,
    updated_at timestamptz not null default now(),
    updated_by text,
    constraint stop_sale_periods_date_order check (end_date >= start_date)
);

create index if not exists stop_sale_periods_property_idx
    on public.stop_sale_periods (property_name, start_date);

alter table public.stop_sale_periods enable row level security;
-- No policies - see the header note above.

-- Verify (expect 1 row):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'stop_sale_periods';
