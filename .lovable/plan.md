
# Angaar Kitchen — Build Plan

A real, multi-tenant-ready restaurant management platform. We'll ship in phases so each module is genuinely production-quality instead of a wide but shallow demo.

## V1 Scope (this build)
1. Authentication & Authorization (email/password + Google, role-based)
2. Restaurant Setup (profile, branches, taxes, operating hours, business settings)
3. Menu Management (categories, items, variants, addons, availability, images)
4. POS — Billing & Receipts (dine-in / takeaway / delivery, discounts, split payment, printable receipt)
5. Settings & Branding shell

Deferred to v2+: KDS realtime board, Inventory, Reservations/Tables/QR, Online Ordering site, Customers/Loyalty, Staff scheduling, Reports/Analytics. Schema in v1 will be designed so these layer in cleanly.

## Architecture

- Backend: Lovable Cloud (Postgres + Auth + Storage + Realtime)
- Multi-branch from day one (every business entity scoped by `branch_id`)
- Roles in a separate `user_roles` table (never on profiles) with `has_role()` security-definer function
- RLS on every table; staff scoped to their assigned branch(es), owners/admins to all
- Server functions (`createServerFn`) for all sensitive ops (creating orders, finalizing payments, assigning roles)
- File storage bucket `menu-images` (public read, authed write)

### Database (v1 tables)

```text
profiles(id, full_name, phone, avatar_url)
app_role enum: owner | admin | manager | cashier | kitchen | waiter
user_roles(user_id, role, branch_id?)
restaurants(id, name, legal_name, logo_url, currency, timezone, ...)
branches(id, restaurant_id, name, address, phone, is_active)
operating_hours(branch_id, weekday, open_time, close_time, is_closed)
taxes(id, restaurant_id, name, rate, is_inclusive, is_active)
branch_taxes(branch_id, tax_id)
menu_categories(id, branch_id, name, sort_order, is_active, image_url)
menu_items(id, category_id, name, description, base_price, image_url, is_available, is_veg, prep_time)
item_variants(id, item_id, name, price_delta, is_default)
addon_groups(id, branch_id, name, min_select, max_select)
addons(id, group_id, name, price)
item_addon_groups(item_id, group_id)
dining_types enum: dine_in | takeaway | delivery
orders(id, branch_id, order_no, dining_type, status, customer_name, customer_phone,
       table_label, subtotal, discount_total, tax_total, grand_total, notes,
       created_by, created_at)
order_items(id, order_id, item_id, variant_id, name_snapshot, unit_price, qty,
            line_subtotal, line_total, notes)
order_item_addons(id, order_item_id, addon_id, name_snapshot, price_snapshot)
order_taxes(order_id, tax_id, name_snapshot, rate_snapshot, amount)
payments(id, order_id, method, amount, reference, paid_at, received_by)
order_status enum: open | placed | preparing | ready | served | completed | cancelled
```

Order numbers generated server-side (`AK-{branch_code}-{YYYYMMDD}-{seq}`). Totals computed in server functions, never trusted from the client.

### Roles & permissions
- `owner` / `admin` — everything in their restaurant
- `manager` — branch ops, menu, reports for assigned branch
- `cashier` — POS, take payments
- `kitchen` — view orders, change cook status (KDS-ready)
- `waiter` — create orders, no payment finalization

### Routing

```text
/login, /signup, /forgot-password, /reset-password
/onboarding                 (first-time restaurant setup)
/_authenticated/
  /                         redirects to /pos or /dashboard
  /dashboard                today's KPIs
  /pos                      ticket builder + payment
  /pos/receipt/$orderId     printable receipt
  /menu                     categories + items + addons tabs
  /branches
  /settings                 profile, taxes, hours, branding
  /staff                    invite + role assignment
```

## Design system (dark fiery premium)

- Background `#0B0A09` charcoal, surface `#16120F`, ember `#FF5B1F` primary, gold `#F5B544` accent, success `#22C55E`, danger `#EF4444`
- Display: Playfair Display (serif). Body: Inter. Mono for prices.
- Subtle grain + ember-glow gradients on hero/auth surfaces; admin stays calm with tasteful warm accents
- Tokens defined in `src/styles.css` using `oklch`, no inline colors in components
- Framer Motion for page + ticket transitions

## Build order (this turn)

1. Enable Lovable Cloud
2. Migrations: enums, tables, RLS, `has_role()`, order-number sequence, storage bucket
3. Design system + shell (root layout, sidebar, top bar, theming)
4. Auth flow (login/signup/reset, `_authenticated` guard, role context)
5. Onboarding wizard → restaurant + first branch + roles seed
6. Menu module (categories, items, variants, addons, image upload, availability)
7. Settings (profile, taxes, operating hours, branding)
8. Branches + Staff (invite, assign role + branch)
9. POS (item grid, cart, modifiers, discount, split payment, finalize via server fn)
10. Receipt page (print-friendly, A80 thermal-style)

## Out of scope this turn (will plan separately)
KDS realtime board, Inventory + suppliers, Reservations/Tables/QR ordering, Customer-facing online ordering site, Coupons, Reports/Analytics dashboards, Notifications, Payment gateway.

## Notes
This is a substantial build. I'll implement it end-to-end in this turn but recommend we iterate after v1 lands so each subsequent module (KDS, Inventory, Online ordering) gets the same depth rather than being squeezed in.
