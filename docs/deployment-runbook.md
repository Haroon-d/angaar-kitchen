# Deployment and Rollback Runbook

This runbook is for moving Angaar Kitchen from the current live system to the
plain PostgreSQL build. Do not deploy directly to production without completing
the checks below.

## Release Rule

Production cutover is allowed only when all of these are true:

- The code is committed and tagged.
- The production PostgreSQL database exists and has a fresh backup/snapshot.
- Supabase/live data has been exported and kept separately.
- Migration import and validation pass against the production PostgreSQL target.
- A preview/staging deployment has been tested end to end.
- The previous live deployment is still available for immediate rollback.

## Required Production Environment

Set these in the deployment host before the PostgreSQL build goes live:

```text
DATABASE_URL=<production-postgresql-connection-string>
SESSION_SECRET=<long-random-secret>
APP_URL=<production-app-url>
VITE_AUTH_BACKEND=postgres
```

Legacy Supabase variables may remain during parallel migration/export, but the
PostgreSQL build must not rely on Supabase for operational app data.

## Pre-Deployment Checklist

1. Confirm local build passes.

```powershell
npm.cmd run build
```

2. Confirm touched files lint clean.

```powershell
npx.cmd eslint src/routes/_authenticated/pos.tsx src/routes/_authenticated/expenses.tsx src/routes/_authenticated/receipt.$orderId.tsx src/lib/postgres-data.functions.ts
```

3. Confirm migration preflight passes locally.

```powershell
npm.cmd run migration:preflight
```

4. Create a code restore point.

```powershell
git status --short
git add .
git commit -m "Prepare PostgreSQL deployment"
git tag pre-postgres-deploy
```

Do not push or deploy until the commit contents are reviewed.

## Production Database Cutover

1. Create production PostgreSQL database.
2. Apply Drizzle migrations to production.

```powershell
npm.cmd run db:migrate
```

3. Take a production PostgreSQL snapshot before importing business data.
4. Export the current live Supabase data.

```powershell
npm.cmd run migration:export
```

5. Dry-run import into production PostgreSQL.

```powershell
npm.cmd run migration:import -- --dir migration-data/<snapshot-folder>
```

6. Commit import only after the dry run succeeds.

```powershell
npm.cmd run migration:import -- --dir migration-data/<snapshot-folder> --commit
```

7. Validate data.

```powershell
npm.cmd run migration:validate -- --dir migration-data/<snapshot-folder>
npm.cmd run migration:validate-integrity
npm.cmd run migration:passwords:audit
```

8. Set PostgreSQL auth passwords for operational users.

```powershell
npm.cmd run migration:passwords:set -- --email user@example.com --generate
```

## Preview Test Script

Before live traffic is moved, verify these in a preview/staging deployment:

- Login with a PostgreSQL user.
- Dashboard loads correct branch/restaurant.
- POS creates an order.
- POS supports dine-in, takeaway, and delivery.
- Delivery address/order notes save and show on receipt/KOT.
- Item notes save and show on receipt/KOT.
- Receipt page loads and prints KOT/bill/receipt.
- Payment can be recorded.
- Orders list shows the new order.
- Expenses list opens and date picker does not crash.
- Inventory pages load.
- Menu pages load.
- Settings page loads.
- Cancel/reopen/refund controls behave only for allowed roles.

## Rollback Plan

Use this order if anything goes wrong after deployment:

1. Stop new orders in the new app.
2. Revert the app to the previous known-good deployment in the hosting provider.
3. Point traffic back to the previous deployment.
4. If PostgreSQL data was damaged, restore the latest PostgreSQL snapshot.
5. If the cutover happened before confidence was reached, keep Supabase as the
   source of truth and repeat migration after fixing the issue.
6. Record what failed, including exact time, order number if relevant, and error
   messages.

## Do Not Do

- Do not delete Supabase immediately after launch.
- Do not rotate or remove old credentials until the new app has run safely for
  at least 24 to 48 hours.
- Do not run destructive SQL manually during cutover.
- Do not deploy from an uncommitted dirty working tree.
- Do not expose service-role keys in frontend variables or screenshots.

## Go/No-Go Decision

Go live only when the owner confirms:

- Preview testing passed.
- Database backup exists and restore path is known.
- Staff login/passwords are ready.
- Previous deployment rollback is available.
- Live cutover window is agreed.
