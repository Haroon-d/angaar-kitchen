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
