# Finance Control Architecture

Angaar Kitchen finance must behave like an accountant, not only like a form. The system should ask where every rupee came from, where it went, who owes us, who we owe, and whether the counted money matches the expected money.

## Goal

Create one trustworthy finance layer for the whole restaurant:

- Counter cash and online balances are always explainable.
- Paid orders, unpaid orders, expenses, purchases, supplier dues, owner money, staff advances, transfers, refunds, and corrections all connect to finance.
- A manager can recover mistakes through audited settlements and corrections, not by silently changing history.
- Reports can be used for serious decisions only when inventory recipes and purchase costing are complete enough.

## Core Rule

Money records should be append-only. If something is wrong, create a correction or reversal entry with a reason. Do not silently delete or rewrite old financial truth.

## Accounts

The system should maintain finance accounts such as:

- Counter Cash
- Online / Bank / JazzCash / Easypaisa
- Owner Pocket
- Backup Fund
- Profit Reserve: funds moved from an operating account and retained for later business expenses. Managers can add funds; only owners/admins can reveal the balance or record reserve-paid expenses after password verification.
- Supplier Payables
- Customer Receivables
- Staff Advances
- Revenue
- Expenses
- Inventory Asset
- Refunds / Discounts / Corrections

Cash and online accounts must not go negative unless the account is explicitly marked as allowed to overdraft. Owner Pocket, Supplier Credit, and Backup Fund are allowed to create payables or liability records.

The Profit Reserve is a protected cash allocation, not a profit calculation. Actual profit still
depends on complete revenue, expense, purchase, and inventory-cost records.

## Ledger

The long-term single source of truth should be a finance ledger table:

- `id`
- `branch_id`
- `business_date`
- `shift_id`
- `occurred_at`
- `entry_type`
- `from_account_id`
- `to_account_id`
- `amount`
- `source_type`
- `source_id`
- `counterparty_type`
- `counterparty_id`
- `reference`
- `notes`
- `status`
- `reversal_of_entry_id`
- `created_by`
- `created_at`

Every money movement becomes ledger entries:

- Cash order payment: Customer Receivable/Revenue to Counter Cash
- Online order payment: Customer Receivable/Revenue to Online
- Unpaid order: Customer Receivable increases
- Later customer payment: Customer Receivable decreases, Cash/Online increases
- Paid expense from counter: Counter Cash decreases, Expense increases
- Paid expense from online: Online decreases, Expense increases
- Expense paid from pocket: Owner Payable increases, Expense increases
- Supplier credit purchase: Inventory Asset increases, Supplier Payable increases
- Paid purchase: Cash/Online decreases, Inventory Asset increases
- Counter to online transfer: Counter Cash decreases, Online increases
- Owner took money: Counter Cash decreases, Owner Drawings/Payable changes
- Correction: creates a visible correction entry with reason

## Shift Control

Business day should follow the branch shift time, not midnight.

Opening shift:

- Required: opening counter cash
- Optional: opening online balance can be set later
- Record who opened it and when

During shift:

- Orders, payments, expenses, purchases, transfers, and supplier payments attach to the active shift where possible.
- If no shift is open after business start time, operations should ask to open the shift before money-sensitive work.

Closing shift:

- System calculates expected cash and online.
- User enters actual counted cash and online.
- System records differences separately.
- Old unclosed shifts remain visible and are not counted as today.

## Validation Rules

Before saving paid expenses, paid purchases, supplier payments, refunds, or transfers:

- If source is Counter Cash or Online, check current available balance.
- If amount is greater than available balance, block the save.
- Offer safe alternatives: Owner Pocket, Backup Fund, Supplier Credit, or record as Due.
- All writes should run inside database/server transactions.

## Dashboard KPIs

Top finance KPIs should include:

- Cash in counter
- Online balance
- Total receivable: money we need to collect
- Pending unpaid orders
- Total payable: money we need to pay
- Supplier dues
- Staff advances / salary due
- Owner pocket payable or withdrawal
- Today revenue
- Today expenses
- Today purchases
- Expected closing difference

Each KPI should be clickable and show the records behind the number.

## Recovery and Settlement

Common actions should be simple:

- Customer paid old due
- Supplier paid
- Owner added pocket cash
- Owner/staff took cash
- Counter cash moved to online
- Online withdrawn to counter
- Expense paid on credit
- Expense corrected
- Payment refunded
- Wrong source fixed through reversal and replacement

Every recovery action needs:

- Amount
- Account/source
- Person or supplier if relevant
- Reason/note
- Created by
- Date/shift

## Implementation Phases

Phase 1: Guardrails and visibility

- Add current-balance calculation by finance account.
- Show cash, online, receivable, payable KPIs at top of Finance.
- Block paid expenses/transfers/purchases when cash or online balance is insufficient.
- Add clearer alternatives: Due, Owner Pocket, Backup Fund, Supplier Credit.
- Keep current tables working while validating writes through server functions.

Phase 2: Ledger foundation

- Add append-only `finance_ledger_entries`.
- Backfill ledger entries from current payments, expenses, purchases, supplier entries, and transfers.
- Move all finance writes behind RPC/server functions.
- Add reversal/correction flow.

Phase 3: Full accountant workflow

- Add payable and receivable work queues.
- Add supplier/customer/staff settlement screens.
- Add shift enforcement across POS, Orders, Finance, and Inventory.
- Add finance report PDF and WhatsApp owner summary.

Phase 4: Serious reports

- Profit and loss
- Cash flow statement
- Receivables aging
- Payables aging
- Supplier ledger
- Staff salary/advance ledger
- Dish profitability
- Inventory variance and waste report

## Production Safety

Do not replace the current finance behavior in one large release. Build the ledger alongside the existing tables, compare both for a few days, then make the ledger the primary source after numbers match.
