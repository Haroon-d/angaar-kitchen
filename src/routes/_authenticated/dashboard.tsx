import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Receipt, TrendingUp, ChefHat, Plus, Package, Calendar, RotateCcw, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatDate } from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);
  const symbol = restaurant?.currency_symbol ?? "₨";
  const nav = useNavigate();

  // Date range state
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [startDate, setStartDate] = useState<string>(today.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState<string>(today.toISOString().split("T")[0]);

  // Convert date strings to ISO datetime for queries
  const getStartDateTime = () => {
    const date = new Date(startDate);
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  };

  const getEndDateTime = () => {
    const date = new Date(endDate);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  };

  const todayQ = useQuery({
    queryKey: ["dashboard-today", branch?.id, startDate, endDate],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id, order_no, dining_type, status, grand_total, created_at, customer_name,
          order_items (
            id, qty, unit_price, item_id,
            menu_items (
              inventory_recipes (
                quantity,
                inventory_items (
                  average_cost,
                  base_unit
                )
              )
            )
          )
        `)
        .eq("branch_id", branch!.id)
        .gte("created_at", getStartDateTime())
        .lte("created_at", getEndDateTime())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
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

  const orders = todayQ.data ?? [];
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const open = orders.filter((o) => !["completed","cancelled"].includes(o.status));
  const avg = completed.length ? revenue / completed.length : 0;

  // Calculate profit for each order (admin only)
  const calculateOrderProfit = (order: any) => {
    if (!admin || !order.order_items) return 0;

    let totalCost = 0;
    for (const item of order.order_items) {
      const menuItem = item.menu_items;
      if (!menuItem || !menuItem.inventory_recipes) continue;

      for (const recipe of menuItem.inventory_recipes) {
        const inventoryItem = recipe.inventory_items;
        if (!inventoryItem) continue;

        const cost = Number(inventoryItem.average_cost || 0);
        const quantity = Number(recipe.quantity || 0);
        totalCost += cost * quantity * Number(item.qty || 0);
      }
    }

    return Number(order.grand_total || 0) - totalCost;
  };

  // Calculate total profit for completed orders
  const totalProfit = completed.reduce((sum, order) => sum + calculateOrderProfit(order), 0);
  const avgProfit = completed.length ? totalProfit / completed.length : 0;

  const handleResetDates = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateStr = today.toISOString().split("T")[0];
    setStartDate(dateStr);
    setEndDate(dateStr);
  };

  const isToday = startDate === endDate && startDate === new Date().toISOString().split("T")[0];

  if (!branch) {
    return (
      <div className="p-6 sm:p-10">
        <Card><CardContent className="py-12 text-center text-muted-foreground">Angaar Kitchen location is being prepared. Please refresh in a moment.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{isToday ? "Today" : "Period"}</h1>
          <p className="text-sm text-muted-foreground">{branch.name} · {startDate === endDate ? new Date(startDate).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`}</p>
        </div>
        <Button asChild><Link to="/pos"><Plus className="mr-2 h-4 w-4" />New order</Link></Button>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="start-date" className="text-sm font-medium mb-2 block">From Date</Label>
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
              <Label htmlFor="end-date" className="text-sm font-medium mb-2 block">To Date</Label>
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
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetDates}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Today
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className={`grid gap-4 sm:grid-cols-2 ${admin ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        <Stat icon={Banknote} label={`Revenue ${isToday ? "today" : "in period"}`} value={formatMoney(revenue, symbol)} />
        <Stat icon={Receipt} label="Orders completed" value={String(completed.length)} to="/orders" />
        <Stat icon={ChefHat} label="Open tickets" value={String(open.length)} to="/orders" highlight={open.length > 0} />
        <Stat icon={TrendingUp} label="Avg ticket" value={formatMoney(avg, symbol)} />
        <Stat icon={Package} label="Low stock" value={String(lowStockQ.data ?? 0)} to="/inventory" highlight={(lowStockQ.data ?? 0) > 0} />
        {admin && <Stat icon={DollarSign} label={`Profit ${isToday ? "today" : "in period"}`} value={formatMoney(totalProfit, symbol)} />}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent orders</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/pos">Open POS</Link></Button>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No orders {isToday ? "yet today" : "in this period"}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Order</th>
                    <th className="pr-4">Type</th>
                    <th className="pr-4">Customer</th>
                    <th className="pr-4">Status</th>
                    <th className="pr-4">Time</th>
                    <th className="text-right">Total</th>
                    {admin && <th className="text-right">Profit</th>}
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map((o) => {
                    const profit = calculateOrderProfit(o);
                    return (
                      <tr
                        key={o.id}
                        onClick={() => nav({ to: "/receipt/$orderId", params: { orderId: o.id }, search: { placed: false } })}
                        className="cursor-pointer border-t border-border transition hover:bg-muted/30"
                      >
                        <td className="py-2 pr-4 font-mono text-xs">{o.order_no}</td>
                        <td className="pr-4 capitalize">{o.dining_type.replace("_"," ")}</td>
                        <td className="pr-4">{o.customer_name ?? "—"}</td>
                        <td className="pr-4"><StatusPill status={o.status} /></td>
                        <td className="pr-4 text-muted-foreground">{formatDate(o.created_at)}</td>
                        <td className="text-right font-mono">{formatMoney(o.grand_total, symbol)}</td>
                        {admin && <td className="text-right font-mono">{formatMoney(profit, symbol)}</td>}
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

function Stat({ icon: Icon, label, value, to, highlight }: { icon: any; label: string; value: string; to?: string; highlight?: boolean }) {
  const inner = (
    <Card className={`relative overflow-hidden transition ${to ? "cursor-pointer hover:border-primary/50 hover:shadow-ember" : ""} ${highlight ? "border-primary/40" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-3xl">{value}</p>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${highlight ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"}`}>
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
  return <span className={`rounded-full px-2 py-0.5 text-xs ${map[status] ?? "bg-muted"}`}>{status}</span>;
}
