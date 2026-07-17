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
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { POSTGRES_SESSION_STORAGE_KEY } from "@/integrations/postgres/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useAuth, useMyRoles, isAdmin, isManager } from "@/hooks/use-auth";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import { getDashboardSummaryPostgres } from "@/lib/dashboard.postgres.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatMoney,
  formatDate,
  formatPakistanDateLabel,
  businessDateInputValue,
  businessDateRangeUtcBounds,
} from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

const TERMINAL_ORDER_STATUSES = ["completed", "cancelled", "voided", "refunded"];

type UsageReportRow = {
  report_type: "menu_item" | "inventory_item";
  item_id: string | null;
  item_name: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  completed_quantity: number;
  active_quantity: number;
  revenue: number;
  cost: number;
  order_count: number;
};

function DashboardPage() {
  const { branch, restaurant } = useActiveBranch();
  const { session } = useAuth();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);
  const manager = isManager(roles);
  const postgresEnabled = isPostgresAuthEnabled();
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const nav = useNavigate();

  const businessDayStart =
    ((branch as { business_day_start_time?: string } | null)?.business_day_start_time ?? "10:00").slice(0, 5);
  const todayValue = businessDateInputValue(businessDayStart);
  const [startDate, setStartDate] = useState<string>(todayValue);
  const [endDate, setEndDate] = useState<string>(todayValue);

  const todayQ = useQuery({
    queryKey: ["dashboard-today", branch?.id, startDate, endDate, businessDayStart],
    enabled: !!branch && (!postgresEnabled || !!session),
    queryFn: async () => {
      const bounds = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
      if (postgresEnabled) {
        return getDashboardSummaryPostgres({
          data: {
            branchId: branch!.id,
            startAt: bounds.start,
            endAt: bounds.end,
            startDate,
            endDate,
            includeUsage: admin || manager,
          },
          headers: authHeaders(session?.access_token ?? readPostgresToken()),
        });
      }

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
      const completedOrderIds = orders.filter((o) => o.status === "completed").map((o) => o.id);

      let inventoryCost = 0;
      const costByOrder: Record<string, number> = {};
      if (completedOrderIds.length > 0) {
        const { data: movements, error: movementError } = await supabase
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

      const { data: expenses, error: expensesError } = await supabase
        .from("operational_expenses")
        .select("amount")
        .eq("branch_id", branch!.id)
        .gte("expense_date", startDate)
        .lte("expense_date", endDate)
        .neq("status", "void");
      if (expensesError) throw expensesError;

      const otherCosts = (expenses ?? []).reduce(
        (sum: number, expense) => sum + Number(expense.amount || 0),
        0,
      );

      return {
        orders,
        inventoryCost,
        costByOrder,
        otherCosts,
        orderPaymentNet: 0,
        orderPaymentCollected: 0,
        orderPaymentRefunded: 0,
        lowStockCount: 0,
        usageRows: [],
      };
    },
  });
  const lowStockQ = useQuery({
    queryKey: ["dashboard-low-stock", branch?.id],
    enabled: !!branch && !postgresEnabled,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("inventory_low_stock")
        .select("id", { count: "exact", head: true })
        .eq("branch_id", branch!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const usageQ = useQuery({
    queryKey: ["item-usage-report", branch?.id, startDate, endDate, businessDayStart],
    enabled: !!branch && !postgresEnabled && (admin || manager),
    queryFn: async () => {
      const bounds = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
      const rpcCall = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      const { data, error } = await rpcCall("get_item_usage_report", {
        _branch_id: branch!.id,
        _start_at: bounds.start,
        _end_at: bounds.end,
      });
      if (error) throw error;
      return toUsageReportRows(data);
    },
  });

  const orders = todayQ.data?.orders ?? [];
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const open = orders.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status));
  const avg = completed.length ? revenue / completed.length : 0;

  const inventoryCost = todayQ.data?.inventoryCost ?? 0;
  const otherCosts = todayQ.data?.otherCosts ?? 0;
  const orderPaymentNet = todayQ.data?.orderPaymentNet ?? 0;
  const orderPaymentRefunded = todayQ.data?.orderPaymentRefunded ?? 0;
  const collectionGap = orderPaymentNet - revenue;
  const grossProfit = revenue - inventoryCost;
  const totalProfit = grossProfit - otherCosts;
  const zakaat = Math.max(totalProfit, 0) * 0.05;
  const profitAfterZakaat = totalProfit - zakaat;
  const costByOrder = todayQ.data?.costByOrder ?? {};
  const lowStockCount = postgresEnabled ? (todayQ.data?.lowStockCount ?? 0) : (lowStockQ.data ?? 0);
  const usageRows = postgresEnabled ? (todayQ.data?.usageRows ?? []) : (usageQ.data ?? []);
  const menuUsage = usageRows.filter((row) => row.report_type === "menu_item");
  const inventoryUsage = usageRows.filter((row) => row.report_type === "inventory_item");
  const totalMenuQty = menuUsage.reduce((sum, row) => sum + row.quantity, 0);
  const activeMenuQty = menuUsage.reduce((sum, row) => sum + row.active_quantity, 0);
  const totalStockQty = inventoryUsage.reduce((sum, row) => sum + row.quantity, 0);

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

      <div className={`grid gap-4 sm:grid-cols-2 ${admin ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
        <Stat
          icon={Banknote}
          label={`Sales revenue ${isToday ? "today" : "in period"}`}
          value={formatMoney(revenue, symbol)}
        />
        {admin && (
          <Stat
            icon={WalletCards}
            label={`Money collected ${isToday ? "today" : "in period"}`}
            value={formatMoney(orderPaymentNet, symbol)}
            to="/expenses"
            highlight={orderPaymentRefunded > 0}
          />
        )}
        {admin && (
          <Stat
            icon={Receipt}
            label={
              collectionGap === 0
                ? "Sales and cash match"
                : collectionGap > 0
                  ? "Collected above sales"
                  : "Unpaid sales gap"
            }
            value={formatMoney(collectionGap, symbol)}
            to="/expenses"
            highlight={collectionGap !== 0}
          />
        )}
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
          value={String(lowStockCount)}
          to="/inventory"
          highlight={lowStockCount > 0}
        />
        {(admin || manager) && (
          <Stat
            icon={Utensils}
            label={isToday ? "Menu items today" : "Menu items moved"}
            value={formatQuantity(totalMenuQty)}
            highlight={activeMenuQty > 0}
          />
        )}
        {(admin || manager) && (
          <Stat
            icon={Package}
            label={isToday ? "Stock used today" : "Stock used"}
            value={formatQuantity(totalStockQty)}
            to="/inventory"
            highlight={totalStockQty > 0}
          />
        )}
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

      {(admin || manager) && (
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Item accountability</CardTitle>
            <p className="text-sm text-muted-foreground">
              Sold menu quantities and stock consumed in this period. Active quantities are still
              open, placed, preparing, ready, or served, so they need payment follow-up.
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <UsageTable
              title="Menu items sold or in progress"
              emptyText="No menu items moved in this period."
              rows={menuUsage.slice(0, 12)}
              metricLabel="Qty"
              moneyLabel="Sales"
              symbol={symbol}
              showMoney
            />
            <UsageTable
              title="Inventory consumed"
              emptyText="No recipe stock consumed in this period."
              rows={inventoryUsage.slice(0, 12)}
              metricLabel="Used"
              moneyLabel="Cost"
              symbol={symbol}
              showMoney={admin}
            />
          </CardContent>
        </Card>
      )}

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

function UsageTable({
  title,
  emptyText,
  rows,
  metricLabel,
  moneyLabel,
  symbol,
  showMoney,
}: {
  title: string;
  emptyText: string;
  rows: UsageReportRow[];
  metricLabel: string;
  moneyLabel: string;
  symbol: string;
  showMoney: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
          Top {rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-border/70 py-10 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/25 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-right">{metricLabel}</th>
                <th className="px-3 py-2 text-right">Completed</th>
                <th className="px-3 py-2 text-right">Active</th>
                {showMoney && <th className="px-3 py-2 text-right">{moneyLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.report_type}-${row.item_id ?? row.item_name}`}
                  className="border-t border-border/50"
                >
                  <td className="min-w-[180px] px-3 py-2">
                    <div className="font-medium">{row.item_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.category ?? "Uncategorized"} · {row.order_count} orders
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatQuantity(row.quantity, row.unit)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-success">
                    {formatQuantity(row.completed_quantity, row.unit)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      row.active_quantity > 0 ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {formatQuantity(row.active_quantity, row.unit)}
                  </td>
                  {showMoney && (
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(
                        row.report_type === "menu_item" ? row.revenue : row.cost,
                        symbol,
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatQuantity(value: number, unit?: string | null) {
  const normalized = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  const trimmed = normalized.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return unit && unit !== "qty" ? `${trimmed} ${unit}` : trimmed;
}

function toUsageReportRows(data: unknown): UsageReportRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Partial<Record<keyof UsageReportRow, unknown>>;
    return {
      report_type: row.report_type === "inventory_item" ? "inventory_item" : "menu_item",
      item_id: typeof row.item_id === "string" ? row.item_id : null,
      item_name: typeof row.item_name === "string" ? row.item_name : "Unknown item",
      category: typeof row.category === "string" ? row.category : null,
      unit: typeof row.unit === "string" ? row.unit : null,
      quantity: Number(row.quantity || 0),
      completed_quantity: Number(row.completed_quantity || 0),
      active_quantity: Number(row.active_quantity || 0),
      revenue: Number(row.revenue || 0),
      cost: Number(row.cost || 0),
      order_count: Number(row.order_count || 0),
    };
  });
}

function authHeaders(token: string | null | undefined) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readPostgresToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY);
}

function Stat({
  icon: Icon,
  label,
  value,
  to,
  highlight,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  to?: "/orders" | "/inventory" | "/expenses" | "/pos";
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
  return to ? <Link to={to}>{inner}</Link> : inner;
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
    voided: "bg-destructive/15 text-destructive",
    refunded: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold capitalize ${map[status] ?? "bg-muted"}`}
    >
      {status}
    </span>
  );
}
