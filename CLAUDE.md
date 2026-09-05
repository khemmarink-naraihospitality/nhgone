# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

### Frontend (Next.js — root directory)
```bash
npm run dev          # Start Next.js on port 3000 (webpack mode)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # The only real type check — see the warning below
```

**`npm run build` does not type-check.** `next.config.ts` sets `typescript.ignoreBuildErrors: true`, so a build succeeds with type errors still in the tree. Run `npx tsc --noEmit` if you want them caught.

### Backend (FastAPI — `api/` directory)
```bash
# From repo root:
npm run dev:backend  # Windows only — this script shells out to `py`

# macOS/Linux (this machine): use the venv interpreter directly
cd api && ../.venv/bin/python -m uvicorn app.main:app --port 8000 --reload
```

`npm run dev:backend` / `npm run dev:all` / `run_dev.bat` all invoke `py`, the **Windows** Python launcher, which does not exist on macOS. On darwin use `.venv/bin/python` as above (or run the two processes in separate terminals).

### Run both together
```bash
npm run dev:all      # Concurrently starts both — Windows only, same `py` caveat
# Or on Windows: run_dev.bat
```

### Backend Python environment
The backend uses a virtualenv at `.venv/` (repo root, not `api/`). Install Python deps from `api/requirements.txt`:
```bash
.venv/bin/pip install -r api/requirements.txt
```

### Tests
**There is no test suite and no test runner** — no pytest, jest, or vitest anywhere. The `test_*.py` files at the root and in `api/` (`test_sync.py`, `api/test_import.py`, `api/test_sync_manual.py`, `check_db_props.py`, `tmp_gen_excel.py`) are one-shot throwaway scripts written to poke a live endpoint or connection, not a suite. Verify changes by running the app against real MEWS/Supabase data and comparing against the reference spreadsheets (see **Ground truth** below), which is how every report in here was built.

### Environment variables
The backend requires a `.env` file inside `api/` with: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MEWS_CLIENT_TOKEN`, `MEWS_ACCESS_TOKEN`, `MEWS_BASE_URL`, and `ENCRYPTION_KEY`. `APP_BASE_URL` (`api/app/config.py`) defaults to the production URL and is what email links point at — the backend has no `window.location` to fall back on the way the frontend's `getBaseUrl()` does.
The frontend reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local` in the root.

---

## Architecture

NHGOne is a hospitality management dashboard for Narai Hospitality Group (8 Lub d properties). It surfaces data from **MEWS** (the PMS — Property Management System) through a sync pipeline into **Supabase** (PostgreSQL), then displays it via a Next.js frontend. A large and growing share of it is **statutory and finance reporting** — Thai Hotel Act forms (ร.ร.๓ / ร.ร.๔), Immigration TM30, and pipe-delimited SunSystems/Infor journal files — where the output has to match an existing hand-maintained spreadsheet or government form exactly.

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
3. **Scheduled jobs** — see the next section; there are now many independent schedules, not one.
4. **Encryption** — `EncryptionService` (Fernet/AES) encrypts PII fields (names, emails, phone numbers) before storage. The per-field list is `api/app/services/encryption.py:SENSITIVE_FIELDS`. Reports whose PII is *nested* (guest lists inside a list inside a dict) can't be reached per-field and are instead stored as a **whole-blob** encrypted string — see the report-module pattern below.

### `sync_service.py` is the monolith

`api/app/services/sync_service.py` is ~6,100 lines and holds essentially every MEWS-facing report builder. When looking for logic, grep it before assuming a new file. Its rough order: reservation/member/payment/resource/bill mappers → bill invoice + totals → RR3 cards → RR4/TM30 → ST Files → Occupancy/Rate → RV (revenue journal) → email digests → BCP snapshot. The only deliberate exceptions live outside it: `reconciliation_service.py` (pure Excel-in/Excel-out, no MEWS or Supabase at all), `email_service.py`, `ftp_service.py`, `encryption.py`, `mews_client.py`, and `rr4_tm30_reference.py` (static nationality lookup tables).

### The report-module pattern

ST Files, RV, RR4/TM30 and Occupancy/Revenue are all the same shape, and a new report should follow it rather than inventing a fifth arrangement:

1. **Builder** in `sync_service.py` — `get_<name>_report(property_name, date)`, one live MEWS fetch, returns a plain dict.
2. **Router** at `api/app/routers/<name>.py` with a near-identical endpoint set: `GET /report` (live), `GET /managed` (read the cached row), `POST /sync-manual` (Import To Data Mart over a date range, capped at ~62 days), `GET /list` (which dates have been imported), `GET /export` (the pipe-delimited or `.xlsx` file).
3. **A shared `sync_<name>_day()` helper** in that router, called by *both* the manual import button and the scheduled job — this is deliberate, so the two can never drift apart.
4. **Storage** in a `<name>_sync` table, one row per `(property, report_date)`, upserted `on_conflict="property,report_date"`.
5. **Schedule** — a `daily_auto_sync_<name>()` in `api/app/main.py` reading that feature's own `property_api_settings` columns (`<name>_sync_enabled` / `_hour` / `_minute` / `_last_date`).

Frontends follow it too: a **Live API / Database** mode toggle (same as Bills), an "Import To Data Mart" button, and a date/property control block.

**Whole-blob encryption.** `st_files_sync`, `rv_files_sync`, `rr4_tm30_sync` and `bcp_snapshots` all store `data = {"blob": encrypt(json.dumps(report))}` rather than encrypting named columns, because the PII (guest names, passport/ID numbers, birth dates, billing descriptions quoting guest names) sits nested inside lists that `encrypt_data`'s flat key scan can't reach. `occupancy_sync` is the exception and stores plain `jsonb` — its payload is category names and integer counts with no PII in it. `bcp_snapshots` additionally **gzips before encrypting** (a busy property's ±7-day Timeline measured ~3.4 MB decoded); the row carries a `"gzip": true` flag so older uncompressed rows still decode.

### Scheduled jobs

**Three separate Vercel Cron entries** (`vercel.json`), all `*/5 * * * *`:

| Cron path | Drives |
|-----------|--------|
| `/api/sync/auto` | Everything schedule-driven except the two below — see the list under it |
| `/api/bcp/auto-capture` | BCP snapshots only, kept separate so BCP's 5-minute cadence doesn't drag a full data sync along |
| `/api/sync/retry-check` | `retry_scheduled_syncs` only, split out so the Retry Policy interval can be configured in **minutes** and actually resolve at that granularity |

Several docstrings in `main.py` still describe `/sync/auto` as the *hourly* cron — that is stale; `vercel.json` is the authority. Firing every 5 minutes is safe because each job self-gates on its own `*_last_date` marker column and only does work once per day.

`/api/sync/auto` fans out (as FastAPI `BackgroundTasks`, so it returns immediately) to: `daily_auto_sync` (the 5-table Data Mart sync), `retry_failed_syncs`, `daily_auto_sync_st_files`, `daily_auto_sync_occupancy`, `daily_auto_sync_rr4_tm30`, `daily_auto_sync_rv`, the four email jobs (`send_st_files_daily_email`, `send_st_files_per_property_emails`, `send_rr4_tm30_daily_email`, `send_rr4_tm30_per_property_emails`) and `send_ftp_upload_job`. Each self-gates against its own per-property schedule columns.

**Locally** an APScheduler starts on FastAPI startup and ticks each of these every minute (`second=0`), plus BCP every 5 minutes. `start_scheduler` **returns early when `os.environ["VERCEL"]` is set** — without that guard, every Vercel cold start (any request, not just the cron) spun up a fresh scheduler that ticked for whatever arbitrary minute the cold start landed on, which is why auto-sync used to be unreliable in production.

**`match_hour_only`.** In production, jobs are invoked with `match_hour_only=True` because a cron firing is not guaranteed to land on the exact configured minute. Local ticks match to the minute. `retry_scheduled_syncs` splits the difference: it buckets to 5-minute marks under Vercel and to the minute locally.

**Two different retry mechanisms, don't confuse them:**
- `retry_failed_syncs()` — fixed, once daily at 09:00 Asia/Bangkok (self-gated on `hour == 9`), re-runs any (property, table) pair whose latest `sync_logs` row *today* is still `error`. Logged as `sync_type="retry"`.
- `retry_scheduled_syncs()` — per-property, tied to each property's *own* schedule plus configurable offsets (`sync_retry_settings`, Admin > Sync's Retry Policy card; default 2 retries 60 minutes apart). Covers all four independent schedules (Data Mart, ST Files, RR4/TM30, RV). Retries a table that is `error` **or has no `sync_logs` row at all** for today — the scheduled run never firing (cold start, outage) looks identical to a failure from the outside and matters just as much. No dedup logic is needed because every sync upserts on `mews_id`.

Concurrency is guarded by a DB-backed lock (`sync_locks` table + `acquire_sync_lock` / `release_sync_lock` RPCs); BCP captures take the same lock with a 4-minute timeout. `daily_auto_sync`'s five per-table syncs (Reservations/Customers/Payments/Resources/Bills) are extracted into module-level `_sync_*` functions precisely so the retry paths can re-run one table without re-running the property.

### Frontend routing (`src/app/` — Next.js App Router)

- `/` — Login page (Supabase Auth)
- `/dashboard` — KPI overview, plus a per-property import-status card whose "Import Latest" button posts `POST /sync/property` (re-runs exactly what that property's scheduled `daily_auto_sync` would have, tagged `sync_type="manual"`, and synchronously so the button can report a result)
- `/data-mart` — Synced data from `reservations_sync`/`members_sync`/`payments`, rendered by the shared `src/components/DashboardView.tsx`, which enforces a per-section column order via `SECTION_COLUMNS` (58 columns for reservations, matching the MEWS Reservation Report schema). A MEWS/Data Mart toggle switches to live MEWS fetches (`/api/*/live`) with an "Import To Data Mart" button; the old standalone `/live-data` page was removed in favor of this toggle
- `/managed-members`, `/managed-payments` — Synced members/payments views
- `/log-import` — Import history
- `/profile` — Own-account page; avatar upload goes to the Supabase **Storage** bucket `avatars` and is read back with `getPublicUrl`
- `/bill-generator` (sidebar label "Bills") — Lists MEWS bills per property/date range, toggled between "Live API" (`bills/getAll`, always current) and "Database" (`bills/managed`, reads `bills_sync` — faster once a range has been backfilled via "Import To Data Mart"); "NHG Bill" opens `/print-bill/{id}` (or `/print-bill/batch?ids=a,b,c` for multiple), "MEWS Bill" fetches MEWS's own generated PDF (`bills/getPdf`)
- `/print-bill/[id]` — Fetches full itemized invoice data (`GET /bills/{id}/invoice`) and the property's HTML template (`GET /bills/template`), then does `<<Token>>` string substitution and renders on-screen via `dangerouslySetInnerHTML`; printing is plain `window.print()`. Token substitution (`renderInvoiceTemplate`), the `Invoice` type, and the `@page`-A4/page-break print CSS (`INVOICE_PRINT_CSS`) live in `src/lib/invoiceTemplate.ts`. `get_bill_invoice` (`sync_service.py`) checks `bills_sync` first and only falls back to live `bills/getAll`+`orderItems/getAll` if the bill isn't cached; `payments/getAll` is always called live since `payments` has no queryable Bill Id column. **Print pages and the app shell**: print-bill/print-rr3 render inside `Navigation.tsx`'s shell, whose inner `overflow-y-auto` wrapper would rasterize its scrollbar onto every printed page — `globals.css`'s `@media print` block (aside hidden, `main, main > div` overflow reset, webkit scrollbars hidden, white body) exists to prevent exactly that; don't remove it. A server-side PDF route (headless Chromium via `playwright-core`+`@sparticuz/chromium`) was built, production-verified, then **removed by user decision** (server cost — Chromium needed a 3GB function) once browser printing was fixed; if it's ever wanted again, recover from git (`9f9de79`→`e7fd06b`) and note WeasyPrint (needs native Pango/GTK, unavailable on Vercel Python) and `xhtml2pdf` (cannot render Thai at all) were both tested and ruled out
- `/rr3` — Lists guests checking in for a property/date range (via `GET /rr3/cards`, which joins Reservations+Customers+Resources in one live MEWS call — see `sync_service.get_rr3_cards`); "Print All" opens `/print-rr3` to print every Thai Hotel Act ร.ร.๓ lodger registration card in one document. The card layout is a single shared HTML template for all properties (`GET/POST /rr3/template`, `rr3_templates` table keyed by a fixed sentinel row, edited at Admin > Email Template, RR3 tab — no per-property picker, unlike Billing) with `<<Token>>` substitution done client-side in `/print-rr3`; the default (`DEFAULT_RR3_TEMPLATE` in `api/app/routers/rr3.py`) matches the official government blank form, and the template GET falls back to it if the table is missing so printing never breaks
- `/rr4-tm30` (sidebar "RR4/TM30") — Two statutory registers built from **one shared MEWS fetch** (`sync_service._rr4_tm30_fetch_day`) and stored in **one shared row** (`rr4_tm30_sync`, `{"rr4": ..., "tm30": ...}` under a single encrypted blob) — halving the MEWS cost, since both always describe the same day. `/rr4-tm30/preview` renders the export before download; `GET /rr4/export` and `GET /tm30/export` produce `.xlsx`.
  - **RR4 (ร.ร.๔ guest register)** — every guest whose stay *overlaps* the day, Thai and foreign alike. Overlap is the standard interval test (`StartUtc < window end AND EndUtc > window start`), deliberately **not** ST Files' Customers-tab rule, which only works by coincidence when the window ends at midnight and silently dropped 61 guests once Chinatown's real 12:15 window was configured. Check-in times use `ActualStartUtc`, never the deprecated scheduled `StartUtc`. **Rows with nothing in columns E–K (every name column) are dropped from the `.xlsx` and the remaining rows renumbered** (`sync_service._rr4_filed_rows`) — they are MEWS's own unnamed occupant slots, one per booked headcount whose companion profile was never attached, and a row with no name is not a lodger the Act asks us to register. The generator sheet keeps them (blanked by its `if(<nameEn>="","",…)` wrapper), so the verification mail still counts them on both sides. The drop happens at **render** time, not in `get_rr4_report`, so the Edit page still lists a nameless slot and someone can type the guest in — once named it joins the filing on its own. Anything reporting a row count next to the file (the daily email's table) must count `_rr4_filed_rows`, not the report.
  - **TM30 (foreign-arrival notification)** — guests *arriving* that day, non-Thai only. Its window is the day's own local **midnight to midnight** for every property, with **no per-property setting** — not the RR4 cutoff hour, and not the window a generator sheet declares. A `tm30_day_start_hour/_minute` pair existed for a week (Chinatown 12:15, later Siam 02:05 and Samui 02:03, each copied from what its sheet declares) and under-filed the register every day it was set: on 04-Sep-2026 those three were the only properties missing guests their own sheet held (58/53, 17/16, 97/96) while the three still on midnight matched exactly. A sheet's declared window is simply not what its Arrival-mode export filters by — on 02-Sep-2026 Chinatown declared 12:15, we matched it, and its sheet still held 32 arrivals to our 26. Missing a foreign arrival is a missed statutory filing, so the knob was removed rather than left to go stale (`api/sql/tm30_day_window_drop.sql`).
  - **The day window** (`property_api_settings.rr4_tm30_day_start_hour/_minute`, `rr4_tm30_day_end_hour/_minute`, all defaulting to 0) exists to mirror MEWS's own native "Customer profiles" report window per property, which is why it has minute precision. It is *not* constrained to 24h — a safety constraint forcing that was explicitly reverted, so **a stale non-zero value here silently undercounts the register** (a leftover 14:00/12:00 on Chinatown once produced 160 rows instead of 241). Double-check any non-zero value.
  - **Manual corrections** (`RR4 & TM30 Files > RR4|TM30 > Edit` → `/rr4-tm30/edit`, styled after Admin > RR4-Nationality) live in their own `rr4_tm30_overrides` table, **not** in the `rr4_tm30_sync` blob — "Re-Generate Files" and the nightly import both overwrite that blob wholesale, so an edit stored there is silently un-done on a document that may already have been filed. `sync_rr4_tm30_day` is the one caller that passes `apply_overrides=False`, keeping MEWS's raw answer intact so a reset needs no re-fetch; every read path (`get_rr4_report`/`get_tm30_report` default, `read_managed_day`, `_read_rr4_tm30_cached_day` for the email) lays the corrections back over it. Rows are addressed by `_key` = `<ReservationId>:<CustomerId>` (or `:placeholder:<n>`), never by the positional line number — a day imported before `_key` existed has to be re-generated once before it can be edited, which the editor detects and offers up front. Editable columns are served from `GET /rr4/edit-columns` off the export's own `_RR4_COLUMNS`/`_TM30_COLUMNS`, so the editor cannot drift from the filed form; overrides may introduce a column MEWS never sets (the four Thai-name columns are always blank), which is why applying assigns rather than only replacing.
  - Nationality codes: neither form uses ISO alpha-2, which is all the Connector API gives. `rr4_nationality_codes` / `tm30_nationality_codes` (editable at Admin > RR4-Nationality and TM30-Nationality) layer over the hardcoded fallbacks in `api/app/services/rr4_tm30_reference.py`, which were reconciled against the real generator sheet and carry inline evidence for each hand-corrected entry. An unmapped code renders blank rather than blocking the row.
- `/st-files` (sidebar "Statistic Files") — Daily occupancy report per property + single Bangkok date, replicating the old manual "Chinatown-ST" Google Sheet: 8 underline-tabs (Spaces / Occupied / House Uses / Out of Order / Availability / Customers / Arrivals / Departures). Backend is `GET /st-files/report` → `sync_service.get_st_files_report`, which joins 6 MEWS calls: `services/getAll` (resolve the Bookable ServiceId), `resourceCategories/getAll` (**requires `ServiceIds` in the payload and the Resource Categories permission on the property's Connector token** — 401s if MEWS hasn't enabled it), `services/getAvailability/2024-01-22` (Occupied/HouseUse/OutOfOrderBlocks/ActiveResources per category), legacy un-versioned `services/getAvailability` (MEWS's own precomputed free-to-sell number — deliberately not derived by hand), `resourceBlocks/getAll` (named OOO/house-use rows), and the RR3-style `reservations/getAll` Extent join. Category tabs only count `Type in (Room, Bed)` — verified to reproduce the sheet's totals exactly (Chinatown = 176). `GET /st-files/export` emits the legacy pipe-delimited `PMSST|RMSST` submission file (10 fixed metric rows, 41 fields each), named `{property_code}_ST_{yyyymmdd}.csv` from `property_api_settings.st_property_code` — which **raises rather than guessing** if that property has no code yet, since this is a real submission. The **Complimentary** metric (`sync_service._is_complimentary`) is `State == "Started" AND (Rate in {"Complimentary", "Complimentary Room"} OR BusinessSegment == "Complimentary")` — both arms matter and the Segment arm is the reliable one: on 25-Aug-2026 it was right on all four real complimentary rooms while Rate caught only two, because a comp room can sit on an ordinary commercial rate with nothing but the segment marking it (Patong #156361, rate "Group Leisure Series - Room Only"). Segment names are `.strip()`ed — MEWS stores them as typed and several carry a trailing space. Siem Reap's own sheet uses a narrower Rate-only formula that is deliberately **not** reproduced. Verify any of this against the sheets with `scripts/st_compare.py`
- `/rv` (sidebar "Revenue Files") — The revenue/payment counterpart to ST Files: `sync_service.get_rv_report` builds a daily journal from `orderItems/getAll` (by `ConsumedUtc`), `payments/getAll` (by `CreatedUtc`) and `outletItems/getAll`. `GET /rv/export` emits the pipe-delimited Infor `PMSRV` journal in the same 41-field layout as the ST file. Three things here were each a real bug found against a real file, not theory:
  - **Order items with `AccountingState == "Canceled"` must be dropped.** MEWS keeps the superseded posting next to its replacement; on one Chinatown day that was 95 of 224 accommodation items and ~197k of phantom revenue (2.4× overstated). Payments have no such twins.
  - **Outlet (POS) tills are a separate MEWS ledger** and never appear in `orderItems`/`payments` — `outletItems/getAll` is a whole additional revenue source, not a detail.
  - **VAT is summed from each item's `Amount.TaxValues`**, never derived from a rate, because MEWS already splits mixed-rate items. Some properties stack a duplicate service-charge component into the same array (Makati), so the chart's `vat_tax_codes` restricts which codes count as output tax, and `secondary_tax` captures Thailand's separate 1% provincial tax.
  - **GL accounts are per-property and not interchangeable** (Siem Reap books Guest Ledger to 11401 where Chinatown uses 21203). Resolution order is `rv_gl_mappings` (pulled from MEWS's own `accountingCategories/getAll` via `POST /rv/gl-mappings/sync` — `LedgerAccountCode`, not `Code`, is the real account) → the hand-verified `_RV_CHARTS` dict in `sync_service.py` → fallback. Export refuses outright for a property with neither, rather than borrowing another property's codes; on-screen viewing still works
- `/revenue` — Occupancy % per space category per night (`sync_service.get_occupancy_report`, from `services/getAvailability/2024-01-22`, which returns a value per time unit so a range costs one call per ~99-day slice — MEWS rejects a 100-day interval outright), plus a **Rate** tab priced from MEWS's own default BAR rate and an **Occupancy By Type Calendar** with an adjustable stop-sale threshold. The Total row sums occupied and active across categories rather than averaging percentages — a 40-bed dorm at 20% must not weigh the same as a 4-room category at 100%. Categories are filtered to the property's own ST space types for the same reason ST Files does it (a parent Dorm category covers the same physical beds as its child Bed category). Snapshots go to `occupancy_sync` as plain `jsonb`, anchored to **whole months** (`occupancy.snapshot_range`: first of the capture's month through 12 months forward) because the calendar reads a month at a time and a snapshot starting on the 21st left days 1–20 blank. Pruned to the newest 7 per property — and pruning deliberately does *not* happen inside `sync_occupancy_day`, so a manual import of an older date for comparison survives until the next 08:00 run
- `/reconciliation` — The one module with no MEWS or Supabase involvement at all: two file-upload tools backed by `api/app/services/reconciliation_service.py` (pandas + openpyxl). `POST /reconciliation/gl-split` splits a GL Account Detail export into a per-account-code workbook (All Transactions / Outstanding / Offset, where offsets are greedily paired transactions summing to zero) zipped together; `POST /reconciliation/bank-gl-match` matches Bank Statement rows to GL rows by amount with a ±1 day tolerance. Header rows are *found* by scanning for the required column names, not assumed at a fixed index, because the exports carry title/metadata rows above them
- `/bcp` — Mews Business Continuity Plan: read-only snapshots (captured every 5 minutes) of a wide reservation window so front desk can keep working from the latest copy when MEWS is down. Backend `sync_service.get_bcp_snapshot` builds a MEWS-style Timeline: one `reservations/getAll` Extent call spanning today ±7 days (`_BCP_WINDOW_DAYS_BACK`/`_BCP_WINDOW_DAYS_FORWARD`) feeds room-row × date-column bars, joined against `orderItems/getAll` (rate-vs-product charge breakdown, gross/net, chunked 100 IDs at a time) and `serviceOrderNotes/getAll` (permission-gated — degrades to empty notes if the token lacks it), plus window-wide deduplicated lookups for reservation groups/rates/companies/business segments. Room rows come from `resources/getAll`, grouped/ordered by MEWS's own `resourceCategories.Ordering` field (not alphabetically — getting this wrong previously mis-ordered a live property's category groups), retried once on failure since a second failure silently collapses the grouping to empty; a resource with a `ParentResourceId` (e.g. a dorm room split into individually bookable beds) nests directly under its parent regardless of its own category. `Reservation.Origin`'s combined enum string (e.g. `CommanderInPerson`) is parsed back into MEWS's own "Reservation source" label, with a separate branch for channel-manager/OTA bookings whose Origin format differs entirely. Frontend `/bcp/page.tsx` has **Timeline** (the grid, with date navigation and space search; clicking a reservation bar opens a detail panel with group/category/rate/company/travel-agency info, the expandable rate/items charge breakdown, notes, and a room-lock padlock indicator; clicking a room opens its own state/category panel) and **Payments** (today's `payments/getAll`) tabs, plus a print-only plain table (`hidden print:block`, triggered by "Print Housekeeping Sheet", with a "Cleaned ✓" tick column) since the on-screen grid doesn't paginate for print.
  - **Two storage layers, opposite retention policies, and this distinction matters.** `bcp_snapshots` is the *disposable* read-only copy: gzipped + Fernet-encrypted, pruned to the newest `SNAPSHOTS_KEPT` (12) per property, i.e. 1 hour at 5-minute intervals — deliberately short, since at the original 48h/576 it was by far the largest table in the database and drove a Supabase disk auto-expand. Everything front desk *enters while MEWS is down* goes to its own **durable, never-pruned** tables instead: `bcp_action_logs` (the Check In/Out, Chg Room, Room Status, Reg Card Saved audit trail, with frozen copies of the reservation and guest profile as they stood at the time), `bcp_reg_cards`, `bcp_reservation_notes`, `bcp_room_changes`, and the `bcp_*_overrides` family (room status/number/type, arrival, billing, guest, room lock). Any new BCP feature that captures user input follows this: durable table + Action Log visibility, never the snapshot blob. `action-logs` is queried per *property*, not per day — an unresolved action shouldn't stop being flagged because the date rolled over.
  - Router `bcp.py`: `GET /bcp/live` (build fresh, don't store — the UI's fallback when history is empty; useless once MEWS is actually down), `POST /bcp/capture`, `GET /bcp/snapshots` + `GET /bcp/snapshot?id=` (history picker), `GET /bcp/last-capture`, plus GET/POST pairs for each override table and `action-logs` (+ `/toggle`, `/archive`, `/delete`). `GET /bcp/auto-capture` is its own dedicated Vercel Cron entry; each property takes the same `acquire_sync_lock`/`release_sync_lock` RPCs `daily_auto_sync` uses (4-minute timeout) so an overrunning capture can't overlap the next tick, and captures log to `sync_logs` **only on failure** (a success row per property per 5-minute cycle would drown the Activity Log)
- `/users-report` — Read-only twin of Admin > User Management's Users tab (same columns, search, sort and .xlsx export; no create/approve/edit/delete and none of their modals), as its **own main-sidebar menu** gated by `role_permissions.users_report`. It exists so a role can be shown the user directory without being given the Admin menu, which would carry every other admin page with it. Unlike the other main menus it is **route-guarded** in `Navigation.tsx`, not merely link-hidden — same reasoning `/admin/*` has, for the same kind of content — and it is the one field the hardcoded `role_permissions` fallback leaves `false`: that fallback exists so a missing row can't strand someone with an empty sidebar, which is not a reason to hand out every account's email and sign-in history. Super Admin is **not** special-cased (ordinary sidebar menus read straight from the table), so `api/sql/users_report_menu.sql` switches the column on for it explicitly
- `/admin/*` — Dashboard, User Management, Email SMTP, Sync & Schedule (per-feature schedules, Retry Policy, FTP Upload), Property & API (per-property tokens, `st_property_code`, RR4/TM30 window), Email Template, RR4-Nationality, TM30-Nationality, Activity Log

### Emails and FTP delivery

`api/app/services/email_service.py` sends through the single global `smtp_settings` row. Templates live in `email_templates` keyed by `template_key`, edited at **Admin > Email Template**, whose tabs are grouped (`GROUP_CONFIG` in `src/app/admin/templates/page.tsx`): Billing, RR3, **System Email** (welcome / internal welcome / password reset / Google sign-in notice / approved / the two verification mails below), **Statistic Files** (bundled digest + per-property), **RR4 / TM30 Files** (same pair). Grouping exists so the pill row doesn't grow one more top-level tab per template; a group with a single child renders as a plain tab.

Each digest has both an **All Property** bundled form and a **Per-Property** form on that property's own send time, and a `_last_sent_date` marker column so a repeated cron tick can't re-send. Save and "Send Test Now" are deliberately **two separate buttons** — don't merge them.

### Sheet-verification mails (temporary monitoring)

Two daily mails compare what NHGOne produces against the Google Sheets that are the **ground truth** for what gets filed, so the new system can be watched before it replaces them. Both live at **Admin > Email Template > System Email** (Test ST File / Test RR4/TM30 File) with their own recipients, 08:00 Asia/Bangkok send time, subject and body — and both are removable without SQL, since `email_templates` already has every column they use.

- **`st_compare_service.py`** — ST Files vs each property's `<Name>-ST` sheet, 9 metrics × 8 properties. All 8 sheets must agree on one date or nothing is sent; they hold one pasted export each, so a day they no longer hold cannot be reconstructed.
- **`rr4_compare_service.py`** — RR4/TM30 vs each Thai property's `RR4-TM30-<Name>-Gen` sheet, Thailand only (Siem Reap and Makati have no generator sheet and never will). Rows are paired by passport/PID and then compared **column by column** — a key-based diff that stops at "found a row with this passport" once called Patong's TM30 a perfect match while a full-field diff surfaced 6 differing rows. Unlike ST, **each property is compared at its own sheet's date**: Chinatown cuts its day at 12:15 where the rest cut at ~02:00, so it always runs a day behind and one shared date would mean never sending. Four documented drift patterns (`_KNOWN_DRIFT`) are counted separately from real differences so the headline number stays meaningful. It also reports each sheet's own export window against `property_api_settings.rr4_tm30_day_start_*`, since the sheets change theirs without warning and a stale value silently undercounts the register — the TM30 pair in that table is shown for information only and never flagged, because our TM30 side is always plain midnight.

`compare_mail.py` is the single send path both use — the scheduled job, the Admin "Send Test Now" button and the two CLIs (`scripts/st_compare.py`, `scripts/rr4_compare.py`) all go through it, so a test send and the real one can't disagree. A comparison that isn't in a usable state logs and sends **nothing**: a mail reading "ตรงกับชีตทั้งหมด" built from an empty comparison is worse than no mail.

`ftp_service.py` uploads the ST and/or RV export files to one global plain-FTP destination (`ftp_settings`, Admin > Sync > FTP Upload), on its own `upload_hour`/`upload_minute`, with independent `upload_st_files` / `upload_rv_files` checkboxes. One destination folder serves every property because the filenames already disambiguate (`MS_ST_20260808.csv`, `MS_RV_20260808.csv`). Like `get_ftp_settings`, several of these config readers **degrade to defaults if the table doesn't exist yet** rather than raising — a deliberate pattern so a feature keeps working before anyone has touched Admin.

### Ground truth

The statutory and finance reports are ports of spreadsheets that are already being filed. **The per-property Google Sheets are the ground truth for RR4/TM30, and the ST Master sheets for ST Files** — our output must match them, and any difference is investigated as ours until proven otherwise. Several rules in the code look wrong until you know they were copied deliberately: RR4's `occupation`/`willGo`/`willGoCountry`/`timeCheckOut` are fixed constants in the source sheet, not derived per guest; the ST file's field 5 is a report-period month code, not a property code; the nationality tables preserve corrections for genuine typos in the source sheet (Greece's row containing Greenland's data, North Korea's row mislabeled). Comparison is column-by-column — some recurring diffs are live drift in MEWS, not bugs.

For the SunSystems RV/ST exports, the scope boundary is: **correct format and correct numbers**. Finance-side configuration gaps are theirs, not ours to chase.

### Auth guard

`src/components/Navigation.tsx` wraps every page. It checks Supabase Auth and verifies the user has a row in the `profiles` table. `/` and `/reset-password` are the only public routes — the latter is skipped by the guard entirely (`isResetPasswordPage`) because its visitor arrives holding a one-time recovery token rather than a session, and the page validates that itself. Both profile lookups in the guard use `select("*")` rather than a column list, for the same reason `role_permissions` does: a column that exists in code but not yet in the database would otherwise fail the whole query and sign *everyone* out as unauthorized.

New signups (mainly first-time Google OAuth logins) are auto-provisioned by a Postgres trigger on `auth.users` (`on_auth_user_created` → `handle_new_user()`, managed directly in Supabase SQL Editor, not a tracked migration) as `role='User'`, `status='Pending'`, with `full_name` defaulting to the email's capitalized local-part unless Google supplied a real name. A `Pending` profile sees a "Waiting for Approval" screen instead of the app shell/menus. A Super Admin approves via Admin > Users, picking a real role — this calls `POST /admin/users/{id}/approve`, which sets `status='Active'`. A still-missing profile (trigger somehow didn't fire) falls back to `POST /admin/self-register` (same fixed `role='User'/status='Pending'` defaults) before the old sign-out-as-unauthorized path. Admin-created invites (`POST /admin/users`) are unaffected — that endpoint's own upsert overwrites the trigger's defaults with the real role and `status='Active'` immediately after creating the auth user. If that upsert fails, the just-created auth user is deleted again rather than left orphaned: an auth row with no profile takes the address hostage (retrying the same email fails as "already registered" while the person still can't sign in).

**Google vs Internal accounts.** Admin > Users' create dialog has a *User Authentication* choice (`profiles.auth_method`). `google` (the default) generates a throwaway random password purely so the Supabase Auth row exists — the real credential is Google OAuth, linked by email. `internal` generates a *real* password, emails it to the user (`send_internal_welcome_email`, hardcoded rather than an Admin > Email Template design so a stray template edit can't drop the password and mail an unusable account), and sets `profiles.must_change_password`. That flag makes `Navigation.tsx` render `ForcePasswordChangeScreen` instead of the app shell — same blocking-screen pattern as `Pending` — until the user replaces the emailed password. Clearing the flag is client-side, consistent with the rest of this app's `role_permissions`-style gating; it is a "don't keep using a password that sat in a mailbox" gate, not a security boundary.

**Forgot password** (Internal Auth only) is `POST /auth/forgot-password` in `api/app/routers/auth.py` — public, no session, deliberately not under `/admin`. It mints a Supabase recovery link with the admin API's `generate_link` rather than the client-side `resetPasswordForEmail`, so the mail goes out through this app's own SMTP and branding; the link lands on `/reset-password`. Every outcome returns an identical response — a form that answers differently for a real address than an unknown one is an account-enumeration oracle on a public login page — so the three real outcomes are invisible to the caller: internal account → reset link, Google account → a "sign in with Google instead" note to the mailbox's real owner, unknown address → nothing sent.

Which sidebar menus each role can see is controlled by the `role_permissions` table (one row per role, one boolean column per menu), edited via Admin > Users > Role Settings tab. The current columns are `dashboard`, `data_mart`, `bills`, `rr3`, `st_files`, `revenue`, `rv`, `bcp`, `rr4_tm30`, `reconciliation`, `users_report`, `admin` — mirrored in the `MenuPermissions` interface in `src/lib/menuPermissions.ts`, which any page can call to see the same set the sidebar would show. **Adding a menu means adding a column here, a field there, and an entry in both fallbacks.**

`Navigation.tsx` reads the row with `select("*")` (not an explicit column list) on purpose — if a newly added menu column doesn't exist in the DB yet, an explicit list would fail the whole query and dump every role onto the hardcoded fallback; with `*` the missing column just hides that one link. Roles are not a fixed set — the Role Settings tab has an "+ Add Role" input that inserts a new `role_permissions` row (Dashboard-only by default), and that role immediately becomes selectable in the Create/Edit/Approve user role dropdowns, which all read from this table rather than a hardcoded list. Super Admin is the only row that can't be edited/duplicated via the grid. `Navigation.tsx` and `UserHeader.tsx`'s Admin Console link both read this table for the signed-in user's role; Super Admin is hardcoded to always pass regardless of the table. A missing/unloaded row falls back to the old hardcoded rule (Finance = Bills only, everyone else = full menu) so a bad row can never zero out a user's menu entirely. `role_permissions` has RLS **enabled** with an `authenticated`-only policy so the browser's signed-in client can still read/write it — note the failure mode if you ever add a table here: RLS on with *no* policy silently returns empty results to the frontend rather than an error, which for this table would dump every role onto the hardcoded fallback. See **Row Level Security** below.

`role_permissions.restricted_properties` (a text array) locks a role to a subset of properties: empty/NULL (the default, and Super Admin always regardless) means unrestricted — sees every property. List one or more `property_api_settings.property_name` values and every "Select Property" dropdown resolves through `src/lib/allowedProperties.ts`'s `getAllowedProperties()`, which returns just those instead of the full list — used for property-level staff (e.g. a "Lub d Bangkok Siam Front Office" role) who should never be able to pick another hotel out of the dropdown. This is **client-side gating only** (matching the rest of the app's `role_permissions` security model, e.g. the admin route guard) — it is not enforced at the FastAPI layer, so it does not stop a user calling the API directly with a different `property_name`.

`Navigation.tsx` also enforces `/admin/*` route access itself (not just hiding the sidebar link): Super Admin always passes; every other role needs `role_permissions.admin === true` or gets redirected to `/dashboard`.

### Key Supabase tables

| Table | Purpose |
|-------|---------|
| `reservations_sync` | Encrypted reservation snapshots; `mews_id` is the unique key |
| `members_sync` | Encrypted member snapshots; `mews_id` is the unique key |
| `payments` | Payment records; `mews_id` is the unique key |
| `resources_sync` | Encrypted MEWS resource (room/space) snapshots; `mews_id` is the unique key |
| `bills_sync` | Archived MEWS bill headers + order items + owner address/tax ID; `mews_id` is the unique key; backs the Bills page's "Database" mode and `get_bill_invoice`'s cache path |
| `property_api_settings` | Per-property MEWS tokens (encrypted), `st_property_code`, the RR4/TM30 day window, and **four independent schedules** (`sync_*`, `st_files_sync_*`, `occupancy_sync_*`, `rr4_tm30_sync_*`, `rv_sync_*`) plus per-property email send times |
| `profiles` | Authorized users; required for login. `status`: `Pending` (awaiting Super Admin approval) → `Active`. `auth_method`: `google` (default) or `internal`; `must_change_password`: set on internal accounts until they replace the emailed password |
| `role_permissions` | Role × sidebar-menu access grid (one boolean column per menu, one row per role) + `restricted_properties`, edited at Admin > Users > Role Settings. Adding a menu = a column here, a field in `MenuPermissions` (both `Navigation.tsx` and `src/lib/menuPermissions.ts`), an entry in `MENU_ITEMS` and in `handleAddRole`'s default row (`admin/users/page.tsx`), and a decision about both fallbacks |
| `sync_logs` | Per-sync result log (`sync_type`: `auto` / `manual` / `retry`) |
| `sync_locks` | DB-level mutex to prevent concurrent syncs |
| `sync_retry_settings` | Retry Policy (count + interval in minutes) for `retry_scheduled_syncs` |
| `smtp_settings` | Single global SMTP config (encrypted password) for system emails |
| `ftp_settings` | Single global FTP destination (encrypted password) + upload time + per-report-type checkboxes |
| `email_templates` | All HTML email bodies keyed by `template_key`, edited at Admin > Email Template |
| `billing_templates` | Per-property HTML invoice/receipt template (`<<Token>>` placeholders), Admin > Email Template (Billing tab) |
| `rr3_templates` | Shared HTML template for the ร.ร.๓ lodger registration card (`<<Token>>`), Admin > Email Template (RR3 tab) |
| `st_files_sync` | Cached ST Files daily reports, one row per (property, report_date), whole report Fernet-encrypted as `data.blob` |
| `rv_files_sync` | Cached RV revenue journals, same one-row-per-(property, date) encrypted-blob shape |
| `rr4_tm30_sync` | Cached RR4 **and** TM30 for one day in a single row (`{"rr4": ..., "tm30": ...}`), encrypted blob |
| `rr4_tm30_overrides` | **Durable, never overwritten by a re-import** — manual per-guest corrections to a register, one encrypted row per edited guest, applied over the raw report on every read |
| `occupancy_sync` | Occupancy + Rate snapshots per (property, report_date); plain `jsonb` (no PII), newest 7 per property |
| `rv_gl_mappings` | Per-property GL account/department per MEWS `AccountingCategoryId`, pulled from `accountingCategories/getAll`; checked before the hardcoded `_RV_CHARTS` |
| `rr4_nationality_codes`, `tm30_nationality_codes` | Editable alpha-2 → form-code nationality maps, layered over `rr4_tm30_reference.py` |
| `bcp_snapshots` | 5-minute BCP snapshots, gzipped + encrypted as `data.blob`; pruned to the newest 12 per property |
| `bcp_action_logs`, `bcp_reg_cards`, `bcp_reservation_notes`, `bcp_room_changes`, `bcp_*_overrides` | **Durable, never pruned** — everything front desk enters during a BCP outage |

Storage buckets: `avatars` (profile pictures, read via `getPublicUrl`). Buckets are **not** covered by the table RLS pass below.

### Row Level Security

Every table in `public` has RLS enabled (2026-08-23; Supabase had flagged 17 tables with it off, 21 linter errors). This matters because the anon key is **public** — it ships inside the browser bundle — so "anon can read" means "the internet can read". The backend is unaffected throughout: FastAPI connects with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely.

Two shapes are in use:

- **Backend-only tables** (all `bcp_*` override/log tables, `email_templates`, `bills_sync`, `smtp_settings`, `ftp_settings`, `st_files_sync`, `rv_files_sync`, `rr4_tm30_sync`, `rr4_tm30_overrides`, `occupancy_sync`, …) — RLS on, **no policies at all**. Nothing but the service role can touch them. The `rls_enabled_no_policy` INFO lint this produces is expected and correct, not a gap to close.
- **Browser-facing tables** (`profiles`, `property_api_settings`, `sync_logs`, `role_permissions`, `rr4_nationality_codes`, `tm30_nationality_codes`) — policies scoped `TO authenticated`. Every frontend call to these happens after `supabase.auth.getUser()`, so requiring a session changes nothing for real users.

**Any new table gets an explicit RLS decision, stated in the SQL.** Supabase's default is RLS *off*, which means anon-key readable, which means public.

`profiles` and `property_api_settings` additionally carry a `block_anon` **RESTRICTIVE** policy (`TO anon USING (false)`). Restrictive policies are AND-ed with the permissive ones and apply only to the roles they name, so this shuts anon out without disturbing `authenticated`. It was used instead of deleting the legacy permissive policies those two tables still carry — `profiles`' "viewable by everyone" and `property_api_settings`' misleadingly-named "Enable all for service role", which is really `ALL / public / true`. **Those legacy policies are inert only because `block_anon` outranks them; drop `block_anon` and both tables are wide open again.**

Two traps live in `profiles` specifically, both real and both previously latent:
- A "Super Admins can update any profile" policy whose `USING` clause selects from `profiles` itself. It does not currently recurse (the SELECT policy it re-enters is a plain `true`), but any future self-referencing SELECT policy will trigger `infinite recursion detected in policy for relation profiles`.
- Its own-row rule, `USING (auth.uid() = id)`, is **not** sufficient for updates. `Navigation.tsx` repairs a first-time Google sign-in by updating the row **by email** while its `id` still differs from `auth.uid()`, and `USING` is evaluated against the OLD row. The added `authenticated_update` policy (`USING (true)`) is what keeps that path working — tightening it back to own-row-only will lock new Google users out.

Known residual: the `authenticated` policies are `USING (true)`, so any signed-in user can read/write these tables. That matches the pre-RLS behaviour exactly (nothing regressed), but it does not stop one user editing another's role. Tightening it needs a real signed-in login test first, not just a SQL-side check.

This app holds passports, national ID numbers, guest addresses and per-property MEWS tokens. Raise security concerns proactively, and never widen access to make something work.

### Chunked upsert pattern

Supabase enforces a ~60 s statement timeout, so bulk writes are chunked. The reference implementation is the `chunked_upsert` closure in `daily_auto_sync` (`api/app/main.py`): it upserts in batches of 200 and, on a timeout error, retries that batch at half size (100). The routers (`members.py`, `payments.py`, `reservations.py`) do simpler inline chunked `.upsert()` calls (chunks of 200-500) without the retry step. Follow the `chunked_upsert` pattern — including the timeout retry — for any new bulk writes.

### MEWS API gotchas worth knowing before you debug

- **Paging is not optional.** `orderItems`/`payments`/`outletItems`/`accountingCategories` all page by `Cursor`; a missing pager looks exactly like missing data. `sync_service._rv_fetch_paged` is the helper.
- **Interval limits.** `services/getAvailability/2024-01-22` rejects an interval of 100 days or more ("The interval must not exceed 100D"); reservation windows are split at 89 days by `_split_date_windows`. Reservation-ID batches cap at 1000 per request.
- **`StartUtc` is the deprecated *scheduled* time** (the hotel's standard 14:00 check-in) and never updates when the guest actually arrives. Use `ActualStartUtc` for anything a human would call a check-in time — this has been a real bug in both RR3 and RR4.
- **Time-unit boundaries are property-local midnight**, not UTC midnight, or MEWS answers "is not start of TimeUnit". Every report resolves the property's own timezone first (`_resolve_property_timezone`).
- **Connector permissions are per-property and can be missing.** Resource Categories 401s if not enabled; `serviceOrderNotes/getAll` is permission-gated and degrades to empty notes rather than failing the snapshot.

### Git workflow

Commit **and push to `origin main`** after every completed and verified change, without waiting to be asked each time. Commit messages in this repo follow `type(scope): summary` with the scope naming the module (`fix(rv):`, `feat(revenue):`, `security(rls):`, `docs(tm30):`).
