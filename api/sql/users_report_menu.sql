-- "Users Report" - a read-only view of Admin > User Management, as its own
-- main-sidebar menu so it can be granted to roles that must NOT have the
-- Admin menu (which carries create/edit/delete/approve and every other
-- admin page with it).
--
-- Defaults to false for every existing role: this lists every account's
-- name, email, role and sign-in history, so it is granted deliberately per
-- role rather than appearing for everyone the moment this runs. Super Admin
-- is switched on here because sidebar menus are read straight from this
-- table - unlike the Admin menu, Super Admin is NOT hardcoded to pass for
-- ordinary menu links, so without this line the role that administers the
-- system wouldn't see the page it administers.
alter table public.role_permissions
    add column if not exists users_report boolean not null default false;

update public.role_permissions set users_report = true where role = 'Super Admin';

-- No RLS change needed. role_permissions already has RLS enabled with an
-- authenticated-only policy, and Navigation.tsx reads it with select("*")
-- precisely so a column that doesn't exist yet only hides that one link
-- instead of failing the whole query - so the app stays usable between
-- deploying the code and running this.
--
-- Note this gate is CLIENT-SIDE, like every other role_permissions check in
-- this app: it decides what the sidebar shows and guards the route in
-- Navigation.tsx, but the underlying profiles table is already readable by
-- any signed-in user under its own `authenticated` policy. Turning this
-- menu off hides the page, it does not harden the data behind it.
