import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Calendar,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { isManager, useMyRoles } from "@/hooks/use-auth";
import { formatMoney, pakistanDateInputValue } from "@/lib/format";
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

const db = supabase as any;

const CategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional().nullable(),
  is_active: z.boolean(),
});

const ExpenseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  category_id: z.string().uuid().nullable(),
  expense_date: z.string().min(1),
  vendor: z.string().trim().max(120).optional().nullable(),
  reference_no: z.string().trim().max(120).optional().nullable(),
  payment_method: z.enum(["cash", "card", "upi", "wallet", "other"]).nullable(),
  status: z.enum(["due", "paid", "void"]),
  amount: z.number().min(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

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
      branchName={branch.name}
      manager={manager}
      symbol={restaurant.currency_symbol}
    />
  );
}

function ExpensesWorkspace({
  branchId,
  branchName,
  manager,
  symbol,
}: {
  branchId: string;
  branchName: string;
  manager: boolean;
  symbol: string;
}) {
  const todayValue = pakistanDateInputValue();
  const [startDate, setStartDate] = useState(todayValue);
  const [endDate, setEndDate] = useState(todayValue);
  const [search, setSearch] = useState("");

  const categoriesQ = useExpenseCategories(branchId);
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
      return data ?? [];
    },
  });

  const expenses = expensesQ.data ?? [];
  const visibleExpenses = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return expenses;
    return expenses.filter((e: any) =>
      [e.title, e.vendor, e.reference_no, e.operational_expense_categories?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [expenses, search]);

  const activeExpenses = expenses.filter((e: any) => e.status !== "void");
  const total = activeExpenses.reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
  const paid = activeExpenses
    .filter((e: any) => e.status === "paid")
    .reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);
  const due = activeExpenses
    .filter((e: any) => e.status === "due")
    .reduce((sum: number, e: any) => sum + Number(e.amount || 0), 0);

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Operational expenses</h1>
          <p className="text-sm text-muted-foreground">
            {branchName} electricity, gas, salaries, maintenance, rent, and other non-inventory costs.
          </p>
        </div>
        {manager && (
          <ExpenseDialog
            branchId={branchId}
            categories={categoriesQ.data ?? []}
            symbol={symbol}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Banknote} label="Total costs" value={formatMoney(total, symbol)} />
        <Stat icon={ReceiptText} label="Paid" value={formatMoney(paid, symbol)} />
        <Stat icon={Calendar} label="Due" value={formatMoney(due, symbol)} highlight={due > 0} />
      </div>

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
              <CardTitle>Expense ledger</CardTitle>
              <CardDescription>Real expenses only. Voided entries stay visible but do not count.</CardDescription>
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
            {expensesQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">Date</th>
                      <th className="pr-4">Expense</th>
                      <th className="pr-4">Category</th>
                      <th className="pr-4">Status</th>
                      <th className="pr-4">Reference</th>
                      <th className="text-right">Amount</th>
                      {manager && <th className="text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExpenses.map((expense: any) => (
                      <ExpenseRow
                        key={expense.id}
                        expense={expense}
                        branchId={branchId}
                        categories={categoriesQ.data ?? []}
                        manager={manager}
                        symbol={symbol}
                      />
                    ))}
                    {visibleExpenses.length === 0 && (
                      <tr>
                        <td
                          colSpan={manager ? 7 : 6}
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

        <CategoriesPanel branchId={branchId} manager={manager} categories={categoriesQ.data ?? []} />
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
      return data ?? [];
    },
  });
}

function ExpenseRow({
  expense,
  branchId,
  categories,
  manager,
  symbol,
}: {
  expense: any;
  branchId: string;
  categories: any[];
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
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-4 text-muted-foreground">{expense.expense_date}</td>
      <td className="pr-4">
        <div className="font-medium">{expense.title}</div>
        <div className="text-xs text-muted-foreground">{expense.vendor || "-"}</div>
      </td>
      <td className="pr-4">{expense.operational_expense_categories?.name || "Uncategorized"}</td>
      <td className="pr-4">
        <StatusBadge status={expense.status} />
      </td>
      <td className="pr-4 text-muted-foreground">{expense.reference_no || "-"}</td>
      <td className="text-right font-mono">{formatMoney(expense.amount, symbol)}</td>
      {manager && (
        <td className="text-right">
          <div className="flex justify-end gap-1">
            <ExpenseDialog
              branchId={branchId}
              categories={categories}
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

function ExpenseDialog({
  branchId,
  categories,
  expense,
  symbol,
}: {
  branchId: string;
  categories: any[];
  expense?: any;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    title: expense?.title ?? "",
    category_id: expense?.category_id ?? "none",
    expense_date: expense?.expense_date ?? pakistanDateInputValue(),
    vendor: expense?.vendor ?? "",
    reference_no: expense?.reference_no ?? "",
    payment_method: expense?.payment_method ?? "cash",
    status: (expense?.status ?? "paid") as ExpenseStatus,
    amount: String(expense?.amount ?? "0"),
    notes: expense?.notes ?? "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ExpenseSchema.safeParse({
      ...f,
      category_id: f.category_id === "none" ? null : f.category_id,
      payment_method: f.payment_method === "none" ? null : f.payment_method,
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
            Expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "New expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Title</Label>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
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
                    .filter((c: any) => c.is_active || c.id === expense?.category_id)
                    .map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v: ExpenseStatus) => setF({ ...f, status: v })}>
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
              <Label>Payment</Label>
              <Select
                value={f.payment_method}
                onValueChange={(v: PaymentMethod | "none") => setF({ ...f, payment_method: v })}
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
              <Label>Vendor</Label>
              <Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input
                value={f.reference_no}
                onChange={(e) => setF({ ...f, reference_no: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
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
  categories: any[];
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
        {categories.map((category: any) => (
          <div key={category.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
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

function CategoryDialog({ branchId, category }: { branchId: string; category?: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: category?.name ?? "",
    description: category?.description ?? "",
    is_active: category?.is_active ?? true,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CategorySchema.safeParse({ ...f, description: f.description || null });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const { error } = category
      ? await db.from("operational_expense_categories").update(parsed.data).eq("id", category.id)
      : await db.from("operational_expense_categories").insert({ ...parsed.data, branch_id: branchId });
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
      <DialogContent>
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
  icon: any;
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
