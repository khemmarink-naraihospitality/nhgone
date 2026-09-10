-- Occupancy snapshots move from one capture per calendar day (08:00) to
-- two (08:00 and 13:00 Asia/Bangkok) - see main.daily_auto_sync_occupancy
-- and occupancy.SNAPSHOTS_KEPT (now 6, i.e. 3 days of history at 2/day,
-- down from 7 days at 1/day).
--
-- occupancy_sync previously had a UNIQUE(property, report_date) constraint
-- (occupancy_sync_property_date_key) backing the app's upsert - one row
-- per property per day. Two captures sharing the same report_date would
-- collide under that constraint, so the app switches from upsert to a
-- plain insert (every capture is its own row now) and this drops the
-- constraint that would otherwise block the second one.
ALTER TABLE occupancy_sync DROP CONSTRAINT IF EXISTS occupancy_sync_property_date_key;

-- The afternoon capture's own independent (hour, minute, last_date) triple -
-- see main._run_occupancy_capture. Can't reuse occupancy_sync_hour/minute/
-- last_date (the morning capture's own columns): a single last_date would
-- make the 13:00 run refuse to fire because the 08:00 run already "used up"
-- today. Defaults land on 13:00 for every existing property without an
-- Admin step; there is no UI for either capture's time yet (same as the
-- morning columns already were), so these are effectively fixed until one
-- is built.
ALTER TABLE property_api_settings ADD COLUMN IF NOT EXISTS occupancy_sync_hour_2 integer NOT NULL DEFAULT 13;
ALTER TABLE property_api_settings ADD COLUMN IF NOT EXISTS occupancy_sync_minute_2 integer NOT NULL DEFAULT 0;
ALTER TABLE property_api_settings ADD COLUMN IF NOT EXISTS occupancy_sync_last_date_2 date;
