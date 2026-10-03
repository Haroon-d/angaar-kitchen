import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pgPool } from "@/db/client.server";
import { passwordCredentials } from "@/db/schema";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { ADMIN_ROLES, MANAGER_ROLES, requireBranchRole } from "@/services/authorization.service.server";
import { verifyPassword } from "@/services/auth.service.server";
import { getLiveFinanceAccountBalance } from "@/lib/postgres-data.functions";

const BranchInput = z.object({ branchId: z.string().uuid() });
const PasswordInput = BranchInput.extend({ password: z.string().min(1).max(128) });
const EntryInput = BranchInput.extend({
  direction: z.enum(["deposit", "withdrawal"]),
  amount: z.number().finite().positive().max(1_000_000_000),
  notes: z.string().trim().min(2).max(500),
  sourceAccountId: z.string().uuid().optional(),
  password: z.string().max(128).optional(),
}).superRefine((input, context) => {
  if (input.direction === "withdrawal" && !input.password) {
    context.addIssue({ code: "custom", message: "Password is required for withdrawals." });
  }
  if (input.direction === "deposit" && !input.sourceAccountId) {
    context.addIssue({ code: "custom", message: "Choose the account to move money from." });
  }
});

export const getFinanceReservePostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => BranchInput.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const access = await requireBranchRole(auth.userId, data.branchId, MANAGER_ROLES);
    const account = await ensureReserveAccount(data.branchId, access.branch.restaurantId);
    return { accountId: account.id, name: account.name };
  });

export const revealFinanceReservePostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => PasswordInput.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const access = await requireBranchRole(auth.userId, data.branchId, MANAGER_ROLES);
    await assertPassword(auth.userId, data.password);
    const account = await ensureReserveAccount(data.branchId, access.branch.restaurantId);
    const client = await pgPool.connect();
    try {
      const balance = await getLiveFinanceAccountBalance(client, data.branchId, account.id);
      return { balance };
    } finally {
      client.release();
    }
  });

export const recordFinanceReserveEntryPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => EntryInput.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const access = await requireBranchRole(
      auth.userId,
      data.branchId,
      data.direction === "withdrawal" ? ADMIN_ROLES : MANAGER_ROLES,
    );
    if (data.direction === "withdrawal") {
      await assertPassword(auth.userId, data.password ?? "");
    }

    const account = await ensureReserveAccount(data.branchId, access.branch.restaurantId);
    const client = await pgPool.connect();
    try {
      await client.query("begin");
      const accountIds = [account.id, data.sourceAccountId].filter(Boolean).sort();
      const lockedAccounts = await client.query<{ id: string }>(
        `select id from finance_accounts where id = any($1::uuid[]) order by id for update`,
        [accountIds],
      );
      if (lockedAccounts.rowCount !== accountIds.length) {
        throw new Error("The selected finance account is unavailable.");
      }

      const balance = await getLiveFinanceAccountBalance(client, data.branchId, account.id);
      if (data.direction === "withdrawal" && data.amount > balance) {
        throw new Error("Withdrawal exceeds the available reserve balance.");
      }

      if (data.direction === "deposit") {
        const sourceId = data.sourceAccountId!;
        const sourceResult = await client.query<{ id: string }>(
          `select id from finance_accounts
          where id = $1 and branch_id = $2 and is_active = true and is_reserve = false`,
          [sourceId, data.branchId],
        );
        if (!sourceResult.rowCount) {
          throw new Error("Choose an active non-reserve account in this branch.");
        }
        const sourceBalance = await getLiveFinanceAccountBalance(client, data.branchId, sourceId);
        if (data.amount > sourceBalance + 0.001) {
          throw new Error("The selected account does not have enough available money.");
        }
        await client.query(
          `insert into finance_transfers (
            restaurant_id, branch_id, title, transfer_type,
            from_account_id, to_account_id, amount, notes, created_by
          ) values ($1, $2, 'Profit reserve deposit', 'internal_transfer', $3, $4, $5, $6, $7)`,
          [
            access.branch.restaurantId,
            data.branchId,
            sourceId,
            account.id,
            data.amount.toFixed(2),
            data.notes,
            auth.userId,
          ],
        );
      } else {
        await client.query(
          `insert into operational_expenses (
            branch_id, expense_date, title, finance_account_id,
            status, amount, notes, created_by
          )
          select
            b.id,
            case
              when (now() at time zone 'Asia/Karachi')::time < b.business_day_start_time
                then (now() at time zone 'Asia/Karachi')::date - 1
              else (now() at time zone 'Asia/Karachi')::date
            end,
            $2, $3, 'paid', $4, 'Paid from profit reserve', $5
          from branches b where b.id = $1`,
          [data.branchId, data.notes, account.id, data.amount.toFixed(2), auth.userId],
        );
      }
      await client.query("commit");
      return data.direction === "withdrawal"
        ? { balance: balance - data.amount }
        : { ok: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });

async function ensureReserveAccount(branchId: string, restaurantId: string) {
  const existing = await pgPool.query<{ id: string; name: string }>(
    `select id, name from finance_accounts where branch_id = $1 and is_reserve = true limit 1`,
    [branchId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const nameResult = await pgPool.query<{ name: string }>(
    `select case
      when exists (
        select 1 from finance_accounts where branch_id = $1 and name = 'Profit Reserve'
      ) then 'Profit Reserve (' || left($1::text, 8) || ')'
      else 'Profit Reserve'
    end as name`,
    [branchId],
  );
  await pgPool.query(
    `insert into finance_accounts (
      restaurant_id, branch_id, name, account_type, is_cash, is_reserve, is_active, sort_order
    ) values ($1, $2, $3, 'other', false, true, true, 5)
    on conflict do nothing`,
    [restaurantId, branchId, nameResult.rows[0].name],
  );
  const result = await pgPool.query<{ id: string; name: string }>(
    `select id, name from finance_accounts where branch_id = $1 and is_reserve = true limit 1`,
    [branchId],
  );
  if (!result.rows[0]) {
    throw new Error("Could not find the protected reserve account. Check the finance account names for this branch.");
  }
  return result.rows[0];
}

async function assertPassword(userId: string, password: string) {
  const [credential] = await db
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, userId))
    .limit(1);
  if (!credential || !(await verifyPassword(password, credential.passwordHash))) {
    throw new Error("Password verification failed.");
  }
}

function requireAuthContext(context: unknown): { userId: string } {
  if (!context || typeof context !== "object" || !("userId" in context)) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return context as { userId: string };
}