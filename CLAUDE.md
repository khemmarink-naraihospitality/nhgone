# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

### Frontend (Next.js — root directory)
```bash
npm run dev          # Start Next.js on port 3000 (webpack mode)
npm run build        # Production build
npm run lint         # ESLint
```

### Backend (FastAPI — `api/` directory)
```bash
# From repo root:
npm run dev:backend  # Start FastAPI on port 8000 with hot-reload

# Or directly from api/:
cd api && py -m uvicorn app.main:app --port 8000 --reload
```

### Run both together
```bash
npm run dev:all      # Concurrently starts both frontend and backend
# Or on Windows: run_dev.bat
```

### Backend Python environment
The backend uses a virtualenv at `.venv/`. Install Python deps from `api/requirements.txt`:
```bash
cd api && pip install -r requirements.txt
```

The backend requires a `.env` file inside `api/` with: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MEWS_CLIENT_TOKEN`, `MEWS_ACCESS_TOKEN`, `MEWS_BASE_URL`, and `ENCRYPTION_KEY`.
The frontend reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local` in the root.

---

## Architecture

NHGOne is a hospitality management dashboard for Narai Hospitality Group. It surfaces data from **MEWS** (the PMS — Property Management System) through a sync pipeline into **Supabase** (PostgreSQL), then displays it via a Next.js frontend.

### Two-process design (local dev)

| Process | Location | Port |
|---------|----------|------|
| Next.js (TypeScript + Tailwind) | `src/` | 3000 |
| FastAPI (Python 3.12) | `api/` | 8000 |

In local dev, `next.config.ts` rewrites `/api/*` → `http://127.0.0.1:8000/*` so the frontend calls the backend with relative paths. In production (Vercel), `vercel.json` rewrites `/api/*` → `api/index.py`, which boots the same FastAPI app via `app.root_path = "/api"`.

### Data flow

```
MEWS API  →  FastAPI SyncService  →  Supabase (PostgreSQL)  →  Next.js frontend
```

1. **MEWS API** — `api/app/services/mews_client.py` wraps all MEWS Connector API v1 calls. Each property has its own `ClientToken`/`AccessToken` stored encrypted in the `property_api_settings` Supabase table.
2. **SyncService** (`api/app/services/sync_service.py`) fetches and maps MEWS data to the 58-column MEWS Reservation Report schema, then upserts to Supabase tables: `reservations_sync`, `members_sync`, `payments`.
3. **Scheduled sync** runs every minute locally (APScheduler) or every hour on Vercel (cron at `/api/sync/auto`). It respects per-property `sync_hour`/`sync_minute` settings and uses a DB-backed lock (`sync_locks` table + `acquire_sync_lock` / `release_sync_lock` RPCs) to prevent concurrent executions.
4. **Encryption** — `EncryptionService` (Fernet/AES) encrypts PII fields (names, emails, phone numbers) before storage. The encrypted field list is in `api/app/services/encryption.py:SENSITIVE_FIELDS`.

### Frontend routing (`src/app/` — Next.js App Router)

- `/` — Login page (Supabase Auth)
- `/dashboard` — KPI overview
- `/data-mart` — Synced data from `reservations_sync`/`members_sync`/`payments`, rendered by the shared `src/components/DashboardView.tsx`, which enforces a per-section column order via `SECTION_COLUMNS` (58 columns for reservations, matching the MEWS Reservation Report schema). A MEWS/Data Mart toggle switches to live MEWS fetches (`/api/*/live`) with an "Import To Data Mart" button; the old standalone `/live-data` page was removed in favor of this toggle
- `/managed-members`, `/managed-payments` — Synced members/payments views
- `/log-import` — Import history
- `/bill-generator` (sidebar label "Bills") — Lists MEWS bills per property/date range, toggled between "Live API" (`bills/getAll`, always current) and "Database" (`bills/managed`, reads `bills_sync` — faster once a range has been backfilled via "Import To Data Mart"); "NHG Bill" opens `/print-bill/{id}` (or `/print-bill/batch?ids=a,b,c` for multiple), "MEWS Bill" fetches MEWS's own generated PDF (`bills/getPdf`)
- `/print-bill/[id]` — Fetches full itemized invoice data (`GET /bills/{id}/invoice`) and the property's HTML template (`GET /bills/template`), then does `<<Token>>` string substitution and renders via `dangerouslySetInnerHTML` — see `renderInvoiceTemplate` in that file for the full token list. `get_bill_invoice` (`sync_service.py`) checks `bills_sync` first and only falls back to live `bills/getAll`+`orderItems/getAll` if the bill isn't cached; `payments/getAll` is always called live since `payments` has no queryable Bill Id column
- `/rr3` — Lists guests checking in for a property/date range (via `GET /rr3/cards`, which joins Reservations+Customers+Resources in one live MEWS call — see `sync_service.get_rr3_cards`); "Print All" opens `/print-rr3` to print every Thai Hotel Act ร.ร.๓ lodger registration card in one document. The card layout is a single shared HTML template for all properties (`GET/POST /rr3/template`, `rr3_templates` table keyed by a fixed sentinel row, edited at Admin > Templates, RR3 tab — no per-property picker, unlike Billing) with `<<Token>>` substitution done client-side in `/print-rr3`; the default (`DEFAULT_RR3_TEMPLATE` in `api/app/routers/rr3.py`) matches the official government blank form, and the template GET falls back to it if the table is missing so printing never breaks
- `/admin/*` — User management, API settings per property, SMTP config, per-property billing templates, sync scheduling, activity logs

### Auth guard

`src/components/Navigation.tsx` wraps every page. It checks Supabase Auth and verifies the user has a row in the `profiles` table. The `/` route is the only public page.

New signups (mainly first-time Google OAuth logins) are auto-provisioned by a Postgres trigger on `auth.users` (`on_auth_user_created` → `handle_new_user()`, managed directly in Supabase SQL Editor, not a tracked migration) as `role='User'`, `status='Pending'`, with `full_name` defaulting to the email's capitalized local-part unless Google supplied a real name. A `Pending` profile sees a "Waiting for Approval" screen instead of the app shell/menus. A Super Admin approves via Admin > Users, picking a real role — this calls `POST /admin/users/{id}/approve`, which sets `status='Active'`. A still-missing profile (trigger somehow didn't fire) falls back to `POST /admin/self-register` (same fixed `role='User'/status='Pending'` defaults) before the old sign-out-as-unauthorized path. Admin-created invites (`POST /admin/users`) are unaffected — that endpoint's own upsert overwrites the trigger's defaults with the real role and `status='Active'` immediately after creating the auth user.

Which sidebar menus each role can see (Dashboard/Data Mart/Bills/RR3/Log Import/Admin) is controlled by the `role_permissions` table (one row per role, one boolean column per menu), edited via Admin > Users > Role Settings tab. `Navigation.tsx` and `UserHeader.tsx`'s Admin Console link both read this table for the signed-in user's role; Super Admin is hardcoded to always pass regardless of the table. A missing/unloaded row falls back to the old hardcoded rule (Finance = Bills only, everyone else = full menu) so a bad row can never zero out a user's menu entirely. `role_permissions` has RLS disabled (matching `profiles`) so the browser's anon-key client can actually read/write it — a table created via SQL Editor with RLS left on and no policies will silently return empty results to the frontend, not an error.

`Navigation.tsx` also enforces `/admin/*` route access itself (not just hiding the sidebar link): Super Admin always passes; every other role needs `role_permissions.admin === true` or gets redirected to `/dashboard`.

### Key Supabase tables

| Table | Purpose |
|-------|---------|
| `reservations_sync` | Encrypted reservation snapshots; `mews_id` is the unique key |
| `members_sync` | Encrypted member snapshots; `mews_id` is the unique key |
| `payments` | Payment records; `mews_id` is the unique key |
| `property_api_settings` | Per-property MEWS tokens (encrypted) + sync schedule |
| `profiles` | Authorized users; required for login. `status`: `Pending` (awaiting Super Admin approval) → `Active` |
| `role_permissions` | Role × sidebar-menu access grid (one row per role), edited at Admin > Users > Role Settings |
| `sync_logs` | Per-sync result log |
| `sync_locks` | DB-level mutex to prevent concurrent syncs |
| `smtp_settings` | Single global SMTP config (encrypted password) for system emails, e.g. welcome emails on user creation |
| `resources_sync` | Encrypted MEWS resource (room/space) snapshots; `mews_id` is the unique key |
| `billing_templates` | Per-property HTML invoice/receipt template (`<<Token>>` placeholders), edited at Admin > Templates (Billing tab) |
| `bills_sync` | Archived MEWS bill headers + order items + owner address/tax ID; `mews_id` is the unique key; backs the Bills page's "Database" mode and `get_bill_invoice`'s cache path |
| `rr3_templates` | Per-property HTML template for the ร.ร.๓ lodger registration card (`<<Token>>` placeholders), edited at Admin > Templates (RR3 tab) |

### Chunked upsert pattern

Supabase enforces a ~60 s statement timeout, so bulk writes are chunked. The reference implementation is the `chunked_upsert` closure in `daily_auto_sync` (`api/app/main.py`): it upserts in batches of 200 and, on a timeout error, retries that batch at half size (100). The routers (`members.py`, `payments.py`, `reservations.py`) do simpler inline chunked `.upsert()` calls (chunks of 200-500) without the retry step. Follow the `chunked_upsert` pattern — including the timeout retry — for any new bulk writes.
