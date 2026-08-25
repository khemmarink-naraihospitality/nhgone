-- RR4/TM30 daily email feature (Admin > Templates > RR4/TM30 Files).
-- Same shape as the existing st_files_email_* columns already on this
-- table - one column family for the per-property opt-in email.
--
-- RLS: no change needed. property_api_settings already has RLS enabled
-- with an authenticated-only policy plus a block_anon restrictive policy
-- (see CLAUDE.md's "Row Level Security" section) - these are just new
-- columns on that same, already-secured table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- if the Supabase MCP connection isn't available when this feature is
-- deployed. Safe to run more than once (IF NOT EXISTS on every column).

ALTER TABLE property_api_settings
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_recipients text,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_cc text,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_bcc text,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_hour smallint,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_minute smallint,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_subject text,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_template text,
    ADD COLUMN IF NOT EXISTS rr4_tm30_email_last_sent_date date;

-- Verify (expect 9 rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'property_api_settings' AND column_name LIKE 'rr4_tm30_email_%';
