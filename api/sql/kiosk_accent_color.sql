-- The kiosk's button colour (Admin Console > Kiosks > Button colour).
--
-- One nullable text column holding a `#rrggbb` hex. NULL is meaningful and is
-- the normal state: it means "use this property's own logo colour", which the
-- kiosk derives from property_api_settings.profile_image_url at runtime
-- (src/lib/kioskAccent.ts). Storing a value only records a deliberate
-- override, so a property that later changes its logo carries the new colour
-- through without anyone re-saving every kiosk.
--
-- The stored value is validated as #rrggbb both in the browser and again in
-- kiosks.py before it is written, because it ends up inside a CSS custom
-- property on a screen standing in a public lobby.
--
-- RLS: no change needed. kiosk_settings already has RLS enabled with NO
-- policies (backend-only, because the row carries pin_code) - see
-- api/sql/kiosk_settings.sql and CLAUDE.md's "Row Level Security" section.
-- This is one more column on that same, already-closed table.
--
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
-- Safe to run more than once. Until it has run, the feature degrades quietly:
-- the column simply isn't there, every kiosk falls back to its logo colour,
-- and saving a colour reports the missing column rather than silently losing
-- the rest of the form.

ALTER TABLE kiosk_settings
    ADD COLUMN IF NOT EXISTS accent_color text;

-- Verify (expect 1 row):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'kiosk_settings' AND column_name = 'accent_color';
