# Release Readiness - PostgreSQL Migration

Date: 2026-05-30

## Scope

- Local PostgreSQL/Drizzle wiring is in place for the app.
- Daily closing route/module has been removed.
- POS, orders, expenses, receipts, staff, settings, menu, inventory, dashboard, and auth flows are wired through the PostgreSQL compatibility layer where implemented.
- Receipt output has been kept simple and branded with Angaar/Kitchen text and restaurant address details.

## Checks Passed

- `npm.cmd run db:migrate`
- `npm.cmd run migration:preflight -- --allow-non-empty`
- `npm.cmd run migration:validate-integrity`
- `npm.cmd run migration:passwords:audit`
- `npm.cmd run lint`
- `npm.cmd run build`
- Production preview smoke test on `http://127.0.0.1:4173/`
  - `/`, `/login`, and `/signup` returned `200`
  - protected routes returned `307` while unauthenticated, as expected

## Known Warnings

- ESLint reports existing Fast Refresh warnings in shared UI/hook files. These are warnings, not release blockers.
- Production build reports bundle-size and third-party module directive warnings from Vite/TanStack/Radix/Sonner packages. The build completed successfully.
- Local build had to be run outside the sandbox because the Windows sandbox blocked Vite from reading the config path.
- `migration:validate -- --dir migration-data/2026-05-28T16-58-56-259Z` found stale snapshot drift in `order_counters` and `audit_log` only. Use a fresh export at production cutover before treating row-count validation as authoritative.

## Not Done Yet

- No live deployment has been performed.
- No GitHub push has been performed.
- Production PostgreSQL cutover has not been executed from this machine in this step.
- A production database snapshot/export must be taken immediately before cutover.
- Final preview smoke test should be done on the deployed preview URL before switching live traffic.

## Latest Export Snapshot

- Fresh Supabase read-only export created: `migration-data/2026-05-30T14-57-30-393Z`
- The export completed without writing to Supabase.
- Local PostgreSQL does not exactly match this fresh snapshot because local testing changed data counts. Use a new empty production PostgreSQL database for the real import.
- Keep `migration-data/` out of Git because it can contain business/customer data.

## Latest Pre-Production Check

Date: 2026-06-12

- Drizzle migrations applied successfully against the configured PostgreSQL database.
- Fresh Supabase read-only export created: `migration-data/2026-06-12T01-01-26-466Z`
- Export counts show Supabase is ahead of the current PostgreSQL preview data:
  - `orders`: Supabase 359, PostgreSQL 156
  - `order_items`: Supabase 935, PostgreSQL 437
  - `payments`: Supabase 354, PostgreSQL 153
  - `inventory_movements`: Supabase 2996, PostgreSQL 725
  - `operational_expenses`: Supabase 222, PostgreSQL 120
- PostgreSQL integrity validation passed.
- PostgreSQL password audit passed.
- Lint, diff check, and production build passed.
- Do not treat the current PostgreSQL database as final production data. It is a preview/import
  target with older data. The production cutover should import a fresh final export into a fresh
  empty PostgreSQL database, or into a deliberately refreshed target after backup.

## Final Closed-Window PostgreSQL Data Merge

Date: 2026-06-12

- Final Supabase source export: `migration-data/2026-06-12T01-14-13-720Z`
- PostgreSQL target backup before merge:
  `migration-data/postgres-backup/2026-06-12T01-14-58-377Z`
- Merge dry-run passed and was rolled back.
- Merge commit completed.
- Targeted cleanup completed:
  - removed 11 stale order-item rows
  - removed 1 stale order-counter row
  - removed 1 stale `Delivery Charges` menu item
- Cutover-aware validation passed:
  - `orders`: exact 359
  - `order_items`: exact 935
  - `payments`: exact 354
  - `inventory_items`: exact 159
  - `inventory_movements`: exact 2996
  - `operational_expenses`: exact 222
- PostgreSQL-only rows intentionally preserved:
  - 1 extra staff/user access row
  - 7 operating-hour rows
  - 11 local audit rows
- PostgreSQL password audit passed: 2 active users, 2 with passwords, 0 missing.
- PostgreSQL integrity validation passed.

## Cutover Checklist

1. Confirm the current live app is still on the old environment.
2. Take a fresh source database backup/export.
3. Prepare the target PostgreSQL database and environment variables.
4. Run migrations against the target PostgreSQL database.
5. Import the exported data.
6. Run preflight, integrity validation, and password audit against the target database.
7. Deploy to preview with PostgreSQL environment variables.
8. Smoke test login, POS order creation, receipt view/print, expenses date entry, menu, inventory, orders, staff, and settings.
9. Promote only after preview is verified.

## Rollback Plan

1. Keep the old Supabase-backed deployment available until PostgreSQL is verified.
2. Keep the source database backup/export from the cutover window.
3. If preview fails, do not promote it.
4. If live promotion fails, revert the deployment to the last known good deployment in the hosting dashboard.
5. Point environment variables back to the previous backend if required.
6. Re-run smoke tests after rollback before resuming restaurant operations.
