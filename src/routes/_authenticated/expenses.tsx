import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef, FormEvent, ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Banknote,
  Calendar,
  ClipboardCheck,
  FileText,
  HandCoins,
  Loader2,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
  Tags,
  Trash2,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { isManager, useMyRoles } from "@/hooks/use-auth";
import {
  businessDateInputValue,
  businessDateRangeUtcBounds,
  formatDate,
  formatMoney,
  pakistanDateInputValue,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/expenses")({ component: ExpensesPage });

type ExpenseStatus = "due" | "paid" | "void";
type PaymentMethod = "cash" | "card" | "upi" | "wallet" | "other";

type DbError = { message: string };
type DbResult<T = unknown> = { data: T | null; error: DbError | null };
type DbQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select(columns?: string): DbQuery<T>;
  insert(values: unknown): DbQuery<unknown>;
  update(values: unknown): DbQuery<unknown>;
  delete(): DbQuery<unknown>;
  eq(column: string, value: unknown): DbQuery<T>;
  gte(column: string, value: unknown): DbQuery<T>;
  lte(column: string, value: unknown): DbQuery<T>;
  lt(column: string, value: unknown): DbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>;
};
type DbClient = { from(table: string): DbQuery };

const db = supabase as unknown as DbClient;

type ExpenseCategory = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type FinanceAccount = {
  id: string;
  name: string;
  account_type: "counter_cash" | "online" | "bank" | "wallet" | "other";
  is_cash: boolean;
  is_active: boolean;
  sort_order: number;
};

type FinanceMovement = {
  id: string;
  branch_id: string;
  occurred_at: string;
  finance_account_id: string | null;
  account_name: string;
  account_type: string;
  is_cash: boolean;
  movement_type:
    | "order_payment"
    | "expense"
    | "purchase_payment"
    | "supplier_payment"
    | "transfer_in"
    | "transfer_out";
  title: string;
  payment_method: string | null;
  payment_kind: string | null;
  amount: number | string;
  reference: string | null;
};

type FinanceTransferType =
  | "internal_transfer"
  | "owner_contribution"
  | "owner_withdrawal"
  | "cash_deposit"
  | "cash_withdrawal"
  | "credit_given"
  | "credit_collected"
  | "correction";

type FinanceDayClosure = {
  id: string;
  branch_id: string;
  business_date: string;
  opening_cash: number | string;
  opening_online: number | string;
  expected_cash: number | string;
  expected_online: number | string;
  actual_cash: number | string | null;
  actual_online: number | string | null;
  cash_difference: number | string;
  online_difference: number | string;
  notes: string | null;
  closed_at: string | null;
};

type FinanceSourceRow = {
  key: string;
  name: string;
  accountType: string;
  isCash: boolean;
  collected: number;
  expenses: number;
  purchases: number;
  refunds: number;
  transferIn: number;
  transferOut: number;
  net: number;
};

type FinanceAccountBalanceMap = Record<string, number>;

type FinanceAccountPosition = {
  account_id: string;
  branch_id: string;
  name: string;
  account_type: FinanceAccount["account_type"];
  is_cash: boolean;
  is_active: boolean;
  business_date: string;
  all_time_movement: number | string;
  current_shift_movement: number | string;
  balance: number | string;
};

type FinanceObligation = {
  id: string;
  branch_id: string;
  obligation_type: "receivable" | "payable";
  source_type: "order" | "expense" | "supplier" | "credit";
  source_id: string;
  counterparty_name: string;
  reference: string | null;
  amount: number | string;
  status: string;
  occurred_at: string;
  notes: string | null;
  expense?: Expense;
};

type Expense = {
  id: string;
  branch_id: string;
  category_id: string | null;
  expense_date: string | Date;
  title: string;
  vendor: string | null;
  reference_no: string | null;
  payment_method: PaymentMethod | null;
  finance_account_id: string | null;
  status: ExpenseStatus;
  amount: number | string;
  notes: string | null;
  recurring_expense_id?: string | null;
  recurring_for_date?: string | Date | null;
  operational_expense_categories?: { name: string } | null;
};

type RecurringFrequency = "daily" | "weekly" | "monthly";

type RecurringExpense = {
  id: string;
  branch_id: string;
  category_id: string | null;
  title: string;
  vendor: string | null;
  amount: number | string;
  frequency: RecurringFrequency;
  start_date: string | Date;
  end_date: string | Date | null;
  day_of_week: number | null;
  day_of_month: number | null;
  is_active: boolean;
  last_generated_date: string | Date | null;
  notes: string | null;
};

type ExpenseFormState = {
  title: string;
  category_id: string;
  expense_date: string;
  vendor: string;
  reference_no: string;
  payment_method: PaymentMethod | "none";
  finance_account_id: string;
  status: ExpenseStatus;
  amount: string;
  notes: string;
};

type OpenMoneyGroup = {
  id: string;
  obligation_type: FinanceObligation["obligation_type"];
  source_type: FinanceObligation["source_type"];
  counterparty_name: string;
  reference: string | null;
  amount: number;
  count: number;
  latestAt: string;
  obligations: FinanceObligation[];
};

const CategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional().nullable(),
  is_active: z.boolean(),
});

const FinanceAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  account_type: z.enum(["counter_cash", "online", "bank", "wallet", "other"]),
  is_cash: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(999),
});

const FinanceTransferSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    transfer_type: z.enum([
      "internal_transfer",
      "owner_contribution",
      "owner_withdrawal",
      "cash_deposit",
      "cash_withdrawal",
      "credit_given",
      "credit_collected",
      "correction",
    ]),
    occurred_at: z.string().min(1),
    from_account_id: z.string().uuid().nullable(),
    to_account_id: z.string().uuid().nullable(),
    amount: z.number().positive(),
    reference: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .refine((value) => value.from_account_id || value.to_account_id, {
    message: "Select at least one source.",
    path: ["from_account_id"],
  })
  .refine((value) => value.transfer_type !== "credit_given" || value.from_account_id, {
    message: "Select where the credit money was paid from.",
    path: ["from_account_id"],
  })
  .refine((value) => value.transfer_type !== "credit_collected" || value.to_account_id, {
    message: "Select where the collected credit money arrived.",
    path: ["to_account_id"],
  })
  .refine((value) => value.from_account_id !== value.to_account_id, {
    message: "From and To cannot be the same source.",
    path: ["to_account_id"],
  });

const ExpenseSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    category_id: z.string().uuid().nullable(),
    expense_date: z.string().min(1),
    vendor: z.string().trim().max(120).optional().nullable(),
    reference_no: z.string().trim().max(120).optional().nullable(),
    payment_method: z.enum(["cash", "card", "upi", "wallet", "other"]).nullable(),
    finance_account_id: z.string().uuid().nullable(),
    status: z.enum(["due", "paid", "void"]),
    amount: z.number().min(0),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== "paid") return;
    if (!value.payment_method) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select payment type for a paid expense.",
        path: ["payment_method"],
      });
    }
    if (!value.finance_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select where this paid expense was paid from.",
        path: ["finance_account_id"],
      });
    }
  });

const RecurringExpenseSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    category_id: z.string().uuid().nullable(),
    vendor: z.string().trim().max(120).optional().nullable(),
    amount: z.number().positive(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    start_date: z.string().min(1),
    end_date: z.string().optional().nullable(),
    day_of_week: z.number().int().min(0).max(6).nullable(),
    day_of_month: z.number().int().min(1).max(31).nullable(),
    is_active: z.boolean(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.end_date && value.end_date < value.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before start date.",
        path: ["end_date"],
      });
    }
  });

function sourceTypeLabel(type: FinanceAccount["account_type"] | string) {
  switch (type) {
    case "counter_cash":
      return "Counter cash";
    case "online":
      return "Online";
    case "bank":
      return "Bank";
    case "wallet":
      return "Wallet";
    default:
      return "Other";
  }
}

const ONLINE_FINANCE_ACCOUNT_TYPES = new Set(["online", "bank", "wallet"]);

function isCashFinanceSource(
  accountType: string | null | undefined,
  isCash: boolean | null | undefined,
) {
  return Boolean(isCash) || accountType === "counter_cash";
}

function isOnlineFinanceSource(
  accountType: string | null | undefined,
  isCash: boolean | null | undefined,
) {
  return !isCashFinanceSource(accountType, isCash) && ONLINE_FINANCE_ACCOUNT_TYPES.has(accountType ?? "");
}

function financeSourceBucket(
  accountType: string | null | undefined,
  isCash: boolean | null | undefined,
) {
  if (isCashFinanceSource(accountType, isCash)) return "cash";
  if (isOnlineFinanceSource(accountType, isCash)) return "online";
  return "other";
}

function fallbackAccountTypeForBucket(bucket: "cash" | "online" | "other") {
  if (bucket === "cash") return "counter_cash";
  if (bucket === "online") return "online";
  return "other";
}

function isCashMovement(movement: FinanceMovement) {
  return isCashFinanceSource(movement.account_type, movement.is_cash);
}

function isOnlineMovement(movement: FinanceMovement) {
  return isOnlineFinanceSource(movement.account_type, movement.is_cash);
}

function isCashPosition(position: FinanceAccountPosition) {
  return isCashFinanceSource(position.account_type, position.is_cash);
}

function isOnlinePosition(position: FinanceAccountPosition) {
  return isOnlineFinanceSource(position.account_type, position.is_cash);
}

function movementTypeLabel(type: FinanceMovement["movement_type"] | string) {
  switch (type) {
    case "order_payment":
      return "Order payment";
    case "expense":
      return "Expense";
    case "purchase_payment":
      return "Purchase";
    case "supplier_payment":
      return "Supplier payment";
    case "transfer_in":
      return "Transfer in";
    case "transfer_out":
      return "Transfer out";
    default:
      return "Movement";
  }
}

function financeMovementDisplayLabel(movement: FinanceMovement) {
  switch (movement.payment_kind) {
    case "credit_given":
      return "Credit given";
    case "credit_collected":
      return "Credit collected";
    default:
      return movementTypeLabel(movement.movement_type);
  }
}

function buildFinanceSourceRows(
  accounts: FinanceAccount[],
  movements: FinanceMovement[],
): FinanceSourceRow[] {
  const rows = new Map<string, FinanceSourceRow>();

  const ensureRow = (key: string, name: string, accountType: string, isCash: boolean) => {
    const existing = rows.get(key);
    if (existing) return existing;
    const row = {
      key,
      name,
      accountType,
      isCash,
      collected: 0,
      expenses: 0,
      purchases: 0,
      refunds: 0,
      transferIn: 0,
      transferOut: 0,
      net: 0,
    };
    rows.set(key, row);
    return row;
  };

  accounts
    .filter((account) => account.is_active)
    .forEach((account) => {
      ensureRow(account.id, account.name, account.account_type, account.is_cash);
    });

  movements.forEach((movement) => {
    const bucket = financeSourceBucket(movement.account_type, movement.is_cash);
    const key =
      movement.finance_account_id ??
      `${movement.account_name || "Unknown source"}-${bucket}`;
    const row = ensureRow(
      key,
      movement.account_name || "Unknown source",
      movement.account_type || fallbackAccountTypeForBucket(bucket),
      bucket === "cash",
    );
    const amount = Number(movement.amount || 0);
    row.net += amount;
    if (movement.movement_type === "expense") {
      row.expenses += Math.abs(amount);
    } else if (
      movement.movement_type === "purchase_payment" ||
      movement.movement_type === "supplier_payment"
    ) {
      row.purchases += Math.abs(amount);
    } else if (movement.movement_type === "transfer_in") {
      row.transferIn += Math.abs(amount);
    } else if (movement.movement_type === "transfer_out") {
      row.transferOut += Math.abs(amount);
    } else if (amount < 0) {
      row.refunds += Math.abs(amount);
    } else {
      row.collected += amount;
    }
  });

  return [...rows.values()]
    .filter(
      (row) =>
        row.collected ||
        row.expenses ||
        row.purchases ||
        row.refunds ||
        row.transferIn ||
        row.transferOut ||
        row.net,
    )
    .sort((a, b) => Number(b.isCash) - Number(a.isCash) || a.name.localeCompare(b.name));
}

function buildCurrentAccountBalances(positions: FinanceAccountPosition[]): FinanceAccountBalanceMap {
  const balances: FinanceAccountBalanceMap = {};
  positions.forEach((position) => {
    balances[position.account_id] = Number(position.balance || 0);
  });
  return balances;
}

function accountRequiresBalance(account: FinanceAccount | undefined) {
  return Boolean(
    account && ["counter_cash", "online", "bank", "wallet"].includes(account.account_type),
  );
}

function normalizeMoneyName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function openMoneyGroupKey(obligation: FinanceObligation) {
  const nameKey = normalizeMoneyName(obligation.counterparty_name) || "unknown";
  return `${obligation.obligation_type}:${obligation.source_type}:${nameKey}`;
}

function groupOpenMoneyRecords(obligations: FinanceObligation[]): OpenMoneyGroup[] {
  const groups = new Map<string, OpenMoneyGroup>();

  for (const obligation of obligations) {
    const key = openMoneyGroupKey(obligation);
    const amount = Number(obligation.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.amount += amount;
      existing.count += 1;
      existing.obligations.push(obligation);
      if (new Date(obligation.occurred_at).getTime() > new Date(existing.latestAt).getTime()) {
        existing.latestAt = obligation.occurred_at;
      }
      continue;
    }
    groups.set(key, {
      id: key,
      obligation_type: obligation.obligation_type,
      source_type: obligation.source_type,
      counterparty_name: obligation.counterparty_name,
      reference: obligation.reference,
      amount,
      count: 1,
      latestAt: obligation.occurred_at,
      obligations: [obligation],
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      b.amount - a.amount ||
      new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime() ||
      a.counterparty_name.localeCompare(b.counterparty_name),
  );
}

function ExpensesPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const manager = isManager(roles);

  if (!branch || !restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;
  }

  return (
    <ExpensesWorkspace
      branchId={branch.id}
      restaurantId={restaurant.id}
      businessDayStart={(
        (branch as { business_day_start_time?: string }).business_day_start_time ?? "10:00"
      ).slice(0, 5)}
      financeCutoverAt={(branch as { finance_cutover_at?: string | null }).finance_cutover_at ?? null}
      branchName={branch.name}
      ownerWhatsAppPhone={branch.phone ?? restaurant.phone ?? "0335 7200955"}
      manager={manager}
      symbol={restaurant.currency_symbol}
    />
  );
}

function ExpensesWorkspace({
  branchId,
  restaurantId,
  businessDayStart,
  financeCutoverAt,
  branchName,
  ownerWhatsAppPhone,
  manager,
  symbol,
}: {
  branchId: string;
  restaurantId: string;
  businessDayStart: string;
  financeCutoverAt: string | null;
  branchName: string;
  ownerWhatsAppPhone: string;
  manager: boolean;
  symbol: string;
}) {
  const todayValue = businessDateInputValue(businessDayStart);
  const [startDate, setStartDate] = useState(todayValue);
  const [endDate, setEndDate] = useState(todayValue);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [printingReport, setPrintingReport] = useState(false);
  const [syncingRecurring, setSyncingRecurring] = useState(false);
  const [recurringSyncKey, setRecurringSyncKey] = useState("");

  const categoriesQ = useExpenseCategories(branchId);
  const recurringQ = useRecurringExpenses(branchId);
  const accountsQ = useFinanceAccounts(branchId);
  const movementsQ = useFinanceMovements(branchId, startDate, endDate, businessDayStart);
  const closureQ = useFinanceDayClosure(branchId, startDate, startDate === endDate);
  const positionsQ = useFinanceAccountPositions(branchId);
  const obligationsQ = useFinanceObligations(branchId);
  const dueExpensesQ = useDueExpenseObligations(branchId, financeCutoverAt);
  const expensesQ = useQuery({
    queryKey: ["operational-expenses", branchId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await db
        .from("operational_expenses")
        .select("*, operational_expense_categories(name)")
        .eq("branch_id", branchId)
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Expense[];
    },
  });

  const expenses = useMemo(() => expensesQ.data ?? [], [expensesQ.data]);
  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const positions = useMemo(() => positionsQ.data ?? [], [positionsQ.data]);
  const obligations = useMemo(
    () => mergeFinanceObligations(obligationsQ.data ?? [], dueExpensesQ.data ?? []),
    [dueExpensesQ.data, obligationsQ.data],
  );
  const currentAccountBalances = useMemo(
    () => buildCurrentAccountBalances(positions),
    [positions],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const visibleExpenses = useMemo(() => {
    const s = search.trim().toLowerCase();
    return expenses.filter(
      (e) =>
        (categoryFilter === "all" || (e.category_id ?? "none") === categoryFilter) &&
        (sourceFilter === "all" || (e.finance_account_id ?? "none") === sourceFilter) &&
        (methodFilter === "all" || (e.payment_method ?? "none") === methodFilter) &&
        (statusFilter === "all" || e.status === statusFilter) &&
        (!s ||
          [
            e.title,
            e.vendor,
            e.reference_no,
            e.operational_expense_categories?.name,
            e.finance_account_id ? accountById.get(e.finance_account_id)?.name : null,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(s))),
    );
  }, [accountById, categoryFilter, expenses, methodFilter, search, sourceFilter, statusFilter]);
  const financeProofMovements = useMemo(() => {
    const rows = [...(movementsQ.data ?? [])];
    const existingExpenseIds = new Set(
      rows
        .filter((movement) => movement.movement_type === "expense")
        .map((movement) => movement.id),
    );

    for (const expense of expenses) {
      if (expense.status !== "paid" || existingExpenseIds.has(expense.id)) continue;
      const account = expense.finance_account_id ? accountById.get(expense.finance_account_id) : null;
      rows.push(
        expenseToFinanceMovement(
          expense,
          account?.name ?? (expense.finance_account_id ? null : "External / old sale / pocket"),
          account,
        ),
      );
    }

    return rows.sort(
      (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
    );
  }, [accountById, expenses, movementsQ.data]);

  const activeExpenses = expenses.filter((e) => e.status !== "void");
  const total = activeExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const paid = activeExpenses
    .filter((e) => e.status === "paid")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const due = activeExpenses
    .filter((e) => e.status === "due")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const cashPosition = positions
    .filter(isCashPosition)
    .reduce((sum, position) => sum + Number(position.balance || 0), 0);
  const onlinePosition = positions
    .filter(isOnlinePosition)
    .reduce((sum, position) => sum + Number(position.balance || 0), 0);
  const receivableTotal = obligations
    .filter((obligation) => obligation.obligation_type === "receivable")
    .reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);
  const payableTotal = obligations
    .filter((obligation) => obligation.obligation_type === "payable")
    .reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);

  const syncRecurringExpenses = useCallback(async (showToast: boolean) => {
    if (!manager || !recurringQ.data?.length) return 0;
    setSyncingRecurring(true);
    try {
      const created = await materializeRecurringExpensesForDate({
        branchId,
        businessDate: todayValue,
        templates: recurringQ.data,
      });
      if (created > 0) {
        await Promise.all([
          expensesQ.refetch(),
          dueExpensesQ.refetch(),
          obligationsQ.refetch(),
          recurringQ.refetch(),
        ]);
        if (showToast) {
          toast.success(`${created} fixed expense${created === 1 ? "" : "s"} added as due`);
        }
      } else if (showToast) {
        toast.success("Fixed expenses are already up to date");
      }
      return created;
    } catch (error) {
      if (showToast) {
        toast.error(error instanceof Error ? error.message : "Could not create fixed expenses");
      }
      return 0;
    } finally {
      setSyncingRecurring(false);
    }
  }, [branchId, dueExpensesQ, expensesQ, manager, obligationsQ, recurringQ, todayValue]);

  useEffect(() => {
    const activeCount = (recurringQ.data ?? []).filter((template) => template.is_active).length;
    const key = `${branchId}:${todayValue}:${activeCount}`;
    if (!manager || recurringQ.isLoading || activeCount === 0 || recurringSyncKey === key) return;
    setRecurringSyncKey(key);
    void syncRecurringExpenses(false);
  }, [
    branchId,
    manager,
    recurringQ.data,
    recurringQ.isLoading,
    recurringSyncKey,
    syncRecurringExpenses,
    todayValue,
  ]);

  async function refreshFinanceTruth() {
    await syncRecurringExpenses(false);
    await Promise.all([
      positionsQ.refetch(),
      obligationsQ.refetch(),
      dueExpensesQ.refetch(),
      movementsQ.refetch(),
      closureQ.refetch(),
      expensesQ.refetch(),
      accountsQ.refetch(),
      recurringQ.refetch(),
    ]);
    toast.success("Finance position refreshed");
  }

  async function printFinanceReport() {
    setPrintingReport(true);
    try {
      const [
        latestAccounts,
        latestMovements,
        latestClosure,
        latestPositions,
        latestObligations,
        latestDueExpenseObligations,
      ] = await Promise.all([
        accountsQ.refetch(),
        movementsQ.refetch(),
        startDate === endDate ? closureQ.refetch() : Promise.resolve({ data: null }),
        positionsQ.refetch(),
        obligationsQ.refetch(),
        dueExpensesQ.refetch(),
      ]);

      openFinanceControlReport({
        branchName,
        businessDayStart,
        startDate,
        endDate,
        symbol,
        accounts: latestAccounts.data ?? accounts,
        movements: latestMovements.data ?? movementsQ.data ?? [],
        closure: latestClosure.data ?? null,
        positions: latestPositions.data ?? positions,
        obligations: mergeFinanceObligations(
          latestObligations.data ?? obligationsQ.data ?? [],
          latestDueExpenseObligations.data ?? dueExpensesQ.data ?? [],
        ),
        ownerWhatsAppPhone,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare finance report");
    } finally {
      setPrintingReport(false);
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Finance control</h1>
          <p className="text-sm text-muted-foreground">
            Fast daily money control for purchases, expenses, transfers, shift closing, and owner
            reporting.
          </p>
        </div>
        {manager && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={printFinanceReport} disabled={printingReport}>
              {printingReport ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Finance PDF report
            </Button>
          </div>
        )}
      </div>

      {manager && (
        <FinancePositionOverview
          positions={positions}
          obligations={obligations}
          accounts={accounts}
          accountBalances={currentAccountBalances}
          businessDayStart={businessDayStart}
          cashPosition={cashPosition}
          onlinePosition={onlinePosition}
          receivableTotal={receivableTotal}
          payableTotal={payableTotal}
          symbol={symbol}
          loading={positionsQ.isLoading || obligationsQ.isLoading || dueExpensesQ.isLoading}
          onRefresh={refreshFinanceTruth}
        />
      )}

      {manager && (
        <FinanceActionCenter
          branchId={branchId}
          restaurantId={restaurantId}
          categories={categoriesQ.data ?? []}
          accounts={accounts}
          accountBalances={currentAccountBalances}
          businessDayStart={businessDayStart}
          symbol={symbol}
          printingReport={printingReport}
          onPrintReport={printFinanceReport}
        />
      )}

      {manager && (
        <RecurringExpensesPanel
          branchId={branchId}
          categories={categoriesQ.data ?? []}
          recurringExpenses={recurringQ.data ?? []}
          todayValue={todayValue}
          syncing={syncingRecurring}
          symbol={symbol}
          onGenerateToday={() => void syncRecurringExpenses(true)}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Banknote} label="Selected period cost" value={formatMoney(total, symbol)} />
        <Stat icon={ReceiptText} label="Already paid" value={formatMoney(paid, symbol)} />
        <Stat
          icon={Calendar}
          label="Still payable"
          value={formatMoney(due, symbol)}
          highlight={due > 0}
        />
      </div>

      <DayEndPanel
        branchId={branchId}
        date={startDate}
        enabled={startDate === endDate}
        closure={closureQ.data ?? null}
        accounts={accounts}
        movements={movementsQ.data ?? []}
        cashPosition={cashPosition}
        onlinePosition={onlinePosition}
        businessDayStart={businessDayStart}
        symbol={symbol}
        onSaved={() => {
          void Promise.all([
            expensesQ.refetch(),
            movementsQ.refetch(),
            closureQ.refetch(),
            accountsQ.refetch(),
            positionsQ.refetch(),
            obligationsQ.refetch(),
          ]);
        }}
        onRefresh={async () => {
          await Promise.all([
            expensesQ.refetch(),
            movementsQ.refetch(),
            closureQ.refetch(),
            accountsQ.refetch(),
            positionsQ.refetch(),
            obligationsQ.refetch(),
          ]);
        }}
      />

      <Card className="bg-card/64">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <DateInput label="From" value={startDate} max={endDate} onChange={setStartDate} />
            <DateInput label="To" value={endDate} min={startDate} onChange={setEndDate} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const dateStr = businessDateInputValue(businessDayStart);
                setStartDate(dateStr);
                setEndDate(dateStr);
                setCategoryFilter("all");
                setSourceFilter("all");
                setMethodFilter("all");
                setStatusFilter("all");
                setSearch("");
              }}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Today
            </Button>
          </div>
        </CardContent>
      </Card>

      {manager && (
        <FinanceMovementProofPanel
          movements={financeProofMovements}
          branchName={branchName}
          symbol={symbol}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Expense records</CardTitle>
              <CardDescription>
                Use this only for real costs like gas, rent, repair, salary, packaging, and bills.
                Money moved between accounts goes through the transfer button.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search costs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter}>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="none">Uncategorized</SelectItem>
                {(categoriesQ.data ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter}>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="none">Not set</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </FilterSelect>
              <FilterSelect label="Payment" value={methodFilter} onChange={setMethodFilter}>
                <SelectItem value="all">All payments</SelectItem>
                <SelectItem value="none">Not set</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="wallet">Wallet</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </FilterSelect>
              <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="due">Due</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </FilterSelect>
            </div>
            {expensesQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">Date</th>
                      <th className="pr-4">Expense</th>
                      <th className="pr-4">Category</th>
                      <th className="pr-4">Source</th>
                      <th className="pr-4">Status</th>
                      <th className="pr-4">Reference</th>
                      <th className="text-right">Amount</th>
                      {manager && <th className="text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExpenses.map((expense) => (
                      <ExpenseRow
                        key={expense.id}
                        expense={expense}
                        branchId={branchId}
                        categories={categoriesQ.data ?? []}
                        accounts={accounts}
                        accountBalances={currentAccountBalances}
                        businessDayStart={businessDayStart}
                        accountName={
                          expense.finance_account_id
                            ? accountById.get(expense.finance_account_id)?.name
                            : null
                        }
                        account={
                          expense.finance_account_id ? accountById.get(expense.finance_account_id) : null
                        }
                        branchName={branchName}
                        manager={manager}
                        symbol={symbol}
                      />
                    ))}
                    {visibleExpenses.length === 0 && (
                      <tr>
                        <td
                          colSpan={manager ? 8 : 7}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No operational expenses in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <CategoriesPanel
            branchId={branchId}
            manager={manager}
            categories={categoriesQ.data ?? []}
          />
          <FinanceSourcesPanel
            branchId={branchId}
            restaurantId={restaurantId}
            manager={manager}
            accounts={accounts}
          />
        </div>
      </div>
    </div>
  );
}

function FinancePositionOverview({
  positions,
  obligations,
  accounts,
  accountBalances,
  businessDayStart,
  cashPosition,
  onlinePosition,
  receivableTotal,
  payableTotal,
  symbol,
  loading,
  onRefresh,
}: {
  positions: FinanceAccountPosition[];
  obligations: FinanceObligation[];
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  cashPosition: number;
  onlinePosition: number;
  receivableTotal: number;
  payableTotal: number;
  symbol: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [recordsLimit, setRecordsLimit] = useState(20);
  const groupedRecords = useMemo(
    () => groupOpenMoneyRecords(obligations),
    [obligations],
  );
  const visibleOpenRecords = groupedRecords.slice(0, recordsLimit);
  const remainingOpenRecords = Math.max(0, groupedRecords.length - visibleOpenRecords.length);
  const totalAvailable = cashPosition + onlinePosition;
  const receivableRecords = obligations.filter(
    (obligation) => obligation.obligation_type === "receivable",
  );
  const payableRecords = obligations.filter(
    (obligation) => obligation.obligation_type === "payable",
  );
  const pendingOrderRecords = receivableRecords.filter(
    (obligation) => obligation.source_type === "order",
  );
  const pendingOrderTotal = pendingOrderRecords.reduce(
    (sum, obligation) => sum + Number(obligation.amount || 0),
    0,
  );
  const supplierPayableTotal = payableRecords
    .filter((obligation) => obligation.source_type === "supplier")
    .reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);
  const dueExpenseTotal = payableRecords
    .filter((obligation) => obligation.source_type === "expense")
    .reduce((sum, obligation) => sum + Number(obligation.amount || 0), 0);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card className="border-primary/25 bg-card/75">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Money position</CardTitle>
          <CardDescription>
            Current business balances, open collections, and payables from the live records.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Stat icon={Banknote} label="Cash we have" value={formatMoney(cashPosition, symbol)} />
          <Stat
            icon={WalletCards}
            label="Online / bank"
            value={formatMoney(onlinePosition, symbol)}
          />
          <Stat
            icon={Banknote}
            label="Total available"
            value={formatMoney(totalAvailable, symbol)}
          />
          <Stat
            icon={HandCoins}
            label={`Need to collect (${receivableRecords.length})`}
            value={formatMoney(receivableTotal, symbol)}
            highlight={receivableTotal > 0}
          />
          <Stat
            icon={ReceiptText}
            label={`Need to pay (${payableRecords.length})`}
            value={formatMoney(payableTotal, symbol)}
            highlight={payableTotal > 0}
          />
          <Stat
            icon={ClipboardCheck}
            label={`Pending orders (${pendingOrderRecords.length})`}
            value={formatMoney(pendingOrderTotal, symbol)}
            highlight={pendingOrderTotal > 0}
          />
        </div>

        {(supplierPayableTotal > 0 || dueExpenseTotal > 0 || pendingOrderTotal > 0) && (
          <div className="grid gap-3 md:grid-cols-3">
            <ObligationMiniStat
              label="Customer pending payments"
              value={formatMoney(pendingOrderTotal, symbol)}
              count={pendingOrderRecords.length}
            />
            <ObligationMiniStat
              label="Supplier balances"
              value={formatMoney(supplierPayableTotal, symbol)}
              count={
                payableRecords.filter((obligation) => obligation.source_type === "supplier")
                  .length
              }
            />
            <ObligationMiniStat
              label="Due expenses"
              value={formatMoney(dueExpenseTotal, symbol)}
              count={
                payableRecords.filter((obligation) => obligation.source_type === "expense")
                  .length
              }
            />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-xl border border-border bg-background/35 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-medium">Where the money is</p>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {positions.length ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {positions.map((position) => (
                  <div key={position.account_id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{position.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sourceTypeLabel(position.account_type)}
                        </p>
                      </div>
                      {!position.is_active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    <p className="mt-3 font-mono text-xl">
                      {formatMoney(position.balance, symbol)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Shift movement {formatMoney(position.current_shift_movement, symbol)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No finance accounts found. Add counter cash and online/bank sources first.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-background/35 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">Open money records</p>
                <p className="text-xs text-muted-foreground">
                  People to collect from and vendors/suppliers to pay.
                </p>
              </div>
              {groupedRecords.length > 0 && (
                <Badge variant="secondary" className="shrink-0">
                  {visibleOpenRecords.length}/{groupedRecords.length}
                </Badge>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {visibleOpenRecords.length ? (
                visibleOpenRecords.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              record.obligation_type === "receivable"
                                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                : "border-amber-500/35 bg-amber-500/10 text-amber-200"
                            }
                          >
                            {record.obligation_type === "receivable" ? "Collect" : "Pay"}
                          </Badge>
                          <span className="truncate font-medium">
                            {record.counterparty_name}
                          </span>
                          {record.count > 1 && <Badge variant="secondary">{record.count} records</Badge>}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {record.reference || sourceObligationLabel(record.source_type)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <p className="font-mono font-semibold">
                          {formatMoney(record.amount, symbol)}
                        </p>
                        {record.obligation_type === "payable" && record.source_type === "expense" && (
                          <PayExpenseGroupDialog
                            record={record}
                            accounts={accounts}
                            accountBalances={accountBalances}
                            businessDayStart={businessDayStart}
                            symbol={symbol}
                            onPaid={refresh}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Nothing open right now.
                </div>
              )}
              {remainingOpenRecords > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setRecordsLimit((limit) => limit + 20)}
                >
                  Show more records ({remainingOpenRecords} left)
                </Button>
              )}
              {recordsLimit > 20 && visibleOpenRecords.length === groupedRecords.length && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setRecordsLimit(20)}
                >
                  Show less
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ObligationMiniStat({
  label,
  value,
  count,
}: {
  label: string;
  value: string;
  count: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Badge variant="outline">{count}</Badge>
      </div>
      <p className="mt-2 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}

function sourceObligationLabel(type: FinanceObligation["source_type"]) {
  switch (type) {
    case "order":
      return "Pending order payment";
    case "expense":
      return "Due expense";
    case "supplier":
      return "Supplier balance";
    case "credit":
      return "Credit given";
    default:
      return "Open record";
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function appendFinanceNote(existing: string | null | undefined, note: string) {
  const current = existing?.trim();
  return current ? `${current}\n${note}` : note;
}

function PayExpenseGroupDialog({
  record,
  accounts,
  accountBalances,
  businessDayStart,
  symbol,
  onPaid,
}: {
  record: OpenMoneyGroup;
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  symbol: string;
  onPaid: () => Promise<void>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState(String(roundMoney(record.amount)));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [accountId, setAccountId] = useState(defaultAccountId(accounts, "cash"));
  const [reference, setReference] = useState("");
  const dueExpenses = useMemo(
    () =>
      record.obligations
        .map((obligation) => obligation.expense)
        .filter((expense): expense is Expense => Boolean(expense))
        .sort(
          (a, b) =>
            new Date(toDateInputValue(a.expense_date)).getTime() -
            new Date(toDateInputValue(b.expense_date)).getTime(),
        ),
    [record.obligations],
  );

  useEffect(() => {
    if (!open) return;
    setAmount(String(roundMoney(record.amount)));
    setPaymentMethod("cash");
    setAccountId(defaultAccountId(accounts, "cash"));
    setReference("");
  }, [accounts, open, record.amount]);

  async function pay() {
    const value = roundMoney(Number(amount));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a payment amount.");
      return;
    }
    if (value > record.amount + 0.001) {
      toast.error(`Maximum payable amount is ${formatMoney(record.amount, symbol)}.`);
      return;
    }
    if (!dueExpenses.length) {
      toast.error("Could not find the due expense rows for this payable.");
      return;
    }
    const account = accounts.find((item) => item.id === accountId);
    if (!account) {
      toast.error("Select where this payment was paid from.");
      return;
    }
    if (accountRequiresBalance(account)) {
      const currentBalance = accountBalances[account.id];
      if (currentBalance == null) {
        toast.error("Finance balance is still loading. Press Refresh, then try again.");
        return;
      }
      if (value > currentBalance + 0.001) {
        toast.error(
          `${account.name} has ${formatMoney(currentBalance, symbol)} available. Use another source or pay a smaller amount.`,
        );
        return;
      }
    }

    setLoading(true);
    try {
      let remaining = value;
      const paymentDate = businessDateInputValue(businessDayStart);
      for (const expense of dueExpenses) {
        if (remaining <= 0.001) break;
        const dueAmount = roundMoney(Number(expense.amount || 0));
        if (dueAmount <= 0) continue;
        const paidAmount = roundMoney(Math.min(remaining, dueAmount));
        const note = appendFinanceNote(
          expense.notes,
          `Paid ${formatMoney(paidAmount, symbol)} to ${record.counterparty_name} on ${paymentDate}${reference ? ` (${reference})` : ""}.`,
        );

        if (paidAmount >= dueAmount - 0.001) {
          const { error } = await db
            .from("operational_expenses")
            .update({
              status: "paid",
              payment_method: paymentMethod,
              finance_account_id: account.id,
              expense_date: paymentDate,
              reference_no: reference || expense.reference_no,
              notes: note,
            })
            .eq("id", expense.id);
          if (error) throw new Error(error.message);
        } else {
          const remainingDue = roundMoney(dueAmount - paidAmount);
          const { error: updateError } = await db
            .from("operational_expenses")
            .update({
              amount: remainingDue,
              notes: appendFinanceNote(
                expense.notes,
                `Partial payment ${formatMoney(paidAmount, symbol)} recorded on ${paymentDate}; ${formatMoney(remainingDue, symbol)} still due.`,
              ),
            })
            .eq("id", expense.id);
          if (updateError) throw new Error(updateError.message);

          const { error: insertError } = await db.from("operational_expenses").insert({
            branch_id: expense.branch_id,
            category_id: expense.category_id,
            expense_date: paymentDate,
            title: expense.title,
            vendor: expense.vendor,
            reference_no: reference || expense.reference_no,
            payment_method: paymentMethod,
            finance_account_id: account.id,
            status: "paid",
            amount: paidAmount,
            notes: appendFinanceNote(
              expense.notes,
              `Partial payment for ${expense.title}; original due row kept with remaining balance.`,
            ),
          });
          if (insertError) throw new Error(insertError.message);
        }
        remaining = roundMoney(remaining - paidAmount);
      }

      toast.success("Payable updated");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["operational-expenses"] }),
        qc.invalidateQueries({ queryKey: ["finance-movements"] }),
        qc.invalidateQueries({ queryKey: ["finance-account-positions"] }),
        qc.invalidateQueries({ queryKey: ["finance-obligations"] }),
        qc.invalidateQueries({ queryKey: ["due-expense-obligations"] }),
      ]);
      await onPaid();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not pay this record");
    } finally {
      setLoading(false);
    }
  }

  const selectedAccount = accounts.find((account) => account.id === accountId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Pay
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay {record.counterparty_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-3">
            <p className="text-sm text-muted-foreground">Open balance</p>
            <p className="font-mono text-2xl font-semibold">{formatMoney(record.amount, symbol)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {record.count} due expense{record.count === 1 ? "" : "s"} will be paid oldest first.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Amount to pay</Label>
              <Input
                type="number"
                min="0"
                max={record.amount}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment type</Label>
              <Select
                value={paymentMethod}
                onValueChange={(value: PaymentMethod) => {
                  setPaymentMethod(value);
                  setAccountId(defaultAccountId(accounts, value));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="wallet">Wallet</SelectItem>
                  <SelectItem value="other">Other / old sale / pocket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Paid from account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((account) => account.is_active)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedAccount && accountRequiresBalance(selectedAccount) && (
                <p className="text-xs text-muted-foreground">
                  Available now: {formatMoney(accountBalances[selectedAccount.id] ?? 0, symbol)}
                </p>
              )}
              {selectedAccount?.account_type === "other" && (
                <p className="text-xs text-muted-foreground">
                  External, old-sale, or backup source. This will not reduce Counter Cash or Online.
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Reference / proof note</Label>
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Receipt no, person name, JazzCash ref"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={pay} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pay record
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FinanceMovementProofPanel({
  movements,
  branchName,
  symbol,
}: {
  movements: FinanceMovement[];
  branchName: string;
  symbol: string;
}) {
  const [printingId, setPrintingId] = useState<string | null>(null);
  const recentMovements = movements.slice(0, 8);

  function printRaseed(movement: FinanceMovement) {
    setPrintingId(movement.id);
    try {
      openFinanceMovementRaseed({ movement, branchName, symbol });
      toast.success("Finance raseed opened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open finance raseed");
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <Card className="bg-card/70">
      <CardHeader className="space-y-1">
        <CardTitle>Finance raseed</CardTitle>
        <CardDescription>
          Print proof for money received, paid, moved, or taken from the counter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recentMovements.length ? (
          <div className="grid gap-2">
            {recentMovements.map((movement) => {
              const amount = Number(movement.amount || 0);
              const printing = printingId === movement.id;
              return (
                <div
                  key={`${movement.id}-${movement.movement_type}-${movement.finance_account_id ?? "none"}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/35 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{financeMovementDisplayLabel(movement)}</Badge>
                      <span className="truncate font-medium">{movement.title || "Finance movement"}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {movement.account_name || "Unknown source"} - {reportDateTime(movement.occurred_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="font-mono font-semibold">
                      {formatMoney(amount, symbol)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void printRaseed(movement)}
                      disabled={printing}
                    >
                      {printing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Printer className="mr-2 h-4 w-4" />
                      )}
                      Raseed
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            No finance movement in this selected period yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FinanceActionCenter({
  branchId,
  restaurantId,
  categories,
  accounts,
  accountBalances,
  businessDayStart,
  symbol,
  printingReport,
  onPrintReport,
}: {
  branchId: string;
  restaurantId: string;
  categories: ExpenseCategory[];
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  symbol: string;
  printingReport: boolean;
  onPrintReport: () => void;
}) {
  function scrollToShift() {
    document.getElementById("shift-closing-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <Card className="border-primary/25 bg-card/75">
      <CardHeader>
        <CardTitle>What happened?</CardTitle>
        <CardDescription>
          Pick the closest action. The system will send you to the right form so entries are not
          missed at closing time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Button
          asChild
          variant="outline"
          className="h-auto min-h-[116px] items-start justify-start gap-3 whitespace-normal p-4 text-left"
        >
          <Link to="/inventory">
            <ShoppingCart className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 overflow-hidden">
              <span className="block break-words font-semibold">Bought stock / packaging</span>
              <span className="block break-words text-xs leading-snug text-muted-foreground">
                Record purchase, payment source, and stock quantity.
              </span>
            </span>
          </Link>
        </Button>
        <ExpenseDialog
          branchId={branchId}
          categories={categories}
          accounts={accounts}
          accountBalances={accountBalances}
          businessDayStart={businessDayStart}
          symbol={symbol}
          trigger={
            <FinanceQuickAction
              icon={ReceiptText}
              title="Paid a business expense"
              description="Bills, salary, repair, gas, rent, or other cost."
            />
          }
        />
        <FinanceTransferDialog
          branchId={branchId}
          restaurantId={restaurantId}
          accounts={accounts}
          accountBalances={accountBalances}
          businessDayStart={businessDayStart}
          symbol={symbol}
          trigger={
            <FinanceQuickAction
              icon={WalletCards}
              title="Money moved"
              description="Counter to online, online to counter, bank, wallet."
            />
          }
        />
        <FinanceTransferDialog
          branchId={branchId}
          restaurantId={restaurantId}
          accounts={accounts}
          accountBalances={accountBalances}
          businessDayStart={businessDayStart}
          symbol={symbol}
          initialPreset="owner_took_cash"
          trigger={
            <FinanceQuickAction
              icon={HandCoins}
              title="Owner/staff took or added money"
              description="Pocket cash, owner withdrawal, or correction."
            />
          }
        />
        <FinanceTransferDialog
          branchId={branchId}
          restaurantId={restaurantId}
          accounts={accounts}
          accountBalances={accountBalances}
          businessDayStart={businessDayStart}
          symbol={symbol}
          initialPreset="give_credit"
          trigger={
            <FinanceQuickAction
              icon={HandCoins}
              title="Give / collect credit"
              description="Money given to someone or credit recovered later."
            />
          }
        />
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-[116px] items-start justify-start gap-3 whitespace-normal p-4 text-left"
          onClick={scrollToShift}
        >
          <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 overflow-hidden">
            <span className="block break-words font-semibold">Open or close shift</span>
            <span className="block break-words text-xs leading-snug text-muted-foreground">
              Set opening cash, refresh expected totals, and close day.
            </span>
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-[116px] items-start justify-start gap-3 whitespace-normal p-4 text-left"
          onClick={onPrintReport}
          disabled={printingReport}
        >
          {printingReport ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
          ) : (
            <FileText className="h-5 w-5 shrink-0 text-primary" />
          )}
          <span className="min-w-0 overflow-hidden">
            <span className="block break-words font-semibold">Send owner finance report</span>
            <span className="block break-words text-xs leading-snug text-muted-foreground">
              Print PDF and share WhatsApp summary.
            </span>
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}

type FinanceQuickActionProps = ComponentPropsWithoutRef<typeof Button> & {
  icon: LucideIcon;
  title: string;
  description: string;
};

const FinanceQuickAction = forwardRef<HTMLButtonElement, FinanceQuickActionProps>(
  ({ icon: Icon, title, description, className, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      className={[
        "h-auto min-h-[116px] w-full items-start justify-start gap-3 whitespace-normal p-4 text-left",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <span className="min-w-0 overflow-hidden">
        <span className="block break-words font-semibold">{title}</span>
        <span className="block break-words text-xs leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </Button>
  ),
);
FinanceQuickAction.displayName = "FinanceQuickAction";

function useExpenseCategories(branchId: string) {
  return useQuery({
    queryKey: ["operational-expense-categories", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("operational_expense_categories")
        .select("*")
        .eq("branch_id", branchId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ExpenseCategory[];
    },
  });
}

function useRecurringExpenses(branchId: string) {
  return useQuery({
    queryKey: ["recurring-operational-expenses", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("recurring_operational_expenses")
        .select("*")
        .eq("branch_id", branchId)
        .order("is_active", { ascending: false })
        .order("title", { ascending: true });
      if (error) throw error;
      return (data ?? []) as RecurringExpense[];
    },
  });
}

function useFinanceAccounts(branchId: string) {
  return useQuery({
    queryKey: ["finance-accounts", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_accounts")
        .select("*")
        .eq("branch_id", branchId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FinanceAccount[];
    },
  });
}

function useFinanceMovements(
  branchId: string,
  startDate: string,
  endDate: string,
  businessDayStart: string,
) {
  return useQuery({
    queryKey: ["finance-movements", branchId, startDate, endDate, businessDayStart],
    queryFn: async () => {
      const bounds = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
      const { data, error } = await db
        .from("finance_movements")
        .select("*")
        .eq("branch_id", branchId)
        .gte("occurred_at", bounds.start)
        .lt("occurred_at", bounds.end)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FinanceMovement[];
    },
  });
}

function useFinanceDayClosure(branchId: string, businessDate: string, enabled: boolean) {
  return useQuery({
    queryKey: ["finance-day-closure", branchId, businessDate],
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_day_closures")
        .select("*")
        .eq("branch_id", branchId)
        .eq("business_date", businessDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as FinanceDayClosure[])[0] ?? null;
    },
  });
}

function useFinanceAccountPositions(branchId: string) {
  return useQuery({
    queryKey: ["finance-account-positions", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_account_positions")
        .select("*")
        .eq("branch_id", branchId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as FinanceAccountPosition[];
    },
  });
}

function useFinanceObligations(branchId: string) {
  return useQuery({
    queryKey: ["finance-obligations", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_obligations")
        .select("*")
        .eq("branch_id", branchId)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FinanceObligation[];
    },
  });
}

function useDueExpenseObligations(branchId: string, financeCutoverAt: string | null) {
  return useQuery({
    queryKey: ["due-expense-obligations", branchId, financeCutoverAt],
    queryFn: async () => {
      const { data, error } = await db
        .from("operational_expenses")
        .select(
          "id, branch_id, category_id, expense_date, title, vendor, reference_no, payment_method, finance_account_id, status, amount, notes, recurring_expense_id, recurring_for_date",
        )
        .eq("branch_id", branchId)
        .eq("status", "due")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Expense[])
        .map(expenseToPayableObligation)
        .filter((obligation) => isOnOrAfterFinanceCutover(obligation.occurred_at, financeCutoverAt));
    },
  });
}

function mergeFinanceObligations(
  feedObligations: FinanceObligation[],
  dueExpenseObligations: FinanceObligation[],
) {
  const merged = [...feedObligations];
  const existing = new Set(
    feedObligations.map((obligation) => `${obligation.source_type}:${obligation.source_id}`),
  );
  for (const obligation of dueExpenseObligations) {
    const key = `${obligation.source_type}:${obligation.source_id}`;
    if (!existing.has(key)) merged.push(obligation);
  }
  return merged.sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );
}

function expenseToPayableObligation(expense: Expense): FinanceObligation {
  const expenseDate = toDateInputValue(expense.expense_date) || businessDateInputValue();
  return {
    id: expense.id,
    branch_id: expense.branch_id,
    obligation_type: "payable",
    source_type: "expense",
    source_id: expense.id,
    counterparty_name: expense.vendor?.trim() || expense.title || "Expense due",
    reference: expense.reference_no || expense.title || null,
    amount: expense.amount,
    status: expense.status,
    occurred_at: new Date(`${expenseDate}T12:00:00+05:00`).toISOString(),
    notes: expense.notes,
    expense,
  };
}

function dateInputDayOfWeek(dateValue: string) {
  return new Date(`${dateValue}T12:00:00Z`).getUTCDay();
}

function dateInputDayOfMonth(dateValue: string) {
  return Number(dateValue.slice(8, 10));
}

function daysInDateInputMonth(dateValue: string) {
  const year = Number(dateValue.slice(0, 4));
  const month = Number(dateValue.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function recurringFrequencyLabel(frequency: RecurringFrequency) {
  if (frequency === "weekly") return "Weekly";
  if (frequency === "monthly") return "Monthly";
  return "Daily";
}

function recurringExpenseIsDueOn(template: RecurringExpense, businessDate: string) {
  if (!template.is_active) return false;
  const startDate = toDateInputValue(template.start_date);
  const endDate = toDateInputValue(template.end_date);
  if (startDate && businessDate < startDate) return false;
  if (endDate && businessDate > endDate) return false;

  if (template.frequency === "weekly") {
    const expectedDay = template.day_of_week ?? dateInputDayOfWeek(startDate || businessDate);
    return dateInputDayOfWeek(businessDate) === expectedDay;
  }

  if (template.frequency === "monthly") {
    const configuredDay = template.day_of_month ?? dateInputDayOfMonth(startDate || businessDate);
    const expectedDay = Math.min(configuredDay, daysInDateInputMonth(businessDate));
    return dateInputDayOfMonth(businessDate) === expectedDay;
  }

  return true;
}

async function materializeRecurringExpensesForDate({
  branchId,
  businessDate,
  templates,
}: {
  branchId: string;
  businessDate: string;
  templates: RecurringExpense[];
}) {
  const dueTemplates = templates.filter((template) =>
    recurringExpenseIsDueOn(template, businessDate),
  );
  if (!dueTemplates.length) return 0;

  const { data: existingRows, error: existingError } = await db
    .from("operational_expenses")
    .select("recurring_expense_id")
    .eq("branch_id", branchId)
    .eq("recurring_for_date", businessDate);
  if (existingError) throw existingError;

  const existingTemplateIds = new Set(
    ((existingRows ?? []) as Array<{ recurring_expense_id: string | null }>)
      .map((row) => row.recurring_expense_id)
      .filter(Boolean),
  );
  const missingTemplates = dueTemplates.filter((template) => !existingTemplateIds.has(template.id));
  if (!missingTemplates.length) return 0;

  const rows = missingTemplates.map((template) => ({
    branch_id: branchId,
    category_id: template.category_id,
    expense_date: businessDate,
    title: template.title,
    vendor: template.vendor,
    reference_no: `Fixed ${recurringFrequencyLabel(template.frequency).toLowerCase()} - ${businessDate}`,
    payment_method: null,
    finance_account_id: null,
    status: "due",
    amount: Number(template.amount || 0),
    notes: template.notes || null,
    recurring_expense_id: template.id,
    recurring_for_date: businessDate,
  }));

  const { error: insertError } = await db.from("operational_expenses").insert(rows);
  if (insertError) {
    if (insertError.message.toLowerCase().includes("duplicate")) return 0;
    throw insertError;
  }

  await Promise.all(
    missingTemplates.map((template) =>
      db
        .from("recurring_operational_expenses")
        .update({ last_generated_date: businessDate })
        .eq("id", template.id),
    ),
  );
  return missingTemplates.length;
}

function isOnOrAfterFinanceCutover(occurredAt: string, financeCutoverAt: string | null) {
  if (!financeCutoverAt) return true;
  const occurredMs = new Date(occurredAt).getTime();
  const cutoverMs = new Date(financeCutoverAt).getTime();
  if (!Number.isFinite(occurredMs) || !Number.isFinite(cutoverMs)) return true;
  return occurredMs >= cutoverMs;
}

function defaultAccountId(accounts: FinanceAccount[], method: PaymentMethod | "none" | null) {
  if (!accounts.length || !method || method === "none") return "none";
  const activeAccounts = accounts.filter((account) => account.is_active);
  if (!activeAccounts.length) return "none";
  if (method === "cash") {
    return (
      activeAccounts.find((account) => account.account_type === "counter_cash")?.id ??
      activeAccounts.find((account) => account.is_cash)?.id ??
      "none"
    );
  }
  if (method === "other") {
    return activeAccounts.find((account) => account.account_type === "other")?.id ?? "none";
  }
  const preferredTypes =
    method === "wallet"
      ? ["wallet", "online", "bank"]
      : ["online", "bank", "wallet"];
  return (
    preferredTypes
      .map((type) => activeAccounts.find((account) => account.account_type === type))
      .find(Boolean)?.id ??
    "none"
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function DayEndPanel({
  branchId,
  date,
  enabled,
  closure,
  accounts,
  movements,
  cashPosition,
  onlinePosition,
  businessDayStart,
  symbol,
  onSaved,
  onRefresh,
}: {
  branchId: string;
  date: string;
  enabled: boolean;
  closure: FinanceDayClosure | null;
  accounts: FinanceAccount[];
  movements: FinanceMovement[];
  cashPosition: number;
  onlinePosition: number;
  businessDayStart: string;
  symbol: string;
  onSaved: () => void;
  onRefresh: () => Promise<unknown> | void;
}) {
  const [openingCash, setOpeningCash] = useState("0");
  const [openingOnline, setOpeningOnline] = useState("0");
  const [actualCash, setActualCash] = useState("");
  const [actualOnline, setActualOnline] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const cashMovement = movements
    .filter(isCashMovement)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const onlineMovement = movements
    .filter(isOnlineMovement)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashCollected = movements
    .filter((movement) => isCashMovement(movement) && movement.movement_type === "order_payment")
    .reduce((sum, movement) => sum + Math.max(0, Number(movement.amount || 0)), 0);
  const onlineCollected = movements
    .filter((movement) => isOnlineMovement(movement) && movement.movement_type === "order_payment")
    .reduce((sum, movement) => sum + Math.max(0, Number(movement.amount || 0)), 0);
  const cashExpenses = Math.abs(
    movements
      .filter((movement) => isCashMovement(movement) && movement.movement_type === "expense")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const cashPurchases = Math.abs(
    movements
      .filter(
        (movement) => isCashMovement(movement) && movement.movement_type === "purchase_payment",
      )
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const onlineExpenses = Math.abs(
    movements
      .filter((movement) => isOnlineMovement(movement) && movement.movement_type === "expense")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const onlinePurchases = Math.abs(
    movements
      .filter(
        (movement) => isOnlineMovement(movement) && movement.movement_type === "purchase_payment",
      )
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const carriedOpeningCash = Math.max(0, cashPosition - cashMovement);
  const carriedOpeningOnline = Math.max(0, onlinePosition - onlineMovement);

  useEffect(() => {
    setOpeningCash(String(closure?.opening_cash ?? moneyString(carriedOpeningCash)));
    setOpeningOnline(String(closure?.opening_online ?? moneyString(carriedOpeningOnline)));
    setActualCash(closure?.actual_cash == null ? "" : String(closure.actual_cash));
    setActualOnline(closure?.actual_online == null ? "" : String(closure.actual_online));
    setNotes(closure?.notes ?? "");
  }, [carriedOpeningCash, carriedOpeningOnline, closure, date]);

  const openingCashAmount = Number(openingCash || 0);
  const openingOnlineAmount = Number(openingOnline || 0);
  const expectedCash = openingCashAmount + cashMovement;
  const expectedOnline = openingOnlineAmount + onlineMovement;
  const cashDiff = actualCash === "" ? 0 : Number(actualCash) - expectedCash;
  const onlineDiff = actualOnline === "" ? 0 : Number(actualOnline) - expectedOnline;
  const shiftWindow = businessDateRangeUtcBounds(date, date, businessDayStart);
  const shiftOpened = Boolean(closure);
  const shiftClosed = Boolean(closure?.closed_at);
  const shiftStatus = !enabled
    ? "Period view"
    : !shiftOpened
      ? "Not opened"
      : shiftClosed
        ? "Closed"
        : "Open";
  const sourceRows = useMemo(
    () => buildFinanceSourceRows(accounts, movements),
    [accounts, movements],
  );

  async function refreshClosingNumbers() {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Closing numbers refreshed");
    } finally {
      setRefreshing(false);
    }
  }

  async function saveRecord(options: {
    closedAt?: string | null;
    requireActualCash?: boolean;
    successMessage: string;
  }) {
    if (!enabled) {
      toast.error("Select one business date to close the day.");
      return;
    }
    if (openingCash.trim() === "" || !Number.isFinite(Number(openingCash))) {
      toast.error("Opening cash is required to open or update a shift.");
      return;
    }
    if (Number(openingCash) < 0 || Number(openingOnline || 0) < 0) {
      toast.error("Opening amounts cannot be negative.");
      return;
    }
    if (actualCash !== "" && !Number.isFinite(Number(actualCash))) {
      toast.error("Actual cash must be a valid amount.");
      return;
    }
    if (actualOnline !== "" && !Number.isFinite(Number(actualOnline))) {
      toast.error("Actual online amount must be a valid amount.");
      return;
    }
    if (options.requireActualCash && actualCash.trim() === "") {
      toast.error("Count the counter cash before closing the shift.");
      return;
    }

    const payload = {
      branch_id: branchId,
      business_date: date,
      opening_cash: moneyString(Number(openingCash || 0)),
      opening_online: moneyString(Number(openingOnline || 0)),
      expected_cash: moneyString(expectedCash),
      expected_online: moneyString(expectedOnline),
      actual_cash: actualCash === "" ? null : moneyString(Number(actualCash)),
      actual_online: actualOnline === "" ? null : moneyString(Number(actualOnline)),
      cash_difference: moneyString(cashDiff),
      online_difference: moneyString(onlineDiff),
      notes: notes.trim() || null,
      closed_at: options.closedAt === undefined ? (closure?.closed_at ?? null) : options.closedAt,
    };

    setSaving(true);
    const { error } = closure
      ? await db.from("finance_day_closures").update(payload).eq("id", closure.id)
      : await db.from("finance_day_closures").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(options.successMessage);
      onSaved();
    }
  }

  return (
    <Card id="shift-closing-panel" className="scroll-mt-24 border-primary/20 bg-card/70">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Shift opening and closing</CardTitle>
            <CardDescription>
              Business day starts at {businessDayStart}. Open the shift with counter cash, refresh
              before closing, then record the counted cash and online balances.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{shiftStatus}</Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshClosingNumbers}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Refresh closing numbers
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-200">
            Select a single date to save day-end amounts. Period reports still show movement totals.
          </div>
        )}
        {enabled && !shiftOpened && (
          <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-primary-foreground">
            Open the shift before operational cash tracking. Opening cash is filled from the
            carried finance balance, but you can correct it before opening.
          </div>
        )}
        {enabled && shiftClosed && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            This shift is closed. You can still refresh and update the closed record if a manager
            finds a correction.
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-4">
          <MoneyMetric label="Cash collected" value={formatMoney(cashCollected, symbol)} />
          <MoneyMetric label="Cash purchases" value={formatMoney(cashPurchases, symbol)} />
          <MoneyMetric label="Cash expenses" value={formatMoney(cashExpenses, symbol)} />
          <MoneyMetric label="Online collected" value={formatMoney(onlineCollected, symbol)} />
          <MoneyMetric label="Online purchases" value={formatMoney(onlinePurchases, symbol)} />
          <MoneyMetric label="Online expenses" value={formatMoney(onlineExpenses, symbol)} />
        </div>
        <div className="rounded-xl border border-border bg-background/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <p className="font-medium">Shift ledger</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(shiftWindow.start)} to {formatDate(shiftWindow.end)}
              </p>
            </div>
            <Badge variant="outline">{enabled ? date : "Period view"}</Badge>
          </div>
          {sourceRows.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Source</th>
                    <th className="pr-4">Type</th>
                    <th className="pr-4 text-right">Collected</th>
                    <th className="pr-4 text-right">Transfer in</th>
                    <th className="pr-4 text-right">Transfer out</th>
                    <th className="pr-4 text-right">Purchases</th>
                    <th className="pr-4 text-right">Expenses</th>
                    <th className="pr-4 text-right">Refunds</th>
                    <th className="text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceRows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="py-2 pr-4 font-medium">{row.name}</td>
                      <td className="pr-4 text-muted-foreground">
                        {sourceTypeLabel(row.accountType)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.collected, symbol)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.transferIn, symbol)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.transferOut, symbol)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.purchases, symbol)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.expenses, symbol)}
                      </td>
                      <td className="pr-4 text-right font-mono">
                        {formatMoney(row.refunds, symbol)}
                      </td>
                      <td className="text-right font-mono font-semibold">
                        {formatMoney(row.net, symbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No paid orders or paid expenses in this shift yet.
            </div>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <MoneyInput label="Opening cash" value={openingCash} onChange={setOpeningCash} />
          <MoneyMetric label="Expected cash" value={formatMoney(expectedCash, symbol)} />
          <MoneyInput label="Actual cash" value={actualCash} onChange={setActualCash} />
          <MoneyMetric
            label="Cash difference"
            value={formatMoney(cashDiff, symbol)}
            warn={cashDiff !== 0}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <MoneyInput label="Opening online" value={openingOnline} onChange={setOpeningOnline} />
          <MoneyMetric label="Expected online" value={formatMoney(expectedOnline, symbol)} />
          <MoneyInput label="Actual online" value={actualOnline} onChange={setActualOnline} />
          <MoneyMetric
            label="Online difference"
            value={formatMoney(onlineDiff, symbol)}
            warn={onlineDiff !== 0}
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Reason for difference, handover note, or bank transfer note"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {!shiftOpened ? (
              <Button
                onClick={() => saveRecord({ closedAt: null, successMessage: "Shift opened" })}
                disabled={saving || !enabled}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Open shift
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    saveRecord({
                      successMessage: shiftClosed
                        ? "Closed shift record updated"
                        : "Opening amounts saved",
                    })
                  }
                  disabled={saving || !enabled}
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {shiftClosed ? "Update closed record" : "Save opening amounts"}
                </Button>
                {!shiftClosed && (
                  <Button
                    onClick={() =>
                      saveRecord({
                        closedAt: new Date().toISOString(),
                        requireActualCash: true,
                        successMessage: "Shift closed",
                      })
                    }
                    disabled={saving || !enabled}
                  >
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Close shift
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpenseRow({
  expense,
  branchId,
  categories,
  accounts,
  accountBalances,
  businessDayStart,
  accountName,
  account,
  branchName,
  manager,
  symbol,
}: {
  expense: Expense;
  branchId: string;
  categories: ExpenseCategory[];
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  accountName?: string | null;
  account?: FinanceAccount | null;
  branchName: string;
  manager: boolean;
  symbol: string;
}) {
  const qc = useQueryClient();

  async function remove() {
    if (!window.confirm("Delete this expense entry?")) return;
    const { error } = await db.from("operational_expenses").delete().eq("id", expense.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Expense deleted");
      qc.invalidateQueries({ queryKey: ["operational-expenses"] });
      qc.invalidateQueries({ queryKey: ["finance-movements"] });
      qc.invalidateQueries({ queryKey: ["finance-day-closure"] });
      qc.invalidateQueries({ queryKey: ["finance-account-positions"] });
      qc.invalidateQueries({ queryKey: ["finance-obligations"] });
    }
  }

  function printExpenseRaseed() {
    if (expense.status !== "paid") {
      toast.error(
        "Only paid expenses create a finance raseed. Mark it paid when money is actually given.",
      );
      return;
    }
    try {
      openFinanceMovementRaseed({
        branchName,
        symbol,
        movement: expenseToFinanceMovement(expense, accountName, account),
      });
      toast.success("Expense raseed opened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open expense raseed");
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4 text-muted-foreground">{toDateInputValue(expense.expense_date)}</td>
      <td className="pr-4">
        <div className="max-w-[240px] truncate font-medium">{expense.title}</div>
        <div className="max-w-[240px] truncate text-xs text-muted-foreground">
          {expense.vendor || "-"}
        </div>
      </td>
      <td className="max-w-[180px] truncate pr-4">
        {expense.operational_expense_categories?.name || "Uncategorized"}
      </td>
      <td className="max-w-[160px] truncate pr-4 text-muted-foreground">
        {accountName || "Not set"}
      </td>
      <td className="pr-4">
        <StatusBadge status={expense.status} />
      </td>
      <td className="max-w-[180px] truncate pr-4 text-muted-foreground">
        {expense.reference_no || "-"}
      </td>
      <td className="text-right font-mono">{formatMoney(expense.amount, symbol)}</td>
      {manager && (
        <td className="text-right">
          <div className="flex justify-end gap-1">
            <ExpenseDialog
              branchId={branchId}
              categories={categories}
              accounts={accounts}
              accountBalances={accountBalances}
              businessDayStart={businessDayStart}
              expense={expense}
              symbol={symbol}
            />
            {expense.status === "paid" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={printExpenseRaseed}
                aria-label="Print finance raseed"
              >
                <Printer className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={remove} aria-label="Delete expense">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}

function FinanceTransferDialog({
  branchId,
  restaurantId,
  accounts,
  accountBalances,
  businessDayStart,
  symbol,
  trigger,
  initialPreset = "pocket_to_counter",
}: {
  branchId: string;
  restaurantId: string;
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  symbol: string;
  trigger?: ReactNode;
  initialPreset?:
    | "pocket_to_counter"
    | "counter_to_online"
    | "owner_took_cash"
    | "give_credit"
    | "collect_credit";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const counterAccount = accounts.find(
    (account) => account.is_active && account.account_type === "counter_cash",
  );
  const onlineAccount = accounts.find(
    (account) =>
      account.is_active &&
      (account.account_type === "online" ||
        account.account_type === "bank" ||
        account.account_type === "wallet"),
  );
  const [f, setF] = useState({
    title: "Pocket cash added to counter",
    transfer_type: "owner_contribution" as FinanceTransferType,
    occurred_at: businessDateInputValue(businessDayStart),
    from_account_id: "outside",
    to_account_id: counterAccount?.id ?? "outside",
    amount: "0",
    reference: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    applyPreset(initialPreset);
    // The preset should be applied when a quick action opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPreset]);

  function applyPreset(
    preset:
      | "pocket_to_counter"
      | "counter_to_online"
      | "owner_took_cash"
      | "give_credit"
      | "collect_credit",
  ) {
    if (preset === "pocket_to_counter") {
      setF((current) => ({
        ...current,
        title: "Pocket cash added to counter",
        transfer_type: "owner_contribution",
        from_account_id: "outside",
        to_account_id: counterAccount?.id ?? "outside",
        reference: "",
        notes: "Example: Staff paid change from pocket because counter had no change.",
      }));
      return;
    }
    if (preset === "counter_to_online") {
      setF((current) => ({
        ...current,
        title: "Counter cash sent to online account",
        transfer_type: "cash_deposit",
        from_account_id: counterAccount?.id ?? "outside",
        to_account_id: onlineAccount?.id ?? "outside",
        reference: "",
        notes: "Example: Cash taken from counter and transferred to JazzCash/bank.",
      }));
      return;
    }
    if (preset === "give_credit") {
      setF((current) => ({
        ...current,
        title: "Credit given",
        transfer_type: "credit_given",
        from_account_id: counterAccount?.id ?? "outside",
        to_account_id: "outside",
        reference: "",
        notes: "Write the person name in Reference. This will show in Need to collect.",
      }));
      return;
    }
    if (preset === "collect_credit") {
      setF((current) => ({
        ...current,
        title: "Credit collected",
        transfer_type: "credit_collected",
        from_account_id: "outside",
        to_account_id: counterAccount?.id ?? onlineAccount?.id ?? "outside",
        reference: "",
        notes: "Use the same person name/reference used when credit was given.",
      }));
      return;
    }
    setF((current) => ({
      ...current,
      title: "Owner took cash from counter",
      transfer_type: "owner_withdrawal",
      from_account_id: counterAccount?.id ?? "outside",
      to_account_id: "outside",
      reference: "",
      notes: "Example: Owner took money from counter for personal or handover use.",
    }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = FinanceTransferSchema.safeParse({
      ...f,
      from_account_id: f.from_account_id === "outside" ? null : f.from_account_id,
      to_account_id: f.to_account_id === "outside" ? null : f.to_account_id,
      amount: Number(f.amount),
      reference: f.reference || null,
      notes: f.notes || null,
      occurred_at: `${f.occurred_at}T12:00:00+05:00`,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (
      (parsed.data.transfer_type === "credit_given" ||
        parsed.data.transfer_type === "credit_collected") &&
      !parsed.data.reference
    ) {
      toast.error("Write the person name in Reference so the credit can be tracked.");
      return;
    }
    const source = accounts.find((account) => account.id === parsed.data.from_account_id);
    if (source && accountRequiresBalance(source)) {
      const available = accountBalances[source.id];
      if (available == null) {
        toast.error("Finance balance is still loading. Press Refresh, then try again.");
        return;
      }
      if (parsed.data.amount > available + 0.001) {
        toast.error(
          `${source.name} has ${formatMoney(available, symbol)} available. Record this as pocket/credit/backup money instead.`,
        );
        return;
      }
    }

    setLoading(true);
    const { error } = await db.from("finance_transfers").insert({
      ...parsed.data,
      branch_id: branchId,
      restaurant_id: restaurantId,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Money transfer recorded");
      qc.invalidateQueries({ queryKey: ["finance-movements"] });
      qc.invalidateQueries({ queryKey: ["finance-day-closure"] });
      qc.invalidateQueries({ queryKey: ["finance-account-positions"] });
      qc.invalidateQueries({ queryKey: ["finance-obligations"] });
      setOpen(false);
    }
  }

  const fromAccount = accounts.find((account) => account.id === f.from_account_id);
  const toAccount = accounts.find((account) => account.id === f.to_account_id);
  const fromBalance =
    fromAccount && accountRequiresBalance(fromAccount)
      ? (accountBalances[fromAccount.id] ?? 0)
      : null;
  const toBalance =
    toAccount && accountRequiresBalance(toAccount) ? (accountBalances[toAccount.id] ?? 0) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            Move / add money
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move or add money</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-3 text-sm text-muted-foreground">
            Use this when money changes place, not when the business spends money. Examples: pocket
            cash added to counter, counter cash sent online, or owner takes cash.
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => applyPreset("pocket_to_counter")}
            >
              Pocket to counter
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => applyPreset("counter_to_online")}
            >
              Counter to online
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => applyPreset("owner_took_cash")}
            >
              Owner took cash
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => applyPreset("give_credit")}
            >
              Give credit
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-3 text-left"
              onClick={() => applyPreset("collect_credit")}
            >
              Collect credit
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>What happened?</Label>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={f.transfer_type}
                onValueChange={(value: FinanceTransferType) => setF({ ...f, transfer_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_contribution">Pocket / owner added money</SelectItem>
                  <SelectItem value="internal_transfer">Internal transfer</SelectItem>
                  <SelectItem value="cash_deposit">Cash deposited online/bank</SelectItem>
                  <SelectItem value="cash_withdrawal">Cash withdrawn</SelectItem>
                  <SelectItem value="owner_withdrawal">Owner took money</SelectItem>
                  <SelectItem value="credit_given">Credit given to someone</SelectItem>
                  <SelectItem value="credit_collected">Credit collected back</SelectItem>
                  <SelectItem value="correction">Correction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={f.occurred_at}
                onChange={(e) => setF({ ...f, occurred_at: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>From</Label>
              <Select
                value={f.from_account_id}
                onValueChange={(value) => setF({ ...f, from_account_id: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outside">Outside pocket / person</SelectItem>
                  {accounts
                    .filter((account) => account.is_active)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {fromBalance !== null && (
                <p className="text-xs text-muted-foreground">
                  Available: {formatMoney(fromBalance, symbol)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Select
                value={f.to_account_id}
                onValueChange={(value) => setF({ ...f, to_account_id: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outside">Outside pocket / person</SelectItem>
                  {accounts
                    .filter((account) => account.is_active)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {toBalance !== null && (
                <p className="text-xs text-muted-foreground">
                  Current balance: {formatMoney(toBalance, symbol)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Amount ({symbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input
                value={f.reference}
                onChange={(e) => setF({ ...f, reference: e.target.value })}
                placeholder="Person name, JazzCash ref, note no"
              />
              {(f.transfer_type === "credit_given" || f.transfer_type === "credit_collected") && (
                <p className="text-xs text-muted-foreground">
                  Use the same person name when giving and collecting credit.
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="Example: Brother paid change from pocket because counter had no change."
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({
  branchId,
  categories,
  accounts,
  accountBalances,
  businessDayStart,
  expense,
  symbol,
  trigger,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  accounts: FinanceAccount[];
  accountBalances: FinanceAccountBalanceMap;
  businessDayStart: string;
  expense?: Expense;
  symbol: string;
  trigger?: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState<ExpenseFormState>({
    title: expense?.title ?? "",
    category_id: expense?.category_id ?? "none",
    expense_date: toDateInputValue(expense?.expense_date) || businessDateInputValue(businessDayStart),
    vendor: expense?.vendor ?? "",
    reference_no: expense?.reference_no ?? "",
    payment_method: expense?.payment_method ?? "cash",
    finance_account_id:
      expense?.finance_account_id ?? defaultAccountId(accounts, expense?.payment_method ?? "cash"),
    status: (expense?.status ?? "paid") as ExpenseStatus,
    amount: String(expense?.amount ?? "0"),
    notes: expense?.notes ?? "",
  });

  useEffect(() => {
    if (!open) return;
    setF((current) => {
      if (current.status !== "paid") return current;
      const method = current.payment_method === "none" ? "cash" : current.payment_method;
      const currentSourceValid = accounts.some(
        (account) =>
          account.id === current.finance_account_id &&
          (account.is_active || account.id === expense?.finance_account_id),
      );
      const financeAccountId =
        current.finance_account_id !== "none" && currentSourceValid
          ? current.finance_account_id
          : defaultAccountId(accounts, method);
      if (method === current.payment_method && financeAccountId === current.finance_account_id) {
        return current;
      }
      return { ...current, payment_method: method, finance_account_id: financeAccountId };
    });
  }, [accounts, expense?.finance_account_id, open]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = ExpenseSchema.safeParse({
      ...f,
      category_id: f.category_id === "none" ? null : f.category_id,
      payment_method: f.payment_method === "none" ? null : f.payment_method,
      finance_account_id: f.finance_account_id === "none" ? null : f.finance_account_id,
      amount: Number(f.amount),
      vendor: f.vendor || null,
      reference_no: f.reference_no || null,
      notes: f.notes || null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const source = accounts.find((account) => account.id === parsed.data.finance_account_id);
    if (parsed.data.status === "paid" && source && accountRequiresBalance(source)) {
      const existingCredit =
        expense?.status === "paid" && expense.finance_account_id === source.id
          ? Number(expense.amount || 0)
          : 0;
      const currentBalance = accountBalances[source.id];
      if (currentBalance == null) {
        toast.error("Finance balance is still loading. Press Refresh, then try again.");
        return;
      }
      const available = currentBalance + existingCredit;
      if (parsed.data.amount > available + 0.001) {
        toast.error(
          `${source.name} has ${formatMoney(available, symbol)} available. Mark this expense as due or use pocket/backup money.`,
        );
        return;
      }
    }
    setLoading(true);
    const payload = { ...parsed.data, branch_id: branchId };
    const { error } = expense
      ? await db.from("operational_expenses").update(parsed.data).eq("id", expense.id)
      : await db.from("operational_expenses").insert(payload);
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Expense saved");
      qc.invalidateQueries({ queryKey: ["operational-expenses"] });
      qc.invalidateQueries({ queryKey: ["finance-movements"] });
      qc.invalidateQueries({ queryKey: ["finance-day-closure"] });
      qc.invalidateQueries({ queryKey: ["finance-account-positions"] });
      qc.invalidateQueries({ queryKey: ["finance-obligations"] });
      setOpen(false);
    }
  }

  const selectedAccount = accounts.find((account) => account.id === f.finance_account_id);
  const selectedAccountBalance =
    selectedAccount && accountRequiresBalance(selectedAccount)
      ? (accountBalances[selectedAccount.id] ?? 0)
      : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ? (
          trigger
        ) : expense ? (
          <Button variant="ghost" size="icon" aria-label="Edit expense">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-3 text-sm text-muted-foreground">
            Use this for money spent by the restaurant. If money only moved from counter to online,
            use Move / add money instead.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Expense name</Label>
              <Input
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                placeholder="Gas bill, staff salary, repair, packaging"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount ({symbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={f.expense_date}
                onChange={(e) => setF({ ...f, expense_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={f.category_id} onValueChange={(v) => setF({ ...f, category_id: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {categories
                    .filter((c) => c.is_active || c.id === expense?.category_id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={f.status}
                onValueChange={(v: ExpenseStatus) =>
                  setF((current) => {
                    if (v !== "paid") {
                      return {
                        ...current,
                        status: v,
                        payment_method: "none",
                        finance_account_id: "none",
                      };
                    }
                    const method =
                      current.payment_method === "none" ? "cash" : current.payment_method;
                    return {
                      ...current,
                      status: v,
                      payment_method: method,
                      finance_account_id:
                        current.finance_account_id !== "none"
                          ? current.finance_account_id
                          : defaultAccountId(accounts, method),
                    };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="due">Due</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Payment type</Label>
              <Select
                value={f.payment_method}
                onValueChange={(v: PaymentMethod | "none") =>
                  setF({
                    ...f,
                    payment_method: v,
                    finance_account_id: defaultAccountId(accounts, v),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="wallet">Wallet</SelectItem>
                  <SelectItem value="other">Other / old sale / pocket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Paid from account</Label>
              <Select
                value={f.finance_account_id}
                onValueChange={(v) => setF({ ...f, finance_account_id: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {accounts
                    .filter(
                      (account) => account.is_active || account.id === expense?.finance_account_id,
                    )
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedAccountBalance !== null && f.status === "paid" && (
                <p className="text-xs text-muted-foreground">
                  Available now: {formatMoney(selectedAccountBalance, symbol)}
                </p>
              )}
              {selectedAccount?.account_type === "other" && f.status === "paid" && (
                <p className="text-xs text-muted-foreground">
                  External, old-sale, or backup source. This will not reduce Counter Cash or Online.
                </p>
              )}
              {f.status !== "paid" && (
                <p className="text-xs text-muted-foreground">
                  Due expenses stay in payables until you mark them paid.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Paid to</Label>
              <Input
                value={f.vendor}
                onChange={(e) => setF({ ...f, vendor: e.target.value })}
                placeholder="Shop, supplier, staff member, utility company"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bill / reference</Label>
              <Input
                value={f.reference_no}
                onChange={(e) => setF({ ...f, reference_no: e.target.value })}
                placeholder="Bill no, JazzCash ref, slip no"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="Optional detail for owner/accounting"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecurringExpensesPanel({
  branchId,
  categories,
  recurringExpenses,
  todayValue,
  syncing,
  symbol,
  onGenerateToday,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  recurringExpenses: RecurringExpense[];
  todayValue: string;
  syncing: boolean;
  symbol: string;
  onGenerateToday: () => void;
}) {
  const activeCount = recurringExpenses.filter((expense) => expense.is_active).length;
  const todayDueCount = recurringExpenses.filter((expense) =>
    recurringExpenseIsDueOn(expense, todayValue),
  ).length;

  return (
    <Card className="bg-card/70">
      <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Fixed expenses</CardTitle>
          <CardDescription>
            Rent, salary, subscriptions, and other repeating costs. Active rules create due
            expenses automatically without duplicates.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onGenerateToday} disabled={syncing}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Create today's dues
          </Button>
          <RecurringExpenseDialog
            branchId={branchId}
            categories={categories}
            todayValue={todayValue}
            symbol={symbol}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/35 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Active</p>
            <p className="mt-1 font-mono text-xl font-semibold">{activeCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/35 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Due today</p>
            <p className="mt-1 font-mono text-xl font-semibold">{todayDueCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/35 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Today</p>
            <p className="mt-1 font-mono text-xl font-semibold">{todayValue}</p>
          </div>
        </div>

        {recurringExpenses.length ? (
          <div className="grid gap-2">
            {recurringExpenses.map((expense) => (
              <RecurringExpenseRow
                key={expense.id}
                branchId={branchId}
                categories={categories}
                recurringExpense={expense}
                todayValue={todayValue}
                symbol={symbol}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Add fixed costs like rent, salary, internet, or generator rent. The system will add them
            as due expenses on the correct date.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecurringExpenseRow({
  branchId,
  categories,
  recurringExpense,
  todayValue,
  symbol,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  recurringExpense: RecurringExpense;
  todayValue: string;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const category = categories.find((item) => item.id === recurringExpense.category_id);
  const dueToday = recurringExpenseIsDueOn(recurringExpense, todayValue);

  async function updateActive(isActive: boolean) {
    setSaving(true);
    const { error } = await db
      .from("recurring_operational_expenses")
      .update({ is_active: isActive })
      .eq("id", recurringExpense.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(isActive ? "Fixed expense activated" : "Fixed expense paused");
    qc.invalidateQueries({ queryKey: ["recurring-operational-expenses"] });
  }

  async function remove() {
    const confirmed = window.confirm(
      `Delete fixed expense "${recurringExpense.title}"? Existing expense records will stay.`,
    );
    if (!confirmed) return;
    setSaving(true);
    const { error } = await db
      .from("recurring_operational_expenses")
      .delete()
      .eq("id", recurringExpense.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Fixed expense deleted");
    qc.invalidateQueries({ queryKey: ["recurring-operational-expenses"] });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/35 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{recurringExpense.title}</p>
          <Badge variant={recurringExpense.is_active ? "default" : "outline"}>
            {recurringExpense.is_active ? "Active" : "Paused"}
          </Badge>
          {dueToday && <Badge variant="outline">Due today</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {recurringFrequencyLabel(recurringExpense.frequency)}
          {category ? ` - ${category.name}` : ""}
          {recurringExpense.vendor ? ` - ${recurringExpense.vendor}` : ""}
        </p>
        {recurringExpense.last_generated_date && (
          <p className="mt-1 text-xs text-muted-foreground">
            Last created: {toDateInputValue(recurringExpense.last_generated_date)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <p className="mr-2 font-mono text-lg font-semibold">
          {formatMoney(Number(recurringExpense.amount || 0), symbol)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void updateActive(!recurringExpense.is_active)}
          disabled={saving}
        >
          {recurringExpense.is_active ? "Pause" : "Activate"}
        </Button>
        <RecurringExpenseDialog
          branchId={branchId}
          categories={categories}
          recurringExpense={recurringExpense}
          todayValue={todayValue}
          symbol={symbol}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${recurringExpense.title}`}
          onClick={() => void remove()}
          disabled={saving}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function RecurringExpenseDialog({
  branchId,
  categories,
  recurringExpense,
  todayValue,
  symbol,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  recurringExpense?: RecurringExpense;
  todayValue: string;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const defaultStartDate = toDateInputValue(recurringExpense?.start_date) || todayValue;
  const [f, setF] = useState({
    title: recurringExpense?.title ?? "",
    category_id: recurringExpense?.category_id ?? "none",
    vendor: recurringExpense?.vendor ?? "",
    amount: String(recurringExpense?.amount ?? "0"),
    frequency: recurringExpense?.frequency ?? "daily",
    start_date: defaultStartDate,
    end_date: toDateInputValue(recurringExpense?.end_date) || "",
    day_of_week: String(
      recurringExpense?.day_of_week ?? dateInputDayOfWeek(defaultStartDate || todayValue),
    ),
    day_of_month: String(
      recurringExpense?.day_of_month ?? dateInputDayOfMonth(defaultStartDate || todayValue),
    ),
    is_active: recurringExpense?.is_active ?? true,
    notes: recurringExpense?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = RecurringExpenseSchema.safeParse({
      ...f,
      category_id: f.category_id === "none" ? null : f.category_id,
      vendor: f.vendor || null,
      amount: Number(f.amount),
      frequency: f.frequency,
      end_date: f.end_date || null,
      day_of_week: f.frequency === "weekly" ? Number(f.day_of_week) : null,
      day_of_month: f.frequency === "monthly" ? Number(f.day_of_month) : null,
      notes: f.notes || null,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setSaving(true);
    const payload = { ...parsed.data, branch_id: branchId };
    const { error } = recurringExpense
      ? await db.from("recurring_operational_expenses").update(parsed.data).eq("id", recurringExpense.id)
      : await db.from("recurring_operational_expenses").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Fixed expense saved");
    qc.invalidateQueries({ queryKey: ["recurring-operational-expenses"] });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {recurringExpense ? (
          <Button type="button" variant="ghost" size="icon" aria-label="Edit fixed expense">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button">
            <Plus className="mr-2 h-4 w-4" />
            Fixed expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{recurringExpense ? "Edit fixed expense" : "New fixed expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-3 text-sm text-muted-foreground">
            This creates a normal due expense on the selected schedule. Paying it still requires
            confirmation from Finance.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input
                value={f.title}
                onChange={(e) => setF({ ...f, title: e.target.value })}
                placeholder="Rent, staff salary, internet, generator rent"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Amount ({symbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={f.category_id} onValueChange={(value) => setF({ ...f, category_id: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorized</SelectItem>
                  {categories
                    .filter((category) => category.is_active || category.id === recurringExpense?.category_id)
                    .map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Paid to / person</Label>
              <Input
                value={f.vendor}
                onChange={(e) => setF({ ...f, vendor: e.target.value })}
                placeholder="Landlord, staff member, vendor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Repeat</Label>
              <Select
                value={f.frequency}
                onValueChange={(value: RecurringFrequency) => setF({ ...f, frequency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Every day</SelectItem>
                  <SelectItem value="weekly">Every week</SelectItem>
                  <SelectItem value="monthly">Every month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input
                type="date"
                value={f.start_date}
                onChange={(e) =>
                  setF({
                    ...f,
                    start_date: e.target.value,
                    day_of_week: String(dateInputDayOfWeek(e.target.value)),
                    day_of_month: String(dateInputDayOfMonth(e.target.value)),
                  })
                }
              />
            </div>
            {f.frequency === "weekly" && (
              <div className="space-y-1.5">
                <Label>Weekly day</Label>
                <Select value={f.day_of_week} onValueChange={(value) => setF({ ...f, day_of_week: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {f.frequency === "monthly" && (
              <div className="space-y-1.5">
                <Label>Monthly day</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  value={f.day_of_month}
                  onChange={(e) => setF({ ...f, day_of_month: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>End date</Label>
              <Input
                type="date"
                value={f.end_date}
                onChange={(e) => setF({ ...f, end_date: e.target.value })}
              />
            </div>
            <label className="flex items-center justify-between rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Active</span>
                <span className="block text-xs text-muted-foreground">
                  Paused rules do not create due expenses.
                </span>
              </span>
              <input
                type="checkbox"
                checked={f.is_active}
                onChange={(e) => setF({ ...f, is_active: e.target.checked })}
                className="h-4 w-4"
              />
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                placeholder="Optional detail for owner/accounting"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save fixed expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesPanel({
  branchId,
  manager,
  categories,
}: {
  branchId: string;
  manager: boolean;
  categories: ExpenseCategory[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Cost buckets for reporting.</CardDescription>
        </div>
        {manager && <CategoryDialog branchId={branchId} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <Tags className="h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{category.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {category.description || "No description"}
              </div>
            </div>
            {!category.is_active && <Badge variant="outline">Inactive</Badge>}
            {manager && <CategoryDialog branchId={branchId} category={category} />}
          </div>
        ))}
        {categories.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Add categories like Electricity, Gas, Salaries, Maintenance, Rent, and Delivery.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CategoryDialog({ branchId, category }: { branchId: string; category?: ExpenseCategory }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: category?.name ?? "",
    description: category?.description ?? "",
    is_active: category?.is_active ?? true,
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = CategorySchema.safeParse({ ...f, description: f.description || null });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { error } = category
      ? await db.from("operational_expense_categories").update(parsed.data).eq("id", category.id)
      : await db
          .from("operational_expense_categories")
          .insert({ ...parsed.data, branch_id: branchId });
    if (error) toast.error(error.message);
    else {
      toast.success("Category saved");
      qc.invalidateQueries({ queryKey: ["operational-expense-categories"] });
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {category ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${category.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Category
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label>Active</Label>
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={(e) => setF({ ...f, is_active: e.target.checked })}
              className="h-4 w-4"
            />
          </div>
          <DialogFooter>
            <Button type="submit">Save category</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceSourcesPanel({
  branchId,
  restaurantId,
  manager,
  accounts,
}: {
  branchId: string;
  restaurantId: string;
  manager: boolean;
  accounts: FinanceAccount[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Payment sources</CardTitle>
          <CardDescription>Where money is collected from or paid out.</CardDescription>
        </div>
        {manager && <FinanceAccountDialog branchId={branchId} restaurantId={restaurantId} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center gap-3 rounded-lg border border-border p-3"
          >
            <Banknote className="h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{account.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {sourceTypeLabel(account.account_type)}
                {account.is_cash ? " - cash drawer" : ""}
              </div>
            </div>
            {!account.is_active && <Badge variant="outline">Inactive</Badge>}
            {manager && (
              <FinanceAccountDialog
                branchId={branchId}
                restaurantId={restaurantId}
                account={account}
              />
            )}
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Add sources like Counter Cash, Online, JazzCash, Bank, or Owner Cash.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FinanceAccountDialog({
  branchId,
  restaurantId,
  account,
}: {
  branchId: string;
  restaurantId: string;
  account?: FinanceAccount;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: account?.name ?? "",
    account_type: account?.account_type ?? "other",
    is_cash: account?.is_cash ?? false,
    is_active: account?.is_active ?? true,
    sort_order: String(account?.sort_order ?? 50),
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    const parsed = FinanceAccountSchema.safeParse({
      ...f,
      sort_order: Number(f.sort_order),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    const normalized = {
      ...parsed.data,
      is_cash: parsed.data.account_type === "counter_cash",
    };
    const payload = account
      ? normalized
      : { ...normalized, branch_id: branchId, restaurant_id: restaurantId };
    const { error } = account
      ? await db.from("finance_accounts").update(payload).eq("id", account.id)
      : await db.from("finance_accounts").insert(payload);

    if (error) toast.error(error.message);
    else {
      toast.success("Payment source saved");
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
      qc.invalidateQueries({ queryKey: ["finance-account-positions"] });
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {account ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${account.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Source
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Edit payment source" : "New payment source"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={f.account_type}
                onValueChange={(value: FinanceAccount["account_type"]) =>
                  setF({ ...f, account_type: value, is_cash: value === "counter_cash" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="counter_cash">Counter cash</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="wallet">Wallet</SelectItem>
                  <SelectItem value="other">Other / backup / old sale</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={f.sort_order}
                onChange={(e) => setF({ ...f, sort_order: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">Cash drawer</span>
                <span className="block text-xs text-muted-foreground">
                  Controlled by the source type
                </span>
              </span>
              <input
                type="checkbox"
                checked={f.account_type === "counter_cash"}
                readOnly
                className="h-4 w-4"
              />
            </label>
            <label className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-sm font-medium">Active</span>
              <input
                type="checkbox"
                checked={f.is_active}
                onChange={(e) => setF({ ...f, is_active: e.target.checked })}
                className="h-4 w-4"
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="submit">Save source</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function expenseToFinanceMovement(
  expense: Expense,
  accountName: string | null | undefined,
  account: FinanceAccount | null | undefined,
): FinanceMovement {
  return {
    id: expense.id,
    branch_id: expense.branch_id,
    occurred_at: `${toDateInputValue(expense.expense_date)}T12:00:00+05:00`,
    finance_account_id: expense.finance_account_id,
    account_name: accountName || "External / old sale / pocket",
    account_type: account?.account_type ?? "other",
    is_cash: account?.is_cash ?? false,
    movement_type: "expense",
    title: expense.vendor ? `${expense.title} - ${expense.vendor}` : expense.title,
    payment_method: expense.payment_method,
    payment_kind: "expense",
    amount: -Math.abs(Number(expense.amount || 0)),
    reference: expense.reference_no,
  };
}

function openFinanceMovementRaseed({
  movement,
  branchName,
  symbol,
}: {
  movement: FinanceMovement;
  branchName: string;
  symbol: string;
}) {
  const win = window.open("", "_blank", "width=420,height=700");
  if (!win) throw new Error("Allow popups to open the finance raseed.");

  win.document.open();
  win.document.write(renderFinanceMovementRaseedHtml({ movement, branchName, symbol }));
  win.document.close();
  win.focus();
  win.setTimeout(() => win.print(), 250);
}

function renderFinanceMovementRaseedHtml({
  movement,
  branchName,
  symbol,
}: {
  movement: FinanceMovement;
  branchName: string;
  symbol: string;
}) {
  const amount = Number(movement.amount || 0);
  const direction = financeMovementDirection(movement);
  const rows = [
    ["Date", reportDateTime(movement.occurred_at)],
    ["Type", financeMovementDisplayLabel(movement)],
    ["Direction", direction],
    ["Source", movement.account_name || "Unknown source"],
    ["Amount", formatMoney(Math.abs(amount), symbol)],
    ["Method", movement.payment_method || "-"],
    ["Reference", movement.reference || "-"],
    ["Details", movement.title || "-"],
    ["Record", movement.id.slice(0, 8)],
  ];

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Finance Raseed</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.25;
      }
      .slip {
        width: 72mm;
        max-width: 72mm;
        padding: 4mm 3mm;
      }
      .center { text-align: center; }
      .brand {
        font-family: Georgia, serif;
        font-size: 25px;
        font-weight: 800;
        letter-spacing: .02em;
        line-height: 1;
      }
      .sub {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .28em;
        text-transform: lowercase;
      }
      .title {
        border-bottom: 1px dashed #000;
        border-top: 1px dashed #000;
        font-size: 14px;
        font-weight: 800;
        margin: 8px 0;
        padding: 5px 0;
        text-transform: uppercase;
      }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 3px 0; vertical-align: top; }
      td:first-child {
        color: #333;
        font-size: 10px;
        text-transform: uppercase;
        width: 28%;
      }
      td:last-child {
        font-weight: 700;
        text-align: right;
        word-break: break-word;
      }
      .amount {
        border-bottom: 2px solid #000;
        border-top: 2px solid #000;
        font-size: 18px;
        font-weight: 900;
        margin: 8px 0;
        padding: 6px 0;
        text-align: center;
      }
      .signatures {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }
      .line {
        border-top: 1px solid #000;
        padding-top: 3px;
        text-align: center;
      }
      .note {
        border-top: 1px dashed #000;
        font-size: 10px;
        margin-top: 12px;
        padding-top: 6px;
        text-align: center;
      }
      @media print {
        @page { size: 80mm auto; margin: 0; }
        body { width: 72mm; }
      }
    </style>
  </head>
  <body>
    <main class="slip">
      <div class="center">
        <div class="brand">angaar</div>
        <div class="sub">kitchen</div>
        <div>${escapeHtml(branchName)}</div>
      </div>
      <div class="title center">Finance Raseed</div>
      <table>
        <tbody>
          ${rows
            .filter(([, value]) => value !== "")
            .map(
              ([label, value]) =>
                `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
      <div class="amount">${escapeHtml(direction)} - ${escapeHtml(formatMoney(Math.abs(amount), symbol))}</div>
      <div class="signatures">
        <div class="line">Given by</div>
        <div class="line">Received by</div>
        <div class="line">Verified by</div>
      </div>
      <div class="note">Keep this raseed with the closing records.</div>
    </main>
  </body>
</html>`;
}

function financeMovementDirection(movement: FinanceMovement) {
  if (Number(movement.amount || 0) < 0) return "Given / Paid";
  if (movement.movement_type === "transfer_in" || movement.movement_type === "order_payment") {
    return "Received";
  }
  return "Movement";
}

function openFinanceControlReport({
  branchName,
  businessDayStart,
  startDate,
  endDate,
  symbol,
  accounts,
  movements,
  closure,
  positions,
  obligations,
  ownerWhatsAppPhone,
}: {
  branchName: string;
  businessDayStart: string;
  startDate: string;
  endDate: string;
  symbol: string;
  accounts: FinanceAccount[];
  movements: FinanceMovement[];
  closure: FinanceDayClosure | null;
  positions: FinanceAccountPosition[];
  obligations: FinanceObligation[];
  ownerWhatsAppPhone: string;
}) {
  const sourceRows = buildFinanceSourceRows(accounts, movements);
  const singleDay = startDate === endDate;
  const shiftWindow = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
  const cashMovement = movements
    .filter(isCashMovement)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const onlineMovement = movements
    .filter(isOnlineMovement)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const openingCash = singleDay ? Number(closure?.opening_cash ?? 0) : 0;
  const openingOnline = singleDay ? Number(closure?.opening_online ?? 0) : 0;
  const expectedCash = openingCash + cashMovement;
  const expectedOnline = openingOnline + onlineMovement;
  const actualCash = closure?.actual_cash == null ? null : Number(closure.actual_cash);
  const actualOnline = closure?.actual_online == null ? null : Number(closure.actual_online);
  const cashDifference = actualCash == null ? null : actualCash - expectedCash;
  const onlineDifference = actualOnline == null ? null : actualOnline - expectedOnline;
  const movementRows = [...movements].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  const totalsByType = movementRows.reduce<Record<string, number>>((totals, movement) => {
    const label = financeMovementDisplayLabel(movement);
    totals[label] = (totals[label] ?? 0) + Number(movement.amount || 0);
    return totals;
  }, {});
  const cashPosition = positions
    .filter(isCashPosition)
    .reduce((sum, position) => sum + Number(position.balance || 0), 0);
  const onlinePosition = positions
    .filter(isOnlinePosition)
    .reduce((sum, position) => sum + Number(position.balance || 0), 0);
  const receivableObligations = obligations.filter(
    (obligation) => obligation.obligation_type === "receivable",
  );
  const payableObligations = obligations.filter(
    (obligation) => obligation.obligation_type === "payable",
  );
  const pendingOrderObligations = receivableObligations.filter(
    (obligation) => obligation.source_type === "order",
  );
  const receivableTotal = receivableObligations.reduce(
    (sum, obligation) => sum + Number(obligation.amount || 0),
    0,
  );
  const payableTotal = payableObligations.reduce(
    (sum, obligation) => sum + Number(obligation.amount || 0),
    0,
  );
  const pendingOrderTotal = pendingOrderObligations.reduce(
    (sum, obligation) => sum + Number(obligation.amount || 0),
    0,
  );
  const obligationRows = [...obligations]
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .map(
      (obligation) => `
        <tr>
          <td>${escapeHtml(obligation.obligation_type === "receivable" ? "Collect" : "Pay")}</td>
          <td>${escapeHtml(sourceObligationLabel(obligation.source_type))}</td>
          <td>${escapeHtml(obligation.counterparty_name)}</td>
          <td>${escapeHtml(obligation.reference ?? "")}</td>
          <td>${escapeHtml(obligation.status)}</td>
          <td class="num strong">${escapeHtml(formatMoney(Number(obligation.amount || 0), symbol))}</td>
        </tr>`,
    )
    .join("");

  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) {
    toast.error("Allow popups to open the finance report.");
    return;
  }

  const money = (value: number | null) =>
    value == null ? "Not counted" : formatMoney(value, symbol);
  const generatedAt = new Date().toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
  const whatsappHref = buildFinanceReportWhatsAppHref({
    phone: ownerWhatsAppPhone,
    branchName,
    startDate,
    endDate,
    generatedAt,
    symbol,
    openingCash,
    openingOnline,
    cashMovement,
    onlineMovement,
    expectedCash,
    expectedOnline,
    cashDifference,
    onlineDifference,
    sourceRows,
    cashPosition,
    onlinePosition,
    receivableTotal,
    payableTotal,
    pendingOrderTotal,
    pendingOrderCount: pendingOrderObligations.length,
    singleDay,
  });
  const row = (label: string, value: string, tone = "") => `
    <div class="metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>`;
  const sourceTable = sourceRows.length
    ? sourceRows
        .map(
          (source) => `
        <tr>
          <td>${escapeHtml(source.name)}</td>
          <td>${escapeHtml(sourceTypeLabel(source.accountType))}</td>
          <td class="num">${escapeHtml(formatMoney(source.collected, symbol))}</td>
          <td class="num">${escapeHtml(formatMoney(source.transferIn, symbol))}</td>
          <td class="num">${escapeHtml(formatMoney(source.transferOut, symbol))}</td>
          <td class="num">${escapeHtml(formatMoney(source.purchases, symbol))}</td>
          <td class="num">${escapeHtml(formatMoney(source.expenses, symbol))}</td>
          <td class="num">${escapeHtml(formatMoney(source.refunds, symbol))}</td>
          <td class="num strong">${escapeHtml(formatMoney(source.net, symbol))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="9" class="empty">No finance movements in this period.</td></tr>`;
  const typeRows = Object.entries(totalsByType)
    .map(
      ([type, value]) => `
      <tr>
        <td>${escapeHtml(type)}</td>
        <td class="num strong">${escapeHtml(formatMoney(value, symbol))}</td>
      </tr>`,
    )
    .join("");
  const movementTable = movementRows.length
    ? movementRows
        .map(
          (movement) => `
        <tr>
          <td>${escapeHtml(reportDateTime(movement.occurred_at))}</td>
          <td>${escapeHtml(movement.account_name || "Unknown source")}</td>
          <td>${escapeHtml(financeMovementDisplayLabel(movement))}</td>
          <td>${escapeHtml(movement.title)}</td>
          <td>${escapeHtml(movement.payment_method ?? "")}</td>
          <td>${escapeHtml(movement.reference ?? "")}</td>
          <td class="num strong">${escapeHtml(formatMoney(Number(movement.amount || 0), symbol))}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">No finance movements in this period.</td></tr>`;

  printWindow.document.write(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Finance Report - Angaar Kitchen</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #f5f1e8;
        color: #17130d;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
      }
      .page { max-width: 1120px; margin: 0 auto; padding: 28px; }
      .toolbar {
        position: sticky;
        top: 0;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 12px 28px;
        background: #17130d;
      }
      button {
        border: 0;
        border-radius: 8px;
        background: #ff6d32;
        color: #111;
        cursor: pointer;
        font-weight: 700;
        padding: 10px 14px;
      }
      .button {
        border-radius: 8px;
        background: #25d366;
        color: #082615;
        display: inline-block;
        font-weight: 700;
        padding: 10px 14px;
        text-decoration: none;
      }
      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        border-bottom: 3px solid #17130d;
        padding-bottom: 16px;
      }
      h1 { margin: 0; font-family: Georgia, serif; font-size: 32px; letter-spacing: .02em; }
      h2 { margin: 26px 0 10px; font-size: 17px; text-transform: uppercase; letter-spacing: .12em; }
      .muted { color: #665f55; }
      .right { text-align: right; }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .metric {
        min-height: 78px;
        border: 1px solid #d8cfbf;
        border-radius: 10px;
        background: #fffaf0;
        padding: 12px;
      }
      .metric span {
        display: block;
        color: #6b6258;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .metric strong { display: block; margin-top: 8px; font-size: 18px; }
      .metric.warn { border-color: #b45309; background: #fff7ed; }
      table { width: 100%; border-collapse: collapse; background: #fffaf0; }
      th {
        background: #17130d;
        color: #f8f0dc;
        font-size: 10px;
        letter-spacing: .08em;
        text-align: left;
        text-transform: uppercase;
      }
      th, td { border: 1px solid #d8cfbf; padding: 8px; vertical-align: top; }
      .num { text-align: right; white-space: nowrap; }
      .strong { font-weight: 800; }
      .empty { color: #665f55; padding: 18px; text-align: center; }
      .note {
        border-left: 4px solid #ff6d32;
        background: #fffaf0;
        margin-top: 18px;
        padding: 12px;
      }
      footer { margin-top: 24px; border-top: 1px solid #d8cfbf; padding-top: 12px; color: #665f55; }
      @media print {
        body { background: #fff; }
        .toolbar { display: none; }
        .page { max-width: none; padding: 12mm; }
        .metric, table, .note { break-inside: avoid; }
        h2 { break-after: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <a class="button" href="${escapeHtml(whatsappHref)}" target="_blank" rel="noreferrer">
        Send WhatsApp summary
      </a>
      <button onclick="window.print()">Print or save PDF</button>
    </div>
    <main class="page">
      <header>
        <div>
          <h1>Angaar Kitchen Finance Control Report</h1>
          <p class="muted">${escapeHtml(branchName)} - Business day starts ${escapeHtml(businessDayStart)}</p>
        </div>
        <div class="right">
          <strong>${escapeHtml(startDate)}${startDate === endDate ? "" : ` to ${escapeHtml(endDate)}`}</strong>
          <p class="muted">Generated ${escapeHtml(generatedAt)}</p>
        </div>
      </header>

      <section class="metrics">
        ${row("Opening cash", singleDay ? formatMoney(openingCash, symbol) : "Period view")}
        ${row("Cash movement", formatMoney(cashMovement, symbol))}
        ${row("Expected cash", singleDay ? formatMoney(expectedCash, symbol) : formatMoney(cashMovement, symbol))}
        ${row("Cash difference", singleDay ? money(cashDifference) : "Period view", cashDifference ? "warn" : "")}
        ${row("Opening online", singleDay ? formatMoney(openingOnline, symbol) : "Period view")}
        ${row("Online movement", formatMoney(onlineMovement, symbol))}
        ${row("Expected online", singleDay ? formatMoney(expectedOnline, symbol) : formatMoney(onlineMovement, symbol))}
        ${row("Online difference", singleDay ? money(onlineDifference) : "Period view", onlineDifference ? "warn" : "")}
        ${row("Cash right now", formatMoney(cashPosition, symbol))}
        ${row("Online right now", formatMoney(onlinePosition, symbol))}
        ${row("Pending orders", `${pendingOrderObligations.length} / ${formatMoney(pendingOrderTotal, symbol)}`, pendingOrderTotal ? "warn" : "")}
        ${row("Need to pay", formatMoney(payableTotal, symbol), payableTotal ? "warn" : "")}
      </section>

      <div class="note">
        Shift window: ${escapeHtml(reportDateTime(shiftWindow.start))} to ${escapeHtml(reportDateTime(shiftWindow.end))}.
        For period reports, opening balances are not added because opening/closing is stored per single business day.
      </div>

      <h2>Movement Summary</h2>
      <table>
        <thead><tr><th>Movement type</th><th class="num">Net amount</th></tr></thead>
        <tbody>${typeRows || `<tr><td colspan="2" class="empty">No movement totals.</td></tr>`}</tbody>
      </table>

      <h2>Source Balances and Movement</h2>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Type</th>
            <th class="num">Collected</th>
            <th class="num">Transfer in</th>
            <th class="num">Transfer out</th>
            <th class="num">Purchases</th>
            <th class="num">Expenses</th>
            <th class="num">Refunds</th>
            <th class="num">Net</th>
          </tr>
        </thead>
        <tbody>${sourceTable}</tbody>
      </table>

      <h2>Open Dues and Payables</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Source</th>
            <th>Person / vendor</th>
            <th>Reference</th>
            <th>Status</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${obligationRows || `<tr><td colspan="6" class="empty">No open dues or payables.</td></tr>`}
        </tbody>
      </table>

      <h2>Every Finance Movement</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Type</th>
            <th>Event</th>
            <th>Method</th>
            <th>Reference</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${movementTable}</tbody>
      </table>

      <footer>
        This report is generated from the finance ledger: paid orders, expenses, purchases, and
        money transfers. If a source is wrong on an order or expense, correct the original record,
        then print this report again.
      </footer>
    </main>
    <script>
      window.onload = function () { setTimeout(function () { window.print(); }, 300); };
    </script>
  </body>
</html>`);
  printWindow.document.close();
}

function buildFinanceReportWhatsAppHref({
  phone,
  branchName,
  startDate,
  endDate,
  generatedAt,
  symbol,
  openingCash,
  openingOnline,
  cashMovement,
  onlineMovement,
  expectedCash,
  expectedOnline,
  cashDifference,
  onlineDifference,
  sourceRows,
  cashPosition,
  onlinePosition,
  receivableTotal,
  payableTotal,
  pendingOrderTotal,
  pendingOrderCount,
  singleDay,
}: {
  phone: string;
  branchName: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  symbol: string;
  openingCash: number;
  openingOnline: number;
  cashMovement: number;
  onlineMovement: number;
  expectedCash: number;
  expectedOnline: number;
  cashDifference: number | null;
  onlineDifference: number | null;
  sourceRows: FinanceSourceRow[];
  cashPosition: number;
  onlinePosition: number;
  receivableTotal: number;
  payableTotal: number;
  pendingOrderTotal: number;
  pendingOrderCount: number;
  singleDay: boolean;
}) {
  const period = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
  const topSources = sourceRows
    .slice(0, 6)
    .map((row) => `- ${row.name}: net ${formatMoney(row.net, symbol)}`)
    .join("\n");
  const message = [
    "Angaar Kitchen finance report",
    `Branch: ${branchName}`,
    `Period: ${period}`,
    `Generated: ${generatedAt}`,
    "",
    singleDay ? `Opening cash: ${formatMoney(openingCash, symbol)}` : "Opening cash: period view",
    `Cash movement: ${formatMoney(cashMovement, symbol)}`,
    singleDay
      ? `Expected cash: ${formatMoney(expectedCash, symbol)}`
      : `Cash net: ${formatMoney(cashMovement, symbol)}`,
    singleDay
      ? `Cash difference: ${cashDifference == null ? "not counted" : formatMoney(cashDifference, symbol)}`
      : "Cash difference: period view",
    "",
    singleDay
      ? `Opening online: ${formatMoney(openingOnline, symbol)}`
      : "Opening online: period view",
    `Online movement: ${formatMoney(onlineMovement, symbol)}`,
    singleDay
      ? `Expected online: ${formatMoney(expectedOnline, symbol)}`
      : `Online net: ${formatMoney(onlineMovement, symbol)}`,
    singleDay
      ? `Online difference: ${onlineDifference == null ? "not counted" : formatMoney(onlineDifference, symbol)}`
      : "Online difference: period view",
    "",
    `Cash right now: ${formatMoney(cashPosition, symbol)}`,
    `Online right now: ${formatMoney(onlinePosition, symbol)}`,
    `Need to collect: ${formatMoney(receivableTotal, symbol)}`,
    `Pending orders: ${pendingOrderCount} orders / ${formatMoney(pendingOrderTotal, symbol)}`,
    `Need to pay: ${formatMoney(payableTotal, symbol)}`,
    "",
    "Top sources:",
    topSources || "No finance movements.",
    "",
    "Full ledger is available in the system PDF report.",
  ].join("\n");

  return `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(message)}`;
}

function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.startsWith("3") && digits.length === 10) return `92${digits}`;
  return digits || "923357200955";
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function reportDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  });
}

function DateInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-[200px] flex-1">
      <Label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <Input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
      </div>
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono"
      />
    </div>
  );
}

function MoneyMetric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg ${warn ? "text-amber-300" : ""}`}>{value}</p>
    </div>
  );
}

function moneyString(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function toDateInputValue(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return pakistanDateInputValue(value);
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : pakistanDateInputValue(parsed);
  }
  return "";
}

function StatusBadge({ status }: { status: ExpenseStatus }) {
  const cls: Record<ExpenseStatus, string> = {
    paid: "border-success/30 bg-success/15 text-success",
    due: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    void: "border-muted bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cls[status]}>
      {status}
    </Badge>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40" : ""}>
      <CardContent className="flex items-center justify-between p-5">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 truncate font-display text-2xl">{value}</p>
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            highlight ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
