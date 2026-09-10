-- Single global row (Admin > Revenue Settings) - the 4-digit PIN required
-- before anyone can edit the Stop-Sale threshold on /revenue's Occupancy By
-- Type Calendar. Same sentinel-row shape as smtp_settings/ftp_settings: one
-- row, read with .limit(1), upserted by row id rather than a fixed key.
--
-- The PIN is Fernet-encrypted at rest with the same EncryptionService every
-- other secret in this app uses (SMTP/FTP passwords, MEWS tokens) - it is a
-- shared internal PIN rather than a per-user credential, but there is no
-- reason to store it any less carefully than those.
--
-- Backend-only: RLS enabled, no policies at all, same as email_templates/
-- smtp_settings/ftp_settings. The frontend never reads or writes this table
-- directly - both Admin's save and the Revenue page's verify go through the
-- FastAPI backend (service-role access), which is also why there is no
-- browser-facing SELECT policy to add here.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS revenue_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_sale_pin text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE revenue_settings ENABLE ROW LEVEL SECURITY;

-- No default row is inserted here - the backend degrades to a hardcoded
-- default PIN ("2026", per instruction) whenever this table is empty, the
-- same "keeps working before anyone has touched Admin" pattern
-- get_ftp_settings/get_st_compare_settings already follow. Saving a real PIN
-- from Admin > Revenue Settings creates the row.
