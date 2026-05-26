# Project Context: NHGOne

## Recent Changes (as of 26-May-2026)

### 1. Auto Import Schedule Stability
Fixed persistent "statement timeout" and "duplicate key" errors in the automated synchronization job.
- **Locking Mechanism**: Added a database-backed lock (`sync_locks` table) to prevent concurrent executions for the same property.
- **Optimized Upsert**: Reduced chunk sizes to 200 items and added an auto-retry with 100 items if a timeout is detected.
- **Robust Error Handling**: Each sync stage (Reservations, Members, Payments) is now independent; failure in one doesn't stop the others.

### 2. Data Mart UI Improvements
Aligned the column headers in the "Data Mart" Reservations view with the "Live Data" view.
- **Predefined Column Order**: Enforced a strict 58-column sequence in `DashboardView.tsx` matching the MEWS Reservation Report standard.
- **Cross-View Consistency**: Ensured that transitioning between Live API and Database views preserves the logical order of information.

## Tech Stack
- **Frontend**: Next.js (TypeScript, Tailwind CSS)
- **Backend**: FastAPI (Python 3.12)
- **Database**: Supabase (PostgreSQL)
- **Data Source**: MEWS API (Connector API v1)

## Known Constraints
- Database statement timeout is set to a default (likely 60s), so large syncs must be chunked.
- `mews_id` is the unique Identifier for all sync entities to prevent duplicates.
