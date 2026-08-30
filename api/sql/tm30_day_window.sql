-- TM30's own per-property arrival-day window.
--
-- Deliberately NOT the existing rr4_tm30_day_start_* columns: each
-- generator sheet declares the RR4 and TM30 windows independently, and on
-- five of the six Thai properties they differ (Siam exports RR4 over 02:15
-- but TM30 over plain midnight, and so on). Reusing RR4's value would move
-- those five off midnight and break registers that currently match their
-- sheet exactly.
--
-- NULL means "unset" and falls back to sync_service._TM30_DAY_START_FALLBACK,
-- then to midnight. An explicit 0 means midnight and overrides the fallback -
-- _resolve_tm30_day_start tests `is not None`, not truthiness, for exactly
-- that reason.
--
-- Chinatown is set to 12:15 to match its sheet's own Parameter-ImportCP
-- window, per standing instruction that our output matches what actually
-- gets filed. Measured cost on 29-Aug-2026: 56 rows against that sheet's 67,
-- because 11 guests checking in between midnight and 12:15 are on the sheet
-- and drop out of a 12:15 window. Re-check this whenever the sheet's own
-- window changes - they change it without warning.
--
-- RLS: no change needed. property_api_settings already has RLS enabled with
-- an authenticated-only policy plus a block_anon restrictive policy (see
-- CLAUDE.md's "Row Level Security" section) - these are just new columns on
-- that same, already-secured table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once (IF NOT EXISTS on every column).

ALTER TABLE property_api_settings
    ADD COLUMN IF NOT EXISTS tm30_day_start_hour smallint,
    ADD COLUMN IF NOT EXISTS tm30_day_start_minute smallint;

UPDATE property_api_settings
   SET tm30_day_start_hour = 12,
       tm30_day_start_minute = 15
 WHERE property_name = 'Lub d Bangkok Chinatown';

-- Verify:
--   SELECT property_name, tm30_day_start_hour, tm30_day_start_minute
--     FROM property_api_settings ORDER BY property_name;
