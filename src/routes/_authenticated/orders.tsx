import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, Receipt, ChefHat, Clock, Plus, Calendar, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  formatMoney,
  formatDate,
  formatPakistanDateLabel,
  pakistanDateInputValue,
  pakistanDayUtcRange,
} from "@/lib/format";

export const Route = createFileRoute("/_authenticated/orders")({ component: OrdersPage });

type Filter = "open" | "unpaid" | "paid" | "all";
type PaymentStatus = "pending" | "partial" | "paid" | "refunded";
type OrderStatus =
  | "open"
  | "placed"
  | "preparing"
  | "ready"
  | "served"
  | "completed"
  | "cancelled"
  | "voided"
  | "refunded";

const TERMINAL_ORDER_STATUSES = ["completed", "cancelled", "voided", "refunded"];

function OrdersPage() {
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₨";
  const nav = useNavigate();
  const todayValue = pakistanDateInputValue();
  const [selectedDate, setSelectedDate] = useState(todayValue);
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["orders-list", branch?.id, selectedDate],
    enabled: !!branch,
    refetchInterval: 8000,
    queryFn: async () => {
      const selectedDay = pakistanDayUtcRange(selectedDate);
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_no, dining_type, status, payment_status, grand_total, amount_paid, created_at, customer_name, table_label, kot_print_count, bill_print_count, receipt_print_count",
        )
        .eq("branch_id", branch!.id)
        .gte("created_at", selectedDay.start)
        .lt("created_at", selectedDay.end)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const orders = useMemo(() => q.data ?? [], [q.data]);
  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "open") list = list.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status));
    else if (filter === "unpaid")
      list = list.filter(
        (o) => o.payment_status !== "paid" && !TERMINAL_ORDER_STATUSES.includes(o.status),
      );
    else if (filter === "paid") list = list.filter((o) => o.payment_status === "paid");
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.order_no.toLowerCase().includes(s) ||
          (o.customer_name ?? "").toLowerCase().includes(s) ||
          (o.table_label ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [orders, filter, search]);

  const counts = useMemo(
    () => ({
      open: orders.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status)).length,
      unpaid: orders.filter(
        (o) => o.payment_status !== "paid" && !TERMINAL_ORDER_STATUSES.includes(o.status),
      ).length,
      paid: orders.filter((o) => o.payment_status === "paid").length,
      all: orders.length,
    }),
    [orders],
  );
  const isToday = selectedDate === todayValue;

  if (!branch)
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {branch.name} · live tickets ·{" "}
            {formatPakistanDateLabel(selectedDate, { day: "numeric", month: "long" })}
          </p>
        </div>
        <Button asChild>
          <Link to="/pos">
            <Plus className="mr-2 h-4 w-4" />
            New order
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="open">
              Open <CountChip n={counts.open} />
            </TabsTrigger>
            <TabsTrigger value="unpaid">
              Unpaid <CountChip n={counts.unpaid} />
            </TabsTrigger>
            <TabsTrigger value="paid">
              Paid <CountChip n={counts.paid} />
            </TabsTrigger>
            <TabsTrigger value="all">
              All <CountChip n={counts.all} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-end gap-2">
          <div className="min-w-[170px]">
            <Label
              htmlFor="orders-date"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Date
            </Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="orders-date"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                className="pl-9"
              />
            </div>
          </div>
          {!isToday && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSelectedDate(todayValue)}
              aria-label="Show today's orders"
              title="Show today's orders"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 w-64"
            placeholder="Search order # / customer / table"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Receipt className="mx-auto mb-3 h-8 w-8 opacity-50" />
            No {filter === "all" ? "" : filter} orders.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((o) => (
            <button
              key={o.id}
              onClick={() =>
                nav({
                  to: "/receipt/$orderId",
                  params: { orderId: o.id },
                  search: { placed: false },
                })
              }
              className="group flex flex-col rounded-xl border border-border bg-card/60 p-4 text-left shadow-card transition hover:border-primary/50 hover:shadow-ember"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-sm text-muted-foreground">{o.order_no}</div>
                  <div className="font-display text-lg">
                    {o.customer_name || (o.table_label ? `Table ${o.table_label}` : "Walk-in")}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <PayBadge status={o.payment_status as PaymentStatus} />
                  {o.status !== "open" && <StatusBadge status={o.status as OrderStatus} />}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 capitalize">
                  {o.dining_type === "dine_in" && o.table_label
                    ? `T-${o.table_label}`
                    : o.dining_type.replace("_", " ")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(o.created_at)}
                </span>
                {o.kot_print_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-success">
                    <ChefHat className="h-3 w-3" />
                    KOT ×{o.kot_print_count}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-end justify-between">
                <div className="text-xs text-muted-foreground">
                  {o.payment_status !== "paid" && (
                    <span>
                      Outstanding{" "}
                      <span className="font-mono text-primary">
                        {formatMoney(
                          Math.max(0, Number(o.grand_total) - Number(o.amount_paid)),
                          symbol,
                        )}
                      </span>
                    </span>
                  )}
                </div>
                <div className="font-mono text-xl text-primary">
                  {formatMoney(o.grand_total, symbol)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CountChip({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-mono text-primary">
      {n}
    </span>
  );
}

function PayBadge({ status }: { status: PaymentStatus }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Unpaid" },
    partial: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Partial" },
    paid: { cls: "bg-success/15 text-success border-success/30", label: "Paid" },
    refunded: { cls: "bg-muted text-muted-foreground border-border", label: "Refunded" },
  };
  const m = map[status] ?? map.pending;
  return (
    <Badge variant="outline" className={`${m.cls} text-[10px] font-medium`}>
      {m.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { cls: string; label: string }> = {
    open: { cls: "bg-muted text-muted-foreground border-border", label: "Open" },
    placed: { cls: "bg-primary/15 text-primary border-primary/30", label: "Placed" },
    preparing: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Preparing" },
    ready: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Ready" },
    served: { cls: "bg-success/15 text-success border-success/30", label: "Served" },
    completed: { cls: "bg-success/15 text-success border-success/30", label: "Completed" },
    cancelled: {
      cls: "bg-destructive/15 text-destructive border-destructive/30",
      label: "Cancelled",
    },
    voided: { cls: "bg-destructive/15 text-destructive border-destructive/30", label: "Voided" },
    refunded: { cls: "bg-muted text-muted-foreground border-border", label: "Refunded" },
  };
  const m = map[status] ?? map.open;
  return (
    <Badge variant="outline" className={`${m.cls} text-[10px] font-medium`}>
      {m.label}
    </Badge>
  );
}
