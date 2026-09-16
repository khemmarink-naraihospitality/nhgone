-- "Kiosk" - the self-service check-in screens at /kiosk/*, ported from the
-- NHGKiosk prototype (github.com/kitti2424/Kiosk) as its own main-sidebar
-- menu.
--
-- Defaults to false for every existing role. These are guest-facing terminal
-- screens meant for a kiosk device, not something every back-office role
-- needs in its sidebar, so it is granted deliberately per role. Super Admin
-- is switched on here because ordinary sidebar menus are read straight from
-- this table - unlike the Admin menu, Super Admin is NOT hardcoded to pass
-- for them.
alter table public.role_permissions
    add column if not exists kiosk boolean not null default false;

update public.role_permissions set kiosk = true where role = 'Super Admin';

-- No RLS change needed. role_permissions already has RLS enabled with an
-- authenticated-only policy, and Navigation.tsx reads it with select("*")
-- precisely so a column that doesn't exist yet only hides that one link
-- instead of failing the whole query - so the app stays usable between
-- deploying the code and running this.
--
-- Same client-side gate as every other role_permissions check in this app:
-- it decides what the sidebar shows. The kiosk screens themselves are a UI
-- prototype with no guest data behind them yet (they read nothing but the
-- property list), so there is nothing here to harden server-side.
