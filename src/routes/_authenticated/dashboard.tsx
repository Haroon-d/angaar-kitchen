import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Receipt, ScrollText, TrendingUp, ChefHat, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₨";

  const todayQ = useQuery({
    queryKey: ["dashboard-today", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const start = new Date(); start.setHours(0,0,0,0);
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_no, dining_type, status, grand_total, created_at, customer_name")
        .eq("branch_id", branch!.id)
        .gte("created_at", start.toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const orders = todayQ.data ?? [];
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((s, o) => s + Number(o.grand_total || 0), 0);
  const open = orders.filter((o) => !["completed","cancelled"].includes(o.status));
  const avg = completed.length ? revenue / completed.length : 0;

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
          <h1 className="font-display text-3xl">Today</h1>
          <p className="text-sm text-muted-foreground">{branch.name} · {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Button asChild><Link to="/pos"><Plus className="mr-2 h-4 w-4" />New order</Link></Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Banknote} label="Revenue today" value={formatMoney(revenue, symbol)} />
        <Stat icon={Receipt} label="Orders completed" value={String(completed.length)} />
        <Stat icon={ChefHat} label="Open tickets" value={String(open.length)} />
        <Stat icon={TrendingUp} label="Avg ticket" value={formatMoney(avg, symbol)} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Recent orders</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/pos">Open POS</Link></Button>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No orders yet today.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2 pr-4">Order</th><th className="pr-4">Type</th><th className="pr-4">Customer</th><th className="pr-4">Status</th><th className="pr-4">Time</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {orders.slice(0, 12).map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="py-2 pr-4 font-mono text-xs">{o.order_no}</td>
                      <td className="pr-4 capitalize">{o.dining_type.replace("_"," ")}</td>
                      <td className="pr-4">{o.customer_name ?? "—"}</td>
                      <td className="pr-4"><StatusPill status={o.status} /></td>
                      <td className="pr-4 text-muted-foreground">{formatDate(o.created_at)}</td>
                      <td className="text-right font-mono">{formatMoney(o.grand_total, symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-3xl">{value}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
