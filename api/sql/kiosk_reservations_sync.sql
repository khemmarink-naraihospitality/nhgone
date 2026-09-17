-- Kiosk check-in list: a per-minute mirror of each enabled property's arrivals
-- for today, read by /kiosk/search, /kiosk/confirm and /kiosk/registration
-- through GET /api/kiosks/arrivals. Written only by
-- kiosks.sync_kiosk_arrivals, which main.auto_sync_kiosk_arrivals runs every
-- minute (Vercel Cron -> /api/sync/kiosk-arrivals-auto).
--
-- Run once in the Supabase SQL Editor. Until it has run, the job skips quietly
-- and the kiosk's search screen says arrivals aren't synced for the property.
--
-- One row per MEWS reservation (mews_id), holding every reservation whose
-- booked ScheduledStartUtc falls on the property's local today, in whatever
-- State MEWS reports; the kiosk only offers the Confirmed ones. Rows for any
-- earlier day are deleted on every run, so this never holds more than one day
-- per property.

create table if not exists public.kiosk_reservations_sync (
    mews_id              text primary key,
    property_name        text        not null,
    arrival_date         date        not null,  -- property-local date of ScheduledStartUtc
    time_zone            text        not null,  -- MEWS Enterprise.TimeZoneIdentifier
    number               text,
    state                text        not null,
    scheduled_start_utc  timestamptz,
    scheduled_end_utc    timestamptz,
    person_count         integer     not null default 0,
    room_category        text,
    guest_name           text,                   -- Fernet-encrypted
    guest_email          text,                   -- Fernet-encrypted
    mews_updated_utc     timestamptz,
    synced_at            timestamptz not null default now()
);

create index if not exists kiosk_reservations_sync_property_date_idx
    on public.kiosk_reservations_sync (property_name, arrival_date);

-- Which properties the per-minute job mirrors. Marasca Samui only for now;
-- enabling another property is this one update with its name.
alter table public.property_api_settings
    add column if not exists kiosk_arrivals_sync_enabled boolean not null default false;
update public.property_api_settings
    set kiosk_arrivals_sync_enabled = true
    where property_name = 'Marasca Samui';

-- RLS decision: enabled, with NO policies - a backend-only table. It holds
-- guest names and email addresses; every read and write goes through
-- /api/kiosks/arrivals* with the service role, which bypasses RLS. The
-- rls_enabled_no_policy INFO lint this produces is expected, not a gap.
alter table public.kiosk_reservations_sync enable row level security;
