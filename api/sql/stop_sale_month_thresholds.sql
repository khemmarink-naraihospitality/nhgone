-- Per-month, persisted Occ% stop-sale thresholds - Revenue > Occupancy By
-- Type Calendar's on-screen threshold field, next to each month's own label.
--
-- This field was deliberately session-only for a while (see the comment
-- history in revenue/page.tsx) precisely because it changes the business
-- definition of stop-sale and "shouldn't quietly become a permanent setting
-- nobody remembers changing." The user asked for it to auto-save anyway
-- (24-Sep-2026) - it's edited so rarely per month, and losing it on every
-- reload was itself the more surprising behaviour in practice. Auto-save,
-- not a Save button: every change persists immediately once the PIN is
-- unlocked, the same way Room Types (stop_sale_watched_categories) does.
--
-- One row per property, one jsonb map of "YYYY-MM" -> threshold (1-100).
-- A month with no key means "use DEFAULT_STOP_SELL_THRESHOLD (90)" - the
-- same default the field has always opened on, now just remembered per
-- month instead of resetting every session.
--
-- Deliberately NOT wired into stop_sale_alert_service.py - same documented
-- scope boundary as stop_sale_periods: the daily "new stop / re-open" mail
-- still compares every property against the flat DEFAULT_THRESHOLD=90
-- constant. Extending the alert to honour either of these is separate work.
--
-- RLS: backend-only (RLS on, no policies), same shape as
-- stop_sale_watched_categories. Reading needs no PIN (matching the field
-- itself, visible to anyone who can see the calendar); every WRITE is
-- checked server-side against the same Stop-Sale PIN (Admin > Revenue
-- Settings) stop_sale_periods/stop_sale_watched_categories both use.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run, the feature degrades
-- quietly: GET returns an empty map and every month's field falls back to
-- the 90% default and resets on reload, exactly as before this table
-- existed.

create table if not exists public.stop_sale_month_thresholds (
    property_name text primary key,
    thresholds jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    updated_by text
);

alter table public.stop_sale_month_thresholds enable row level security;
-- No policies - see the header note above.

-- Verify (expect 1 row):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'stop_sale_month_thresholds';
