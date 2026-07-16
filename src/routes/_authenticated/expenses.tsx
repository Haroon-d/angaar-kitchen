import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Banknote,
  Calendar,
  FileText,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Tags,
  Trash2,
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
  operational_expense_categories?: { name: string } | null;
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

const FinanceTransferSchema = z.object({
  title: z.string().trim().min(1).max(120),
  transfer_type: z.enum([
    "internal_transfer",
    "owner_contribution",
    "owner_withdrawal",
    "cash_deposit",
    "cash_withdrawal",
    "correction",
  ]),
  occurred_at: z.string().min(1),
  from_account_id: z.string().uuid().nullable(),
  to_account_id: z.string().uuid().nullable(),
  amount: z.number().positive(),
  reference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine((value) => value.from_account_id || value.to_account_id, {
  message: "Select at least one source.",
  path: ["from_account_id"],
}).refine((value) => value.from_account_id !== value.to_account_id, {
  message: "From and To cannot be the same source.",
  path: ["to_account_id"],
});

const ExpenseSchema = z.object({
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

function movementTypeLabel(type: FinanceMovement["movement_type"] | string) {
  switch (type) {
    case "order_payment":
      return "Order payment";
    case "expense":
      return "Expense";
    case "purchase_payment":
      return "Purchase";
    case "transfer_in":
      return "Transfer in";
    case "transfer_out":
      return "Transfer out";
    default:
      return "Movement";
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
    const key =
      movement.finance_account_id ??
      `${movement.account_name || "Unknown source"}-${movement.is_cash ? "cash" : "online"}`;
    const row = ensureRow(
      key,
      movement.account_name || "Unknown source",
      movement.account_type || (movement.is_cash ? "counter_cash" : "online"),
      movement.is_cash,
    );
    const amount = Number(movement.amount || 0);
    row.net += amount;
    if (movement.movement_type === "expense") {
      row.expenses += Math.abs(amount);
    } else if (movement.movement_type === "purchase_payment") {
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
      businessDayStart={
        ((branch as { business_day_start_time?: string }).business_day_start_time ?? "10:00").slice(
          0,
          5,
        )
      }
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
  branchName,
  ownerWhatsAppPhone,
  manager,
  symbol,
}: {
  branchId: string;
  restaurantId: string;
  businessDayStart: string;
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

  const categoriesQ = useExpenseCategories(branchId);
  const accountsQ = useFinanceAccounts(branchId);
  const movementsQ = useFinanceMovements(branchId, startDate, endDate, businessDayStart);
  const closureQ = useFinanceDayClosure(branchId, startDate, startDate === endDate);
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
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const visibleExpenses = useMemo(() => {
    const s = search.trim().toLowerCase();
    return expenses.filter((e) =>
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

  const activeExpenses = expenses.filter((e) => e.status !== "void");
  const total = activeExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const paid = activeExpenses
    .filter((e) => e.status === "paid")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const due = activeExpenses
    .filter((e) => e.status === "due")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  async function printFinanceReport() {
    setPrintingReport(true);
    try {
      const [latestAccounts, latestMovements, latestClosure] = await Promise.all([
        accountsQ.refetch(),
        movementsQ.refetch(),
        startDate === endDate ? closureQ.refetch() : Promise.resolve({ data: null }),
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
          <h1 className="font-display text-3xl">Expenses and cash flow</h1>
          <p className="text-sm text-muted-foreground">
            Record business expenses, money movement between counter and online accounts, and
            day-end cash checking.
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
            <FinanceTransferDialog
              branchId={branchId}
              restaurantId={restaurantId}
              accounts={accounts}
              businessDayStart={businessDayStart}
              symbol={symbol}
            />
            <ExpenseDialog
              branchId={branchId}
              categories={categoriesQ.data ?? []}
              accounts={accounts}
              symbol={symbol}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Banknote} label="Selected period cost" value={formatMoney(total, symbol)} />
        <Stat icon={ReceiptText} label="Already paid" value={formatMoney(paid, symbol)} />
        <Stat icon={Calendar} label="Still payable" value={formatMoney(due, symbol)} highlight={due > 0} />
      </div>

      <DayEndPanel
        branchId={branchId}
        date={startDate}
        enabled={startDate === endDate}
        closure={closureQ.data ?? null}
        accounts={accounts}
        movements={movementsQ.data ?? []}
        businessDayStart={businessDayStart}
        symbol={symbol}
        onSaved={() => {
          void Promise.all([
            expensesQ.refetch(),
            movementsQ.refetch(),
            closureQ.refetch(),
            accountsQ.refetch(),
          ]);
        }}
        onRefresh={async () => {
          await Promise.all([
            expensesQ.refetch(),
            movementsQ.refetch(),
            closureQ.refetch(),
            accountsQ.refetch(),
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
                const dateStr = pakistanDateInputValue();
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
                        accountName={expense.finance_account_id ? accountById.get(expense.finance_account_id)?.name : null}
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

function defaultAccountId(accounts: FinanceAccount[], method: PaymentMethod | "none" | null) {
  if (!accounts.length || !method || method === "none") return "none";
  const accountType = method === "cash" ? "counter_cash" : method === "other" ? "other" : "online";
  return accounts.find((account) => account.is_active && account.account_type === accountType)?.id ?? "none";
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

  useEffect(() => {
    setOpeningCash(String(closure?.opening_cash ?? "0"));
    setOpeningOnline(String(closure?.opening_online ?? "0"));
    setActualCash(closure?.actual_cash == null ? "" : String(closure.actual_cash));
    setActualOnline(closure?.actual_online == null ? "" : String(closure.actual_online));
    setNotes(closure?.notes ?? "");
  }, [closure, date]);

  const cashMovement = movements
    .filter((movement) => movement.is_cash)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const onlineMovement = movements
    .filter((movement) => !movement.is_cash)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashCollected = movements
    .filter((movement) => movement.is_cash && movement.movement_type === "order_payment")
    .reduce((sum, movement) => sum + Math.max(0, Number(movement.amount || 0)), 0);
  const onlineCollected = movements
    .filter((movement) => !movement.is_cash && movement.movement_type === "order_payment")
    .reduce((sum, movement) => sum + Math.max(0, Number(movement.amount || 0)), 0);
  const cashExpenses = Math.abs(
    movements
      .filter((movement) => movement.is_cash && movement.movement_type === "expense")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const cashPurchases = Math.abs(
    movements
      .filter((movement) => movement.is_cash && movement.movement_type === "purchase_payment")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const onlineExpenses = Math.abs(
    movements
      .filter((movement) => !movement.is_cash && movement.movement_type === "expense")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const onlinePurchases = Math.abs(
    movements
      .filter((movement) => !movement.is_cash && movement.movement_type === "purchase_payment")
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
  );
  const openingCashAmount = Number(openingCash || 0);
  const openingOnlineAmount = Number(openingOnline || 0);
  const expectedCash = openingCashAmount + cashMovement;
  const expectedOnline = openingOnlineAmount + onlineMovement;
  const cashDiff = actualCash === "" ? 0 : Number(actualCash) - expectedCash;
  const onlineDiff = actualOnline === "" ? 0 : Number(actualOnline) - expectedOnline;
  const shiftWindow = businessDateRangeUtcBounds(date, date, businessDayStart);
  const shiftOpened = Boolean(closure);
  const shiftClosed = Boolean(closure?.closed_at);
  const shiftStatus = !enabled ? "Period view" : !shiftOpened ? "Not opened" : shiftClosed ? "Closed" : "Open";
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
    <Card className="border-primary/20 bg-card/70">
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
            Open the shift before operational cash tracking. Opening cash is required; online
            opening can stay 0 and be corrected later.
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
          <MoneyMetric label="Cash difference" value={formatMoney(cashDiff, symbol)} warn={cashDiff !== 0} />
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
                onClick={() =>
                  saveRecord({ closedAt: null, successMessage: "Shift opened" })
                }
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
  accountName,
  manager,
  symbol,
}: {
  expense: Expense;
  branchId: string;
  categories: ExpenseCategory[];
  accounts: FinanceAccount[];
  accountName?: string | null;
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
              expense={expense}
              symbol={symbol}
            />
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
  businessDayStart,
  symbol,
}: {
  branchId: string;
  restaurantId: string;
  accounts: FinanceAccount[];
  businessDayStart: string;
  symbol: string;
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

  function applyPreset(preset: "pocket_to_counter" | "counter_to_online" | "owner_took_cash") {
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
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowLeftRight className="mr-2 h-4 w-4" />
          Move / add money
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move or add money</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-3 text-sm text-muted-foreground">
            Use this when money changes place, not when the business spends money. Examples:
            pocket cash added to counter, counter cash sent online, or owner takes cash.
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
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
                onValueChange={(value: FinanceTransferType) =>
                  setF({ ...f, transfer_type: value })
                }
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
                placeholder="JazzCash ref, note no, person name"
              />
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
  expense,
  symbol,
}: {
  branchId: string;
  categories: ExpenseCategory[];
  accounts: FinanceAccount[];
  expense?: Expense;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    title: expense?.title ?? "",
    category_id: expense?.category_id ?? "none",
    expense_date: toDateInputValue(expense?.expense_date) || pakistanDateInputValue(),
    vendor: expense?.vendor ?? "",
    reference_no: expense?.reference_no ?? "",
    payment_method: expense?.payment_method ?? "cash",
    finance_account_id: expense?.finance_account_id ?? defaultAccountId(accounts, expense?.payment_method ?? "cash"),
    status: (expense?.status ?? "paid") as ExpenseStatus,
    amount: String(expense?.amount ?? "0"),
    notes: expense?.notes ?? "",
  });

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
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {expense ? (
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
                onValueChange={(v: ExpenseStatus) => setF({ ...f, status: v })}
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
                  <SelectItem value="other">Other</SelectItem>
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
                    .filter((account) => account.is_active || account.id === expense?.finance_account_id)
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
                {account.is_cash ? " · cash drawer" : ""}
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

    const payload = account ? parsed.data : { ...parsed.data, branch_id: branchId, restaurant_id: restaurantId };
    const { error } = account
      ? await db.from("finance_accounts").update(payload).eq("id", account.id)
      : await db.from("finance_accounts").insert(payload);

    if (error) toast.error(error.message);
    else {
      toast.success("Payment source saved");
      qc.invalidateQueries({ queryKey: ["finance-accounts"] });
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
                  <SelectItem value="other">Other</SelectItem>
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
              <span className="text-sm font-medium">Cash drawer</span>
              <input
                type="checkbox"
                checked={f.is_cash}
                onChange={(e) => setF({ ...f, is_cash: e.target.checked })}
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

function openFinanceControlReport({
  branchName,
  businessDayStart,
  startDate,
  endDate,
  symbol,
  accounts,
  movements,
  closure,
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
  ownerWhatsAppPhone: string;
}) {
  const sourceRows = buildFinanceSourceRows(accounts, movements);
  const singleDay = startDate === endDate;
  const shiftWindow = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
  const cashMovement = movements
    .filter((movement) => movement.is_cash)
    .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const onlineMovement = movements
    .filter((movement) => !movement.is_cash)
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
    totals[movement.movement_type] =
      (totals[movement.movement_type] ?? 0) + Number(movement.amount || 0);
    return totals;
  }, {});

  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) {
    toast.error("Allow popups to open the finance report.");
    return;
  }

  const money = (value: number | null) => (value == null ? "Not counted" : formatMoney(value, symbol));
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
        <td>${escapeHtml(movementTypeLabel(type))}</td>
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
          <td>${escapeHtml(movementTypeLabel(movement.movement_type))}</td>
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
    singleDay ? `Expected cash: ${formatMoney(expectedCash, symbol)}` : `Cash net: ${formatMoney(cashMovement, symbol)}`,
    singleDay
      ? `Cash difference: ${cashDifference == null ? "not counted" : formatMoney(cashDifference, symbol)}`
      : "Cash difference: period view",
    "",
    singleDay ? `Opening online: ${formatMoney(openingOnline, symbol)}` : "Opening online: period view",
    `Online movement: ${formatMoney(onlineMovement, symbol)}`,
    singleDay
      ? `Expected online: ${formatMoney(expectedOnline, symbol)}`
      : `Online net: ${formatMoney(onlineMovement, symbol)}`,
    singleDay
      ? `Online difference: ${onlineDifference == null ? "not counted" : formatMoney(onlineDifference, symbol)}`
      : "Online difference: period view",
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
