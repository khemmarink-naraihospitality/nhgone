-- Admin Console > Kiosks > Reception - the standard scheduled arrival/
-- departure time of day (e.g. 15:00 check-in, 12:00 check-out), matching
-- MEWS's own "Reception" configuration screen. Distinct from the existing
-- checkin_grace_hours/minutes and checkout_grace_hours/minutes columns:
-- those are GRACE PERIODS relative to these times - check-in grace is how
-- long BEFORE this arrival time a guest can already check in, check-out
-- grace is how long AFTER this departure time one can still check out -
-- where these four columns are the scheduled time itself.
--
-- Four integer columns, one row per kiosk (same shape as every other field
-- on this page). Defaults (15:00 / 12:00) match the reference screenshot and
-- ordinary hotel practice, so a kiosk created before this migration reads
-- exactly like one created after it - see also
-- api/app/routers/kiosks.py's KioskCreate, which never sets these
-- explicitly and lets the column defaults fill them in.
--
-- "Bookable period" (shown alongside these on MEWS's own screen, fixed to
-- "Nights") is NOT stored here - it is a read-only, non-editable business
-- fact on that screen and would just be dead weight in this table. The
-- admin page renders it as a locked field for visual parity, same as
-- Check In Form's own locked cells.
--
-- Recorded only, same as the Hardware fields above them on this page -
-- nothing behind the kiosk screens reads a generic arrival/departure time
-- yet (registration/confirm already show each guest's own real reservation
-- times). Wiring a screen to these, if ever wanted, is separate work.
--
-- RLS: no change needed. kiosk_settings already has RLS enabled with NO
-- policies (backend-only) - see api/sql/kiosk_settings.sql. These are four
-- more columns on that same, already-closed table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run, the feature degrades
-- quietly: the columns simply aren't there, the admin page's Reception
-- fields fall back to the same 15:00/12:00 defaults on screen without
-- persisting, and saving reports the missing columns rather than silently
-- losing the rest of the form.

ALTER TABLE kiosk_settings
    ADD COLUMN IF NOT EXISTS reception_arrival_hours integer NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS reception_arrival_minutes integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS reception_departure_hours integer NOT NULL DEFAULT 12,
    ADD COLUMN IF NOT EXISTS reception_departure_minutes integer NOT NULL DEFAULT 0;

-- Verify (expect 4 rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'kiosk_settings' AND column_name LIKE 'reception_%';
