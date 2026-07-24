import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  Receipt,
  ChefHat,
  Clock,
  Plus,
  Calendar,
  RotateCcw,
  Truck,
  Store,
  MapPin,
  MessageCircle,
  StickyNote,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
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
  businessDateInputValue,
  businessDateRangeUtcBounds,
} from "@/lib/format";

type StatusFilter = "fulfillment" | "unpaid" | "paid" | "completed" | "all";
type ChannelFilter = "all" | "website" | "pos";
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
type OrderChannel = "website" | "pos";

const OrdersSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(["fulfillment", "unpaid", "paid", "completed", "all"]).optional(),
  channel: z.enum(["all", "website", "pos"]).optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/orders")({
  validateSearch: (search) => OrdersSearchSchema.parse(search),
  component: OrdersPage,
});
type OrderRow = {
  id: string;
  order_no: string;
  dining_type: "dine_in" | "takeaway" | "delivery" | "outdoor";
  status: OrderStatus;
  payment_status: PaymentStatus;
  grand_total: number | string;
  amount_paid: number | string;
  created_at: string;
  created_by: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  table_label: string | null;
  notes: string | null;
  kot_print_count: number;
  bill_print_count: number;
  receipt_print_count: number;
};

const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["completed", "cancelled", "voided", "refunded"];

function OrdersPage() {
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const nav = useNavigate();
  const searchParams = useSearch({ from: Route.id });
  const qc = useQueryClient();
  const businessDayStart =
    ((branch as { business_day_start_time?: string } | null)?.business_day_start_time ?? "10:00").slice(0, 5);
  const todayValue = businessDateInputValue(businessDayStart);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const dateRange = normalizeOrderDateRange(searchParams.from, searchParams.to, todayValue);
  const statusFilter = searchParams.status ?? "fulfillment";
  const channelFilter = searchParams.channel ?? "all";
  const search = searchParams.q ?? "";
  const isToday = dateRange.from === todayValue && dateRange.to === todayValue;

  function updateSearch(patch: Partial<z.infer<typeof OrdersSearchSchema>>) {
    nav({
      to: "/orders",
      search: {
        ...searchParams,
        ...patch,
      },
      replace: true,
    });
  }

  const q = useQuery({
    queryKey: ["orders-list", branch?.id, dateRange.from, dateRange.to, businessDayStart],
    enabled: !!branch,
    refetchInterval: isToday ? 12000 : false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const selectedPeriod = businessDateRangeUtcBounds(
        dateRange.from,
        dateRange.to,
        businessDayStart,
      );
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_no, dining_type, status, payment_status, grand_total, amount_paid, created_at, created_by, customer_name, customer_phone, table_label, notes, kot_print_count, bill_print_count, receipt_print_count",
        )
        .eq("branch_id", branch!.id)
        .gte("created_at", selectedPeriod.start)
        .lt("created_at", selectedPeriod.end)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const orders = useMemo<OrderRow[]>(() => q.data ?? [], [q.data]);
  const channelOrders = useMemo(() => {
    if (channelFilter === "all") return orders;
    return orders.filter((order) => getOrderChannel(order) === channelFilter);
  }, [orders, channelFilter]);

  const filtered = useMemo(() => {
    let list = channelOrders;
    if (statusFilter === "fulfillment") {
      list = list.filter((order) => isToFulfill(order.status));
    } else if (statusFilter === "unpaid") {
      list = list.filter(
        (order) =>
          order.payment_status !== "paid" &&
          order.payment_status !== "refunded" &&
          !TERMINAL_ORDER_STATUSES.includes(order.status),
      );
    } else if (statusFilter === "paid") {
      list = list.filter((order) => order.payment_status === "paid");
    } else if (statusFilter === "completed") {
      list = list.filter((order) => order.status === "completed");
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (order) =>
          order.order_no.toLowerCase().includes(s) ||
          (order.customer_name ?? "").toLowerCase().includes(s) ||
          (order.customer_phone ?? "").toLowerCase().includes(s) ||
          (order.table_label ?? "").toLowerCase().includes(s),
      );
    }

    return list;
  }, [channelOrders, statusFilter, search]);

  const statusCounts = useMemo(
    () => ({
      fulfillment: channelOrders.filter((order) => isToFulfill(order.status)).length,
      unpaid: channelOrders.filter(
        (order) =>
          order.payment_status !== "paid" &&
          order.payment_status !== "refunded" &&
          !TERMINAL_ORDER_STATUSES.includes(order.status),
      ).length,
      paid: channelOrders.filter((order) => order.payment_status === "paid").length,
      completed: channelOrders.filter((order) => order.status === "completed").length,
      all: channelOrders.length,
    }),
    [channelOrders],
  );
  const fulfillmentCounts = useMemo(
    () => ({
      delivery: channelOrders.filter(
        (order) => order.dining_type === "delivery" && isToFulfill(order.status),
      ).length,
      takeaway: channelOrders.filter(
        (order) => order.dining_type === "takeaway" && isToFulfill(order.status),
      ).length,
      dineIn: channelOrders.filter(
        (order) => order.dining_type === "dine_in" && isToFulfill(order.status),
      ).length,
      outdoor: channelOrders.filter(
        (order) => order.dining_type === "outdoor" && isToFulfill(order.status),
      ).length,
    }),
    [channelOrders],
  );
  const channelCounts = useMemo(
    () => ({
      all: orders.length,
      website: orders.filter((order) => getOrderChannel(order) === "website").length,
      pos: orders.filter((order) => getOrderChannel(order) === "pos").length,
    }),
    [orders],
  );
  async function updateOrderStatus(order: OrderRow, status: OrderStatus) {
    setUpdatingOrderId(order.id);
    try {
      const { error } = await supabase.rpc("update_order_status", {
        _order_id: order.id,
        _status: status,
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["orders-list"] });
      toast.success(`Order ${order.order_no} marked ${status.replace("_", " ")}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update order");
    } finally {
      setUpdatingOrderId(null);
    }
  }

  if (!branch)
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {branch.name} · website and POS tickets ·{" "}
            {formatOrderPeriodLabel(dateRange.from, dateRange.to)}
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
        <Tabs
          value={channelFilter}
          onValueChange={(value) => updateSearch({ channel: value as ChannelFilter })}
        >
          <TabsList>
            <TabsTrigger value="all">
              All channels <CountChip n={channelCounts.all} />
            </TabsTrigger>
            <TabsTrigger value="website">
              Website <CountChip n={channelCounts.website} />
            </TabsTrigger>
            <TabsTrigger value="pos">
              POS <CountChip n={channelCounts.pos} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs
          value={statusFilter}
          onValueChange={(value) => updateSearch({ status: value as StatusFilter })}
        >
          <TabsList>
            <TabsTrigger value="fulfillment">
              To fulfill <CountChip n={statusCounts.fulfillment} />
            </TabsTrigger>
            <TabsTrigger value="unpaid">
              Unpaid <CountChip n={statusCounts.unpaid} />
            </TabsTrigger>
            <TabsTrigger value="paid">
              Paid <CountChip n={statusCounts.paid} />
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed <CountChip n={statusCounts.completed} />
            </TabsTrigger>
            <TabsTrigger value="all">
              All <CountChip n={statusCounts.all} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[170px]">
            <Label
              htmlFor="orders-from-date"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              From
            </Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="orders-from-date"
                type="date"
                value={dateRange.from}
                onChange={(e) => {
                  if (!e.target.value) return;
                  updateSearch({
                    from: e.target.value,
                    to: e.target.value > dateRange.to ? e.target.value : dateRange.to,
                  });
                }}
                className="pl-9"
              />
            </div>
          </div>
          <div className="min-w-[170px]">
            <Label
              htmlFor="orders-to-date"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              To
            </Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="orders-to-date"
                type="date"
                value={dateRange.to}
                onChange={(e) => {
                  if (!e.target.value) return;
                  updateSearch({
                    from: e.target.value < dateRange.from ? e.target.value : dateRange.from,
                    to: e.target.value,
                  });
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
              onClick={() => updateSearch({ from: todayValue, to: todayValue })}
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
            className="w-64 pl-9"
            placeholder="Search order # / customer / phone / table"
            value={search}
            onChange={(e) => updateSearch({ q: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OrderQueueCard
          icon={Truck}
          label="Delivery queue"
          value={fulfillmentCounts.delivery}
          hint="Undelivered delivery orders"
        />
        <OrderQueueCard
          icon={Store}
          label="Takeaway queue"
          value={fulfillmentCounts.takeaway}
          hint="Waiting for pickup"
        />
        <OrderQueueCard
          icon={ChefHat}
          label="Dine-in queue"
          value={fulfillmentCounts.dineIn}
          hint="Open table service"
        />
        <OrderQueueCard
          icon={MapPin}
          label="Outdoor queue"
          value={fulfillmentCounts.outdoor}
          hint="Outdoor seating service"
        />
      </div>

      {q.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Receipt className="mx-auto mb-3 h-8 w-8 opacity-50" />
            No orders match this view.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((order) => {
            const details = parseOrderNotes(order.notes);
            return (
              <article
                key={order.id}
                className="group flex flex-col rounded-xl border border-border bg-card/60 p-4 text-left shadow-card transition hover:border-primary/50 hover:shadow-ember"
              >
                <button
                  type="button"
                  onClick={() =>
                    nav({
                      to: "/receipt/$orderId",
                      params: { orderId: order.id },
                      search: { placed: false },
                    })
                  }
                  className="text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="font-mono text-sm text-muted-foreground">
                          {order.order_no}
                        </div>
                        <ChannelBadge channel={getOrderChannel(order)} />
                        {order.dining_type === "delivery" && <DeliveryBadge />}
                      </div>
                      <div className="font-display text-lg">
                        {order.customer_name ||
                          (order.table_label ? `Table ${order.table_label}` : "Walk-in")}
                      </div>
                      {order.customer_phone && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {order.customer_phone}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <PayBadge status={order.payment_status} />
                      <StatusBadge status={order.status} />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 capitalize">
                      {formatDiningTypeLabel(order)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(order.created_at)}
                    </span>
                    {order.kot_print_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-success">
                        <ChefHat className="h-3 w-3" />
                        KOT x{order.kot_print_count}
                      </span>
                    )}
                  </div>
                </button>

                <OrderDetails details={details} />

                <div className="mt-4 flex items-end justify-between">
                  <div className="text-xs text-muted-foreground">
                    {order.payment_status === "paid" && isToFulfill(order.status) ? (
                      <span className="text-success">Paid, waiting to complete</span>
                    ) : order.payment_status !== "paid" && order.payment_status !== "refunded" ? (
                      <span>
                        Outstanding{" "}
                        <span className="font-mono text-primary">
                          {formatMoney(
                            Math.max(0, Number(order.grand_total) - Number(order.amount_paid)),
                            symbol,
                          )}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-xl text-primary">
                    {formatMoney(order.grand_total, symbol)}
                  </div>
                </div>
                <OrderStatusActions
                  order={order}
                  updating={updatingOrderId === order.id}
                  onUpdate={(status) => updateOrderStatus(order, status)}
                  onOpen={() =>
                    nav({
                      to: "/receipt/$orderId",
                      params: { orderId: order.id },
                      search: { placed: false },
                    })
                  }
                />
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderQueueCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof ChefHat;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Card className="bg-card/60 shadow-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl text-primary">{value}</span>
            <span className="truncate text-xs text-muted-foreground">{hint}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function normalizeOrderDateRange(from: string | undefined, to: string | undefined, fallback: string) {
  const start = isDateInputValue(from) ? from : fallback;
  const end = isDateInputValue(to) ? to : start;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function isDateInputValue(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatOrderPeriodLabel(from: string, to: string) {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };
  if (from === to) return formatPakistanDateLabel(from, options);
  return `${formatPakistanDateLabel(from, options)} to ${formatPakistanDateLabel(to, options)}`;
}

function OrderDetails({ details }: { details: { address: string; notes: string } }) {
  if (!details.address && !details.notes) return null;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-background/35 p-3 text-xs text-muted-foreground">
      {details.address && (
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="line-clamp-2">{details.address}</span>
        </div>
      )}
      {details.notes && (
        <div className="flex items-start gap-2">
          <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="line-clamp-2">{details.notes}</span>
        </div>
      )}
    </div>
  );
}

function OrderStatusActions({
  order,
  updating,
  onUpdate,
  onOpen,
}: {
  order: OrderRow;
  updating: boolean;
  onUpdate: (status: OrderStatus) => void;
  onOpen: () => void;
}) {
  const nextStatus = nextFulfillmentStatus(order);
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={onOpen}>
        Open
      </Button>
      {order.customer_phone && (
        <Button type="button" variant="outline" size="sm" className="h-8" asChild>
          <a href={orderWhatsAppUrl(order)} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-2 h-3.5 w-3.5" />
            WhatsApp
          </a>
        </Button>
      )}
      {nextStatus && (
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={updating}
          onClick={() => onUpdate(nextStatus)}
        >
          {updating && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {nextStatusLabel(order, nextStatus)}
        </Button>
      )}
    </div>
  );
}

function nextFulfillmentStatus(order: OrderRow): OrderStatus | null {
  if (TERMINAL_ORDER_STATUSES.includes(order.status)) return null;
  if (order.status === "open" || order.status === "placed") return "preparing";
  if (order.status === "preparing") return "ready";
  if (order.status === "ready") {
    return isTableService(order) ? "served" : "completed";
  }
  if (order.status === "served") return "completed";
  return null;
}

function nextStatusLabel(order: OrderRow, status: OrderStatus) {
  if (status === "preparing") return "Start preparing";
  if (status === "ready") return order.dining_type === "delivery" ? "Ready to dispatch" : "Mark ready";
  if (status === "served") return "Mark served";
  if (status === "completed") {
    if (order.dining_type === "delivery") return "Mark delivered";
    if (order.dining_type === "takeaway") return "Picked up";
    return "Complete";
  }
  return status.replace("_", " ");
}

function parseOrderNotes(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { address: "", notes: "" };

  const lines = raw.split(/\r?\n/);
  const addressLine = lines.find((line) => /^(delivery address|address):/i.test(line));
  const notesLine = lines.find((line) => /^notes:/i.test(line));
  if (addressLine || notesLine) {
    return {
      address: addressLine?.replace(/^(delivery address|address):\s*/i, "").trim() ?? "",
      notes: notesLine?.replace(/^notes:\s*/i, "").trim() ?? "",
    };
  }

  return { address: "", notes: raw };
}

function isTableService(order: OrderRow) {
  return order.dining_type === "dine_in" || order.dining_type === "outdoor";
}

function formatDiningTypeLabel(order: OrderRow) {
  if (order.dining_type === "dine_in" && order.table_label) return `T-${order.table_label}`;
  if (order.dining_type === "outdoor" && order.table_label) return `Outdoor · ${order.table_label}`;
  return order.dining_type.replace("_", " ");
}

function orderWhatsAppUrl(order: OrderRow) {
  const normalized = normalizePhone(order.customer_phone ?? "");
  const message = buildOrderWhatsAppMessage(order);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

function buildOrderWhatsAppMessage(order: OrderRow) {
  const customerName = order.customer_name?.trim();
  const greeting = customerName ? `Assalam o Alaikum ${customerName},` : "Assalam o Alaikum,";
  const total = Number(order.grand_total || 0).toLocaleString("en-PK", {
    maximumFractionDigits: 0,
  });
  const context =
    order.dining_type === "delivery"
      ? "delivery order"
      : order.dining_type === "outdoor"
        ? "outdoor order"
        : order.dining_type === "dine_in"
          ? "dine-in order"
          : "takeaway order";

  if (order.status === "ready") {
    const line =
      order.dining_type === "delivery"
        ? "Your order is ready and will be dispatched shortly."
        : "Your order is ready for pickup.";
    return `${greeting}\n${line}\nOrder: ${order.order_no}\nTotal: Rs ${total}\n\nAngaar Kitchen`;
  }
  if (order.status === "preparing") {
    return `${greeting}\nYour ${context} ${order.order_no} is being prepared fresh.\nTotal: Rs ${total}\n\nAngaar Kitchen`;
  }
  if (order.status === "completed") {
    const line =
      order.dining_type === "delivery"
        ? "Your order has been marked delivered. Thank you for ordering from us."
        : "Thank you for ordering from Angaar Kitchen.";
    return `${greeting}\n${line}\nOrder: ${order.order_no}\n\nAngaar Kitchen`;
  }

  return `${greeting}\nWe have received your ${context} ${order.order_no}.\nTotal: Rs ${total}\nWe will update you shortly.\n\nAngaar Kitchen`;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

function getOrderChannel(order: OrderRow): OrderChannel {
  if (!order.created_by && order.dining_type !== "dine_in" && order.dining_type !== "outdoor")
    return "website";
  return "pos";
}

function isToFulfill(status: OrderStatus) {
  return !TERMINAL_ORDER_STATUSES.includes(status);
}

function CountChip({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">
      {n}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: OrderChannel }) {
  const map: Record<OrderChannel, { cls: string; label: string }> = {
    website: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Website" },
    pos: { cls: "bg-muted text-muted-foreground border-border", label: "POS" },
  };
  const m = map[channel];
  return (
    <Badge variant="outline" className={`${m.cls} text-[10px] font-medium`}>
      {m.label}
    </Badge>
  );
}

function DeliveryBadge() {
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/30 bg-emerald-500/15 text-[10px] font-medium text-emerald-300"
    >
      Delivery
    </Badge>
  );
}

function PayBadge({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { cls: string; label: string }> = {
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
