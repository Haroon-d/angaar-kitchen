import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Banknote,
  Receipt,
  TrendingUp,
  ChefHat,
  Plus,
  Package,
  Calendar,
  RotateCcw,
  DollarSign,
  HandCoins,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatMoney,
  formatDate,
  formatPakistanDateLabel,
  pakistanDateInputValue,
  pakistanDateRangeUtcBounds,
} from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const nav = useNavigate();

  const todayValue = pakistanDateInputValue();
  const [startDate, setStartDate] = useState<string>(todayValue);
  const [endDate, setEndDate] = useState<string>(todayValue);

  const todayQ = useQuery({
    queryKey: ["dashboard-today", branch?.id, startDate, endDate],
    enabled: !!branch,
    queryFn: async () => {
      const bounds = pakistanDateRangeUtcBounds(startDate, endDate);
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id, order_no, dining_type, status, grand_total, created_at, customer_name
        `,
        )
        .eq("branch_id", branch!.id)
        .gte("created_at", bounds.start)
        .lt("created_at", bounds.end)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const orders = data ?? [];
      const completedOrderIds = orders
        .filter((o) => o.status === "completed")
        .map((o) => o.id);

      let inventoryCost = 0;
      const costByOrder: Record<string, number> = {};
      if (completedOrderIds.length > 0) {
        const { data: movements, error: movementError } = await (supabase as any)
          .from("inventory_movements")
          .select("related_order_id, quantity_delta, unit_cost")
          .eq("branch_id", branch!.id)
          .eq("movement_type", "sale")
          .in("related_order_id", completedOrderIds);
        if (movementError) throw movementError;
        for (const movement of movements ?? []) {
          const lineCost =
            Math.abs(Number(movement.quantity_delta || 0)) * Number(movement.unit_cost || 0);
          inventoryCost += lineCost;
          if (movement.related_order_id) {
            costByOrder[movement.related_order_id] =
              (costByOrder[movement.related_order_id] ?? 0) + lineCost;
          }
        }
      }

      const { data: expenses, error: expensesError } = await (supabase as any)
        .from("operational_expenses")
        .select("amount")
        .eq("branch_id", branch!.id)
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .neq("status", "void");
      if (expensesError) throw expensesError;

      const otherCosts = (expenses ?? []).reduce(
        (sum: number, expense: any) => sum + Number(expense.amount || 0),
        0,
      );

      return { orders, inventoryCost, costByOrder, otherCosts };
    },
  });
  const lowStockQ = useQuery({
    queryKey: ["dashboard-low-stock", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("inventory_low_stock")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branch!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const orders = todayQ.data?.orders ?? [];
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const open = orders.filter((o) => !["completed", "cancelled"].includes(o.status));
  const avg = completed.length ? revenue / completed.length : 0;

  const inventoryCost = todayQ.data?.inventoryCost ?? 0;
  const otherCosts = todayQ.data?.otherCosts ?? 0;
  const grossProfit = revenue - inventoryCost;
  const totalProfit = grossProfit - otherCosts;
  const zakaat = Math.max(totalProfit, 0) * 0.05;
  const profitAfterZakaat = totalProfit - zakaat;
  const costByOrder = todayQ.data?.costByOrder ?? {};

  const handleResetDates = () => {
    const dateStr = pakistanDateInputValue();
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  const isToday = startDate === endDate && startDate === todayValue;

  if (!branch) {
    return (
      <div className="p-6 sm:p-10">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Angaar Kitchen location is being prepared. Please refresh in a moment.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
            {branch.name}
          </p>
          <h1 className="font-display text-3xl leading-tight">
            {isToday ? "Today" : "Selected period"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {startDate === endDate
              ? formatPakistanDateLabel(startDate, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })
              : `${formatPakistanDateLabel(startDate)} to ${formatPakistanDateLabel(endDate)}`}
          </p>
        </div>
        <Button asChild>
          <Link to="/pos">
            <Plus className="mr-2 h-4 w-4" />
            New order
          </Link>
        </Button>
      </div>

      {/* Date Range Filter */}
      <Card className="bg-card/64">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label
                htmlFor="start-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                From
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label
                htmlFor="end-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                To
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="flex-1"
                />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleResetDates} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Today
            </Button>
          </div>
        </CardContent>
      </Card>

      <div
        className={`grid gap-4 sm:grid-cols-2 ${admin ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}
      >
        <Stat
          icon={Banknote}
          label={`Revenue ${isToday ? "today" : "in period"}`}
          value={formatMoney(revenue, symbol)}
        />
        <Stat
          icon={Receipt}
          label="Orders completed"
          value={String(completed.length)}
          to="/orders"
        />
        <Stat
          icon={ChefHat}
          label="Open tickets"
          value={String(open.length)}
          to="/orders"
          highlight={open.length > 0}
        />
        <Stat icon={TrendingUp} label="Avg ticket" value={formatMoney(avg, symbol)} />
        <Stat
          icon={Package}
          label="Low stock"
          value={String(lowStockQ.data ?? 0)}
          to="/inventory"
          highlight={(lowStockQ.data ?? 0) > 0}
        />
        {admin && (
          <Stat
            icon={Package}
            label="Inventory cost"
            value={formatMoney(inventoryCost, symbol)}
            to="/inventory"
          />
        )}
        {admin && (
          <Stat
            icon={WalletCards}
            label="Other costs"
            value={formatMoney(otherCosts, symbol)}
            to="/expenses"
            highlight={otherCosts > 0}
          />
        )}
        {admin && (
          <Stat icon={DollarSign} label="Net profit" value={formatMoney(totalProfit, symbol)} />
        )}
        {admin && <Stat icon={HandCoins} label="Zakaat" value={formatMoney(zakaat, symbol)} />}
        {admin && (
          <Stat
            icon={DollarSign}
            label="Profit after zakaat"
            value={formatMoney(profitAfterZakaat, symbol)}
          />
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent orders</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/pos">Open POS</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No orders {isToday ? "yet today" : "in this period"}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border/70">
                    <th className="py-3 pr-4">Order</th>
                    <th className="pr-4">Type</th>
                    <th className="pr-4">Customer</th>
                    <th className="pr-4">Status</th>
                    <th className="pr-4">Time</th>
                    <th className="text-right">Total</th>
                    {admin && <th className="text-right">Gross profit</th>}
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map((o) => {
                    const profit =
                      o.status === "completed"
                        ? Number(o.grand_total || 0) - Number(costByOrder[o.id] || 0)
                        : 0;
                    return (
                      <tr
                        key={o.id}
                        onClick={() =>
                          nav({
                            to: "/receipt/$orderId",
                            params: { orderId: o.id },
                            search: { placed: false },
                          })
                        }
                        className="cursor-pointer border-b border-border/45 hover:bg-muted/35"
                      >
                        <td className="py-3 pr-4 font-mono text-xs text-foreground">
                          {o.order_no}
                        </td>
                        <td className="pr-4 capitalize">{o.dining_type.replace("_", " ")}</td>
                        <td className="pr-4">{o.customer_name ?? "-"}</td>
                        <td className="pr-4">
                          <StatusPill status={o.status} />
                        </td>
                        <td className="pr-4 text-muted-foreground">{formatDate(o.created_at)}</td>
                        <td className="text-right font-mono">
                          {formatMoney(o.grand_total, symbol)}
                        </td>
                        {admin && (
                          <td className="text-right font-mono">{formatMoney(profit, symbol)}</td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  to,
  highlight,
}: {
  icon: any;
  label: string;
  value: string;
  to?: string;
  highlight?: boolean;
}) {
  const hasCurrency = value.startsWith("Rs");
  const amountText = hasCurrency ? value.slice(2) : value;

  const inner = (
    <Card
      className={`relative overflow-hidden ${to ? "cursor-pointer hover:border-primary/50" : ""} ${highlight ? "border-primary/45 bg-primary/5" : ""}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 pr-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 flex min-w-0 items-baseline gap-1 whitespace-nowrap font-display text-base leading-none sm:text-lg">
              {hasCurrency && <span className="shrink-0 text-[10px] sm:text-[11px]">Rs</span>}
              <span className="min-w-0 whitespace-nowrap">{amountText}</span>
            </p>
          </div>
          <div
            className={`ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${highlight ? "bg-primary/20 text-primary" : "bg-secondary text-primary"}`}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to as any}>{inner}</Link> : inner;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "bg-success/15 text-success",
    cancelled: "bg-destructive/15 text-destructive",
    open: "bg-muted text-muted-foreground",
    placed: "bg-primary/15 text-primary",
    preparing: "bg-warning/15 text-warning",
    ready: "bg-accent/15 text-accent",
    served: "bg-success/15 text-success",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${map[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}
