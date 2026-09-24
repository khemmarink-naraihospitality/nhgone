-- Which room-type categories the Occupancy By Type Calendar's stop-sale
-- chart watches, and (24-Sep-2026) what the Stop Sale Alert email now
-- watches too - Revenue > Occupancy By Type Calendar's Room Types filter.
--
-- One row per property, one saved list of category ids (short_name where a
-- category has one, else its full name - the same id the calendar's rows
-- and stop_sale_alert_service.py's _cat_id both use). NULL/no row means
-- "watch every category", the default before this table existed and still
-- the default for a property that has never touched the filter. An empty
-- array [] is a real, deliberate "watch nothing" - distinct from NULL.
--
-- This used to be per-month, client-side-only state (a category worth
-- watching in a busy month was often just noise in a quiet one) - moved to
-- one shared, PERSISTED, per-property list at the user's request, so
-- picking it once applies to every month AND to the alert email, not just
-- the on-screen chart for that one session.
--
-- RLS: backend-only (RLS on, no policies), same shape as stop_sale_periods.
-- Reading needs no PIN (matching the calendar's own filter, which was never
-- gated); every WRITE is checked server-side against the same Stop-Sale PIN
-- (Admin > Revenue Settings) stop_sale_periods uses - this is real,
-- durable state that now decides what the alert email reports on, not a
-- view-only convenience.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run, the feature degrades
-- quietly: GET returns null (watch everything) and the calendar/email both
-- behave exactly as before this table existed.

create table if not exists public.stop_sale_watched_categories (
    property_name text primary key,
    categories jsonb,
    updated_at timestamptz not null default now(),
    updated_by text
);

alter table public.stop_sale_watched_categories enable row level security;
-- No policies - see the header note above.

-- Verify (expect 1 row):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'stop_sale_watched_categories';
