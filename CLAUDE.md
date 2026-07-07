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
- `/live-data` — Live MEWS data fetched via `/api/reservations/live`
- `/data-mart` — Synced data from `reservations_sync`/`members_sync`/`payments`, rendered by the shared `src/components/DashboardView.tsx` (also used by `/live-data`), which enforces a per-section column order via `SECTION_COLUMNS` (58 columns for reservations, matching the MEWS Reservation Report schema)
- `/managed-members`, `/managed-payments` — Synced members/payments views
- `/log-import` — Import history
- `/admin/*` — User management, API settings per property, SMTP config, sync scheduling, activity logs

### Auth guard

`src/components/Navigation.tsx` wraps every page. It checks Supabase Auth and verifies the user has a row in the `profiles` table. Users without a profile are immediately signed out. The `/` route is the only public page.

### Key Supabase tables

| Table | Purpose |
|-------|---------|
| `reservations_sync` | Encrypted reservation snapshots; `mews_id` is the unique key |
| `members_sync` | Encrypted member snapshots; `mews_id` is the unique key |
| `payments` | Payment records; `mews_id` is the unique key |
| `property_api_settings` | Per-property MEWS tokens (encrypted) + sync schedule |
| `profiles` | Authorized users; required for login |
| `sync_logs` | Per-sync result log |
| `sync_locks` | DB-level mutex to prevent concurrent syncs |
| `smtp_settings` | Single global SMTP config (encrypted password) for system emails, e.g. welcome emails on user creation |

### Chunked upsert pattern

Supabase enforces a ~60 s statement timeout, so bulk writes are chunked. The reference implementation is the `chunked_upsert` closure in `daily_auto_sync` (`api/app/main.py`): it upserts in batches of 200 and, on a timeout error, retries that batch at half size (100). The routers (`members.py`, `payments.py`, `reservations.py`) do simpler inline chunked `.upsert()` calls (chunks of 200-500) without the retry step. Follow the `chunked_upsert` pattern — including the timeout retry — for any new bulk writes.
