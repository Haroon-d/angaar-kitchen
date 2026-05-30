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
