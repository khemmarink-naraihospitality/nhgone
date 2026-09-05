-- Remove TM30's per-property arrival-day window.
--
-- These columns were added by api/sql/tm30_day_window.sql (deleted in the
-- same commit as this file) so TM30 could be filed over the window each
-- generator sheet DECLARES in its Master/Parameter-ImportCP tab, on the
-- standing rule that our output matches the document that actually gets
-- filed. The premise turned out to be wrong: a sheet declares a window its
-- Arrival-mode export does not filter by.
--
-- Measured, on real sheets:
--   02-Sep-2026  Chinatown declared 12:15, we were configured to 12:15, and
--                its sheet still held 32 arrivals to our 26. Patong declared
--                02:05 to our 02:05, 42 to our 39.
--   04-Sep-2026  Six properties, one day, one variable: Chinatown (12:15),
--                Siam (02:05) and Samui (02:03) were the only three missing
--                guests their sheet holds (58/53, 17/16, 97/96); Koh Tao,
--                Patong and Marasca, all on midnight, matched exactly.
--   23-Aug-2026  A 12:15 window excluded 13 guests who were on Chinatown's
--                own filed sheet, checking in between midnight and 12:15.
--
-- TM30 is a notification to Immigration, so the two failure directions are
-- not symmetrical - a foreign arrival we never file is a missed statutory
-- filing. sync_service.get_tm30_report now sweeps plain property-local
-- midnight to midnight for every property, with no setting that can move it
-- and go stale. RR4's own rr4_tm30_day_start_*/_end_* columns are untouched
-- and stay configurable; only TM30's are dropped.
--
-- Run AFTER deploying the code that stops reading these columns (Admin >
-- Sync no longer selects them). Safe to run more than once.
--
-- RLS: no change needed - dropping columns from property_api_settings, whose
-- policies are unaffected (see CLAUDE.md's "Row Level Security").

ALTER TABLE property_api_settings
    DROP COLUMN IF EXISTS tm30_day_start_hour,
    DROP COLUMN IF EXISTS tm30_day_start_minute;

-- Verify (both columns should be gone):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'property_api_settings' AND column_name LIKE 'tm30_%';
