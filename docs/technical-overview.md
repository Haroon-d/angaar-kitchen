# Angaar Kitchen Technical Overview

These notes explain the project in interview-friendly language. The goal is to
understand what the app does, how it is built, how data moves through it, and
how to talk about the architecture confidently.

## One-Line Summary

Angaar Kitchen is a restaurant operations web app for managing POS orders, menu,
inventory, expenses, staff access, receipts, and business dashboards. It started
with Supabase and is being migrated to plain PostgreSQL with Drizzle while
keeping Vercel as the hosting platform.

## Product Scope

The app supports these restaurant workflows:

- Public landing page with customer-facing brand presentation.
- Staff login and protected restaurant workspace.
- POS screen for dine-in, takeaway, and delivery orders.
- Customer details, table number, phone, delivery/address, and order notes.
- Order list, payment status, refunds/voids where supported.
- Receipt, bill, and KOT printing.
- Menu categories and menu items.
- Inventory items, recipe deduction, purchases, and stock movements.
- Operational expenses with categories and dates.
- Staff and role-based access.
- Dashboard reporting.
- Branch and printer settings.

The removed daily closing/stock count module is intentionally not part of the
new active product.

## Tech Stack

Frontend:

- React 19 for UI.
- TanStack Router and TanStack Start for file-based routing and server
  functions.
- Vite for development/build tooling.
- Tailwind CSS for styling.
- Radix UI components for accessible UI primitives.
- Lucide React for icons.
- React Hook Form and Zod for form validation.
- Recharts for dashboard charts.
- Sonner for toast notifications.

Backend/Application Layer:

- TanStack Start server functions for backend actions.
- Server-side service modules under `src/services`.
- PostgreSQL access through Drizzle ORM and `pg`.
- Authentication is custom PostgreSQL auth in the migrated build.
- Supabase integration remains during migration and rollback period.

Database:

- PostgreSQL 16 locally through Docker.
- Neon PostgreSQL for Vercel preview/production target.
- Drizzle schema and migrations under `src/db`.

Deployment:

- Vercel hosts the web app.
- Neon provides the hosted PostgreSQL database through Vercel integration.
- GitHub branch `postgres-migration` is used for preview before production.

Tooling:

- ESLint for linting.
- Prettier for formatting.
- Drizzle Kit for database migrations.
- Migration scripts under `scripts/migration`.

## High-Level Architecture

```text
Browser
  |
  | React UI, routes, forms
  v
TanStack Start app
  |
  | server functions in src/lib/*.functions.ts
  v
Service layer in src/services/*.server.ts
  |
  | Drizzle ORM
  v
PostgreSQL database
```

The UI should not directly own business rules. UI components collect input and
display state. Server functions act like API endpoints. Services contain the
core business logic. Drizzle handles typed database queries.

## Important Folders

`src/routes`

Defines pages and layouts. Examples:

- `index.tsx`: public landing page.
- `login.tsx`, `signup.tsx`: auth pages.
- `_authenticated.tsx`: protected app shell.
- `_authenticated/pos.tsx`: point of sale.
- `_authenticated/orders.tsx`: order management.
- `_authenticated/receipt.$orderId.tsx`: receipt route.
- `_authenticated/inventory.tsx`: inventory management.
- `_authenticated/expenses.tsx`: operational expenses.
- `_authenticated/dashboard.tsx`: dashboard.

`src/components`

Reusable UI components. `src/components/ui` contains Radix/shadcn-style UI
building blocks. `src/components/receipt` contains receipt and KOT templates.

`src/lib`

Server functions and client helpers. Files ending in `.functions.ts` expose
backend operations to routes. PostgreSQL-specific functions use services and the
database layer.

`src/services`

Business logic. Examples:

- `auth.service.server.ts`: password hashing, login, sessions.
- `order.service.server.ts`: order creation/payment/order operations.
- `dashboard.service.server.ts`: reporting queries.
- `menu.service.server.ts`: menu logic.
- `staff.service.server.ts`: staff and roles.
- `authorization.service.server.ts`: role lookup and access rules.

`src/db`

Database schema, migrations, and the PostgreSQL client.

`src/integrations`

External backend integrations:

- `supabase`: legacy/current source during migration.
- `postgres`: new custom auth middleware.

`scripts/migration`

Migration tooling for moving data from Supabase to plain PostgreSQL.

`docs`

Runbooks and technical documentation.

## Request/Data Flow Example: Login

```text
User enters email/password
  -> src/routes/login.tsx
  -> useAuth hook
  -> signInWithPasswordPostgres server function
  -> auth.service.server.ts
  -> users + password_credentials tables
  -> sessions table
  -> token stored client-side
  -> protected routes become available
```

Passwords are not stored as plain text. The app stores a scrypt password hash in
`password_credentials`.

## Request/Data Flow Example: POS Order

```text
Cashier selects items in POS
  -> UI builds order/cart state
  -> server function submits order
  -> order service validates totals and branch
  -> orders table gets order header
  -> order_items stores item snapshots
  -> payments records payment if paid
  -> inventory_movements can record stock deduction
  -> receipt/KOT can be printed
```

Important design choice: order items store snapshots like item name and price.
That means an old receipt stays correct even if the menu item price changes
later.

## Request/Data Flow Example: Inventory

Inventory is tracked with current quantity and movement history.

```text
Purchase/adjustment/sale
  -> inventory_items current_qty changes
  -> inventory_movements records before_qty, quantity_delta, after_qty
```

This gives both current stock and an audit trail of how stock changed.

## Authentication Design

The app supports two auth modes:

```ts
VITE_AUTH_BACKEND=postgres
```

When this is `postgres`, the app uses custom PostgreSQL auth. When it is missing
or different, the app falls back toward Supabase auth.

Main auth pieces:

- `src/lib/auth-backend.ts`: chooses `postgres` or `supabase`.
- `src/start.ts`: attaches the correct auth middleware.
- `src/services/auth.service.server.ts`: password hashing, session creation,
  session lookup, password reset tokens.
- `src/integrations/postgres/auth-middleware.ts`: reads session token and
  attaches authenticated context.
- `src/hooks/use-auth.tsx`: frontend auth state and sign-in/sign-out behavior.

Tables:

- `users`: account identity.
- `password_credentials`: password hashes.
- `sessions`: login sessions.
- `password_reset_tokens`: reset support.
- `profiles`: display profile data.
- `user_roles`: role assignment.

## Role and Access Model

Roles are stored in `user_roles`.

Supported roles:

- `owner`
- `admin`
- `manager`
- `cashier`
- `kitchen`
- `waiter`

Roles can be scoped to a restaurant and optionally to a branch. This supports
multi-branch restaurant operations.

Interview explanation:

> The user identity is separate from role assignment. A user can exist once, but
> receive different permissions by restaurant or branch through `user_roles`.
> That makes the model flexible for owners, managers, cashiers, and kitchen
> staff.

## Database Design

The schema is in `src/db/schema.ts`.

Core identity and organization:

- `users`
- `profiles`
- `restaurants`
- `branches`
- `user_roles`

Menu:

- `menu_categories`
- `menu_items`
- `item_variants`
- `addon_groups`
- `addons`
- `item_addon_groups`

Orders and payment:

- `order_counters`
- `orders`
- `order_items`
- `order_item_addons`
- `order_taxes`
- `payments`

Inventory:

- `inventory_items`
- `suppliers`
- `inventory_purchases`
- `inventory_purchase_lines`
- `inventory_recipes`
- `inventory_movements`

Expenses and settings:

- `operational_expense_categories`
- `operational_expenses`
- `branch_printer_settings`

Audit:

- `audit_log`

## Important Database Relationships

```text
users
  -> profiles
  -> user_roles
  -> sessions

restaurants
  -> branches
  -> menu_categories
  -> menu_items
  -> orders
  -> inventory_items
  -> operational_expenses

orders
  -> order_items
  -> payments
  -> order_taxes

inventory_items
  -> inventory_movements
  -> inventory_purchase_lines
  -> inventory_recipes
```

## Why PostgreSQL

PostgreSQL is a good fit because:

- Restaurant operations need relational data.
- Orders, payments, inventory, and expenses need transactions and consistency.
- Foreign keys protect data relationships.
- Indexes support faster dashboard/order queries.
- PostgreSQL can run locally in Docker and in production through Neon.
- It avoids depending on Supabase-specific auth/storage features for core
  operations.

## Why Drizzle

Drizzle gives:

- TypeScript-friendly schema definitions.
- Migrations generated from schema changes.
- Query builder instead of raw SQL everywhere.
- Less magic than some ORMs.
- Clear mapping between TypeScript code and PostgreSQL tables.

## Migration From Supabase to PostgreSQL

The migration is designed to be careful and reversible.

Migration steps:

1. Keep Supabase as live source of truth.
2. Create PostgreSQL schema with Drizzle.
3. Export Supabase data read-only.
4. Dry-run import into PostgreSQL.
5. Commit import only after dry-run succeeds.
6. Validate row counts.
7. Validate cross-table integrity.
8. Set PostgreSQL passwords for users.
9. Test Vercel preview.
10. Do final fresh export/import at production cutover.

Important scripts:

```powershell
npm.cmd run migration:export
npm.cmd run migration:import -- --dir migration-data/<snapshot>
npm.cmd run migration:import -- --dir migration-data/<snapshot> --commit
npm.cmd run migration:validate -- --dir migration-data/<snapshot>
npm.cmd run migration:validate-integrity
npm.cmd run migration:passwords:audit
npm.cmd run migration:passwords:set -- --email user@example.com --generate
```

## Deployment Design

Development:

- Local app runs through Vite.
- Local PostgreSQL can run through Docker.

Preview:

- GitHub branch `postgres-migration`.
- Vercel creates a preview deployment.
- Preview uses Neon PostgreSQL and `VITE_AUTH_BACKEND=postgres`.

Production:

- Production remains unchanged until final cutover.
- At cutover, final Supabase data is exported/imported.
- Then the verified PostgreSQL build is promoted/deployed.

Rollback:

- Keep Supabase and previous Vercel deployment available.
- If production fails, revert Vercel to the last known good deployment.
- Do not delete Supabase immediately after launch.

## Environment Variables

Important local/deployment variables:

```text
DATABASE_URL
SESSION_SECRET
APP_URL
VITE_AUTH_BACKEND=postgres
SUPABASE_SERVICE_ROLE_KEY
```

Meanings:

- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: secret value for session/security use.
- `APP_URL`: production app URL.
- `VITE_AUTH_BACKEND`: chooses auth mode.
- `SUPABASE_SERVICE_ROLE_KEY`: local migration export only, never browser-safe.

Do not paste secrets in chat, screenshots, GitHub, or frontend code.

## Printing and Receipts

Receipt-related code:

- `src/components/receipt/ReceiptTemplate.tsx`
- `src/components/receipt/KotTemplate.tsx`
- `src/lib/print/*`

The app supports:

- Receipt rendering.
- KOT rendering.
- Browser/PDF style printing.
- Network/QZ printer related drivers/settings.

Receipt design should stay simple, readable, branded, and low-ink.

## Error Handling

`src/start.ts` includes an error middleware. It catches server-side errors and
returns a custom error page instead of crashing into a blank screen.

Frontend routes also use validation and toast messages to show user-facing
errors.

## Testing and Verification

Useful commands:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run db:migrate
npm.cmd run migration:validate-integrity
npm.cmd run migration:passwords:audit
```

During migration, the strongest verification is:

- Build passes.
- Lint passes or known warnings only.
- Migration dry-run succeeds.
- Final import commits.
- Row-count validation passes.
- Integrity validation passes.
- Password audit passes.
- Preview login works.
- POS/order/receipt/expense/inventory workflows work.

## Interview Explanation: System Design

You can say:

> This is a restaurant operations system built as a full-stack React/TanStack
> Start app. The browser renders the staff interface, server functions handle
> backend operations, service modules contain the business logic, and PostgreSQL
> stores operational data. The schema separates organization, users, roles,
> menu, orders, payments, inventory, expenses, and audit logs. The project is
> deployed on Vercel and uses Neon PostgreSQL in production/preview.

## Interview Explanation: Database

You can say:

> The database is relational because restaurant operations are highly connected:
> orders have items, payments belong to orders, inventory movements affect stock,
> and users have roles per branch. PostgreSQL foreign keys protect those
> relationships, while indexes support common queries like orders by branch/date
> and inventory by branch.

## Interview Explanation: Migration

You can say:

> We moved from Supabase-managed backend to plain PostgreSQL carefully. Supabase
> remained live during testing. We created Drizzle migrations, exported source
> data into a gitignored snapshot, dry-ran the import, committed only after the
> dry run passed, and validated row counts and relationships. We also handled
> auth separately because Supabase password hashes cannot be exported.

## Interview Explanation: Security

You can say:

> The app stores password hashes, not plain passwords. Session tokens are stored
> as hashes in the database. Sensitive keys stay in environment variables.
> Service-role Supabase keys are only used locally for migration export and are
> never exposed to browser code.

## Interview Explanation: Scalability

You can say:

> The app is designed around a branch/restaurant model, so it can grow from one
> branch to multiple branches. Data is indexed by branch and dates for common
> operational queries. Server functions keep backend logic close to the app while
> PostgreSQL handles consistency and transactions.

## Interview Explanation: Rollback

You can say:

> During migration, rollback is handled by keeping Supabase and the previous
> Vercel deployment available. If the PostgreSQL preview fails, it is not
> promoted. If production fails immediately after cutover, Vercel can roll back
> to the previous deployment and Supabase remains the source of truth.

## Strengths of This Project

- Real business domain with practical workflows.
- Clear relational data model.
- Full-stack TypeScript.
- Production deployment path with preview testing.
- Careful data migration strategy.
- Role-based access.
- Inventory and audit trail support.
- Receipt/KOT printing support.

## Things to Improve Later

- Add automated end-to-end tests for POS and receipts.
- Add stronger password reset/change-password UI.
- Add database backup automation.
- Add structured monitoring/logging for production.
- Reduce large frontend chunks by code splitting.
- Remove legacy Supabase variables after PostgreSQL is stable.
- Improve role permission checks into a central policy map.

## Short Glossary

- API: backend endpoint or function used by frontend.
- Auth: login/session system.
- Branch: one restaurant location.
- Cutover: final switch from old live system to new system.
- Drizzle: TypeScript ORM and migration tool.
- Foreign key: database rule connecting records across tables.
- KOT: kitchen order ticket.
- Migration: moving data/schema from one system to another.
- Neon: hosted PostgreSQL provider.
- ORM: tool that helps code talk to the database.
- POS: point of sale.
- Preview deployment: test deployment before production.
- Production: live customer/staff-facing system.
- Rollback: returning to previous working version.
- Snapshot: exported copy of data at a point in time.
- Supabase: previous backend/database/auth provider.
- Vercel: hosting/deployment platform.
