# PostgreSQL Migration Runbook

This project is being moved from Supabase-managed Postgres/Auth to plain PostgreSQL with
Drizzle. Until cutover, Supabase remains the live source of truth.

## Safety Rules

- Do not point the production app at PostgreSQL until export, import, and validation pass.
- Export uses `SUPABASE_SERVICE_ROLE_KEY`; keep it local and never expose it to browser code.
- `migration-data/` contains business data and is gitignored.
- The import script runs as a dry run by default and rolls back unless `--commit` is passed.
- Supabase password hashes are not exported. Users must set new PostgreSQL auth passwords before
  cutover.
- Put local-only migration values such as `DATABASE_URL`, `SESSION_SECRET`, and
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` when possible.

## Current Preview Status

- `postgres-migration` preview is wired to Neon PostgreSQL.
- Real Supabase data was imported into Neon for preview testing.
- Row-count validation, integrity validation, password audit, and production build passed.
- Supabase remains the live source of truth until production cutover.
- Do not run another import until the final production cutover window, unless intentionally
  refreshing preview test data.

## Latest Pre-Production Check

Date: 2026-06-12

- Drizzle migrations applied successfully against the configured PostgreSQL database.
- Fresh read-only Supabase export created:
  `migration-data/2026-06-12T01-01-26-466Z`
- Export did not write to Supabase.
- PostgreSQL integrity validation passed.
- PostgreSQL password audit passed: all active PostgreSQL users have password credentials.
- Lint and production build passed.
- Row-count validation against the fresh export does not match because the configured
  PostgreSQL database already contains older preview/test migrated data.

Important: do not import the fresh export into the current PostgreSQL database without an
intentional refresh plan. For production cutover, use a fresh empty PostgreSQL database, or take a
backup of the current target and explicitly replace it during the final cutover window.

## Final Closed-Window Merge

Date: 2026-06-12

- Final read-only Supabase export created:
  `migration-data/2026-06-12T01-14-13-720Z`
- PostgreSQL pre-merge backup created:
  `migration-data/postgres-backup/2026-06-12T01-14-58-377Z`
- Final export was merged into PostgreSQL with `migration:merge`.
- The merge preserved PostgreSQL-only data:
  - PostgreSQL login password credentials
  - operating hours
  - homepage promotions/banners
  - customer-system records
  - PostgreSQL-only staff/user access rows
- Stale preview rows were cleaned:
  - 11 stale order-item rows
  - 1 stale order-counter row
  - 1 stale `Delivery Charges` menu item
- Cutover validation passed with all critical business tables exact:
  - `orders`: 359
  - `order_items`: 935
  - `payments`: 354
  - `inventory_items`: 159
  - `inventory_movements`: 2996
  - `operational_expenses`: 222
- Remaining count differences are intentional PostgreSQL-only setup data:
  - extra staff/user row
  - operating hours
  - local audit entries

## Local Dry Run

1. Start PostgreSQL and apply Drizzle migrations.

```powershell
npm.cmd run docker:db
npm.cmd run db:migrate
```

2. Run preflight checks.

```powershell
npm.cmd run migration:preflight
```

For a real Supabase export, require Supabase credentials too:

```powershell
npm.cmd run migration:preflight -- --require-supabase
```

3. Export the Supabase snapshot.

```powershell
npm.cmd run migration:export
```

4. Dry-run the import into PostgreSQL.

```powershell
npm.cmd run migration:import -- --dir migration-data/<snapshot-folder>
```

5. Commit the import only after the dry run succeeds.

```powershell
npm.cmd run migration:import -- --dir migration-data/<snapshot-folder> --commit
```

6. Validate row counts.

```powershell
npm.cmd run migration:validate -- --dir migration-data/<snapshot-folder>
```

7. Validate cross-table integrity.

```powershell
npm.cmd run migration:validate-integrity
```

8. Audit PostgreSQL auth password readiness.

```powershell
npm.cmd run migration:passwords:audit
```

Imported Supabase users do not have PostgreSQL password credentials. Before auth cutover, set a
temporary password for each operational user and have them change it after first login.

```powershell
npm.cmd run migration:passwords:set -- --email user@example.com --generate
```

Use `--generate` for a temporary password, or set `POSTGRES_USER_PASSWORD` locally and pass
`--email user@example.com`. Never put real user passwords in git or chat.

## Omitted From New PostgreSQL Schema

The Daily Closing/stock count module has been removed from the active product and is intentionally
not included in the new schema or migration export:

- `stock_count_sessions`
- `stock_count_lines`
- Daily stock count functions and reconciliation workflow data

Historical Supabase migrations are left in the repository for audit history, but the new Drizzle
schema is the target schema for plain PostgreSQL.

## Production Cutover Checklist

Use this only when the restaurant is ready to switch production from Supabase to PostgreSQL.

1. Pause live ordering/admin changes briefly so the final export is complete.
2. Take a final Supabase export.

```powershell
npm.cmd run migration:export
```

3. Import that final snapshot into the target production PostgreSQL database.

```powershell
npm.cmd run migration:import -- --dir migration-data/<final-snapshot-folder>
npm.cmd run migration:import -- --dir migration-data/<final-snapshot-folder> --commit
```

4. Validate final data.

```powershell
npm.cmd run migration:validate -- --dir migration-data/<final-snapshot-folder>
npm.cmd run migration:validate-integrity
npm.cmd run migration:passwords:audit
```

5. Confirm Vercel production environment variables:

- `DATABASE_URL` points to the final Neon PostgreSQL database.
- `VITE_AUTH_BACKEND=postgres`
- `SESSION_SECRET` is present.
- Supabase browser variables may remain temporarily for rollback, but should not be used in
  PostgreSQL mode.

6. Promote/deploy the verified `postgres-migration` branch to production.
7. Smoke test production login, dashboard, POS, orders, receipt, expenses, and inventory.

Rollback path: if production has a serious problem immediately after cutover, restore the previous
Vercel production deployment and keep Supabase as the source of truth. Do not delete Supabase or old
environment variables until PostgreSQL production has been stable through real restaurant use.
