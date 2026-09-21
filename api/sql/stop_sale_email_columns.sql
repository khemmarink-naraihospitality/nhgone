-- Per-property Stop Sale & Re-open email (Admin > Email Template > Revenue >
-- Per-Property). Exactly the same column family as the existing
-- st_files_email_* and rr4_tm30_email_* sets on this table - one per-property
-- opt-in email, each property with its own recipients, send time, subject and
-- HTML, and its own _last_sent_date so one property's send can never suppress
-- another's.
--
-- The bundled "All Property" mail is unaffected and stays a standing master
-- copy of every property: opting a property in here ADDS a mail, it does not
-- move one (same decision send_st_files_bundled_digest documents).
--
-- RLS: no change needed. property_api_settings already has RLS enabled with
-- an authenticated-only policy plus a block_anon restrictive policy (see
-- CLAUDE.md's "Row Level Security" section) - these are just new columns on
-- that same, already-secured table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once (IF NOT EXISTS on every column). Until it has
-- run, the feature degrades quietly: the scheduled job finds no enabled
-- property and stop_sale_alert_service.send_property returns a skip rather
-- than raising.

ALTER TABLE property_api_settings
    ADD COLUMN IF NOT EXISTS stop_sale_email_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS stop_sale_email_recipients text,
    ADD COLUMN IF NOT EXISTS stop_sale_email_cc text,
    ADD COLUMN IF NOT EXISTS stop_sale_email_bcc text,
    ADD COLUMN IF NOT EXISTS stop_sale_email_hour smallint,
    ADD COLUMN IF NOT EXISTS stop_sale_email_minute smallint,
    ADD COLUMN IF NOT EXISTS stop_sale_email_subject text,
    ADD COLUMN IF NOT EXISTS stop_sale_email_template text,
    ADD COLUMN IF NOT EXISTS stop_sale_email_last_sent_date date;

-- Verify (expect 9 rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'property_api_settings' AND column_name LIKE 'stop_sale_email_%';
