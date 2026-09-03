-- CC/BCC for the two sheet-verification mails (Admin > Email Template >
-- System Email > Test ST File / Test RR4/TM30 File).
--
-- Same email_templates row every other field on those two tabs already
-- lives in (subject/html_template/recipients/send_hour/send_minute/
-- enabled) - just two more nullable text columns, comma-separated like
-- "recipients" already is.
--
-- The backend degrades gracefully before this is run (email_service.py's
-- _get_scheduled_settings retries without cc/bcc on a missing-column error,
-- and admin.py's _save_compare_settings does the same on Save) - CC/BCC
-- just read/save as empty until this migration is applied, same
-- "keeps working before anyone has touched Admin" pattern every other
-- config reader in this app follows.
--
-- RLS: no change needed. email_templates already has RLS enabled with no
-- policies at all (backend-only, service-role access) - these are just new
-- columns on that same, already-secured table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once (IF NOT EXISTS on every column).

ALTER TABLE email_templates
    ADD COLUMN IF NOT EXISTS cc text,
    ADD COLUMN IF NOT EXISTS bcc text;

-- Verify:
--   SELECT template_key, recipients, cc, bcc FROM email_templates
--    WHERE template_key IN ('st_compare_test', 'rr4_compare_test');
