import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  CreditCard,
  Crown,
  Gift,
  History,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCcw,
  Search,
  ShieldAlert,
  Star,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import {
  listCustomersPostgres,
  mergeCustomersPostgres,
  recalculateCustomerStatsPostgres,
} from "@/lib/customers.postgres.functions";
import { hasPermission } from "@/lib/rbac";
import { getLoyaltySnapshot, LOYALTY_POINT_SPEND } from "@/lib/loyalty";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customers")({ component: CustomersPage });

type CustomerRow = {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  name: string | null;
  primary_phone: string;
  phone_normalized: string;
  email: string | null;
  default_address: string | null;
  notes: string | null;
  spice_preference: string | null;
  is_vip: boolean;
  is_blocked: boolean;
  first_order_at: string | null;
  last_order_at: string | null;
  total_orders: number | string;
  total_spent: number | string;
  created_at: string;
  updated_at: string;
};

type CustomerAddressRow = {
  id: string;
  customer_id: string;
  label: string;
  address: string;
  area: string | null;
  city: string | null;
  instructions: string | null;
  is_default: boolean;
  created_at: string;
};

type CustomerOrderRow = {
  id: string;
  order_no: string;
  dining_type: string;
  status: string;
  payment_status: string;
  grand_total: number | string;
  amount_paid: number | string;
  created_at: string;
};

type CustomerDueOrderRow = Pick<
  CustomerOrderRow,
  "id" | "status" | "payment_status" | "grand_total" | "amount_paid" | "created_at"
> & {
  customer_id: string | null;
};

type CustomerDue = {
  amount: number;
  orders: number;
  lastOrderAt: string | null;
};

type PaymentMethod = "cash" | "card" | "upi" | "wallet" | "other";

type CustomerEventRow = {
  id: string;
  event_type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type CustomerForm = {
  name: string;
  primary_phone: string;
  email: string;
  default_address: string;
  notes: string;
  spice_preference: string;
  is_vip: boolean;
  is_blocked: boolean;
};

type CustomerSegment = "all" | "vip" | "high_value" | "inactive" | "blocked" | "no_address";

type CustomerInsights = {
  repeatCustomers: number;
  repeatRate: number;
  newThisMonth: number;
  topCustomers: CustomerRow[];
  followUpCustomers: CustomerRow[];
};

const SEGMENTS: Array<{ value: CustomerSegment; label: string }> = [
  { value: "all", label: "All" },
  { value: "vip", label: "VIP" },
  { value: "high_value", label: "High value" },
  { value: "inactive", label: "Inactive" },
  { value: "blocked", label: "Blocked" },
  { value: "no_address", label: "No address" },
];

function CustomersPage() {
  const { restaurant, branch } = useActiveBranch();
  const { session } = useAuth();
  const { data: roles } = useMyRoles();
  const qc = useQueryClient();
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const canManage = hasPermission(roles, "customers:manage");
  const canSettlePayments = hasPermission(roles, "pos:use") || hasPermission(roles, "orders:manage");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [segment, setSegment] = useState<CustomerSegment>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [clearingDues, setClearingDues] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const q = useQuery({
    queryKey: ["customers-list", restaurant?.id, debouncedSearch],
    enabled: !!restaurant?.id,
    refetchInterval: 15000,
    queryFn: async () => {
      if (isPostgresAuthEnabled()) {
        return (await listCustomersPostgres({
          data: {
            restaurantId: restaurant!.id,
            search: debouncedSearch,
          },
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        })) as CustomerRow[];
      }

      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, restaurant_id, branch_id, name, primary_phone, phone_normalized, email, default_address, notes, spice_preference, is_vip, is_blocked, first_order_at, last_order_at, total_orders, total_spent, created_at, updated_at",
        )
        .eq("restaurant_id", restaurant!.id)
        .order("last_order_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerRow[];
    },
  });

  const cutoffQ = useQuery({
    queryKey: ["customer-dues-cutoff", branch?.id],
    enabled: !!branch?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, customer_dues_cutoff_at")
        .eq("id", branch!.id)
        .single();
      if (error) throw error;
      return data as { id: string; customer_dues_cutoff_at: string | null };
    },
  });
  const duesCutoffAt = cutoffQ.data?.customer_dues_cutoff_at ?? null;

  const duesQ = useQuery({
    queryKey: ["customer-dues", branch?.id, duesCutoffAt],
    enabled: !!branch?.id,
    refetchInterval: 20000,
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("id, customer_id, status, payment_status, grand_total, amount_paid, created_at")
        .eq("branch_id", branch!.id)
        .in("payment_status", ["pending", "partial"]);
      if (duesCutoffAt) query = query.gte("created_at", duesCutoffAt);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as CustomerDueOrderRow[];
    },
  });

  const customers = useMemo(() => q.data ?? [], [q.data]);
  const duesByCustomer = useMemo(() => buildCustomerDues(duesQ.data ?? []), [duesQ.data]);
  const selectedCustomer = customers.find((customer) => customer.id === selectedId) ?? null;
  const segmentCounts = useMemo(() => buildSegmentCounts(customers), [customers]);
  const insights = useMemo(() => buildCustomerInsights(customers), [customers]);
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    const normalizedTerm = normalizePhone(term);
    return customers
      .filter((customer) => matchesSegment(customer, segment))
      .filter((customer) => {
        if (!term) return true;
        return [
          customer.name,
          customer.primary_phone,
          customer.phone_normalized,
          customer.email,
          customer.default_address,
          customer.notes,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term)) ||
          (!!normalizedTerm && customer.phone_normalized.includes(normalizedTerm));
      });
  }, [customers, debouncedSearch, segment]);

  const summary = useMemo(() => {
    const inactiveSince = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      total: customers.length,
      vip: customers.filter((customer) => customer.is_vip).length,
      blocked: customers.filter((customer) => customer.is_blocked).length,
      inactive: customers.filter(
        (customer) =>
          customer.last_order_at && new Date(customer.last_order_at).getTime() < inactiveSince,
      ).length,
      points: customers.reduce((sum, customer) => sum + getLoyaltySnapshot(customer).points, 0),
      pendingDue: Array.from(duesByCustomer.values()).reduce((sum, due) => sum + due.amount, 0),
      creditCustomers: duesByCustomer.size,
    };
  }, [customers, duesByCustomer]);

  async function refreshCustomerRecords() {
    if (!branch?.id) {
      toast.error("Select a branch first.");
      return;
    }
    setRefreshingRecords(true);
    try {
      const { data, error } = await supabase.rpc("backfill_customer_records", {
        _branch_id: branch.id,
      });
      if (error) throw new Error(error.message);
      const raw = data as
        | { linked?: number; customers?: number; data?: { linked?: number; customers?: number } }
        | null;
      const result = raw?.data ?? raw;
      toast.success(
        `Customer records refreshed: ${result?.linked ?? 0} order${result?.linked === 1 ? "" : "s"} linked.`,
      );
      qc.invalidateQueries({ queryKey: ["customers-list"] });
      qc.invalidateQueries({ queryKey: ["customer-dues"] });
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
      qc.invalidateQueries({ queryKey: ["customer-events"] });
    } catch (error) {
      toast.error(errorMessage(error, "Could not refresh customer records."));
    } finally {
      setRefreshingRecords(false);
    }
  }

  async function clearPendingDuesTillNow() {
    if (!branch?.id) {
      toast.error("Select a branch first.");
      return;
    }
    setClearingDues(true);
    try {
      const { data, error } = await supabase.rpc("clear_customer_dues_cutoff", {
        _branch_id: branch.id,
      });
      if (error) throw new Error(error.message);
      const raw = data as { cutoffAt?: string; data?: { cutoffAt?: string } } | null;
      const cutoffAt = raw?.data?.cutoffAt ?? raw?.cutoffAt;
      toast.success(`Pending payments will now track from ${formatDate(cutoffAt ?? new Date().toISOString())}.`);
      qc.invalidateQueries({ queryKey: ["customer-dues-cutoff"] });
      qc.invalidateQueries({ queryKey: ["customer-dues"] });
      qc.invalidateQueries({ queryKey: ["customer-orders"] });
    } catch (error) {
      toast.error(errorMessage(error, "Could not clear pending dues."));
    } finally {
      setClearingDues(false);
    }
  }

  if (!restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a restaurant first.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Guest profiles, order history, addresses, and service notes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 sm:w-80"
              placeholder="Search name, phone, address"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {canManage && (
            <>
              <Button variant="outline" onClick={refreshCustomerRecords} disabled={refreshingRecords}>
                <RefreshCcw
                  className={`mr-2 h-4 w-4 ${refreshingRecords ? "animate-spin" : ""}`}
                />
                Refresh records
              </Button>
              <CustomerCreateDialog
                restaurantId={restaurant.id}
                branchId={branch?.id ?? null}
                onCreated={(customer) => {
                  qc.invalidateQueries({ queryKey: ["customers-list"] });
                  setSelectedId(customer.id);
                }}
              />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/45 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending payment tracking
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {duesCutoffAt
              ? `Showing pending customer payments from ${formatDate(duesCutoffAt)} onward.`
              : "Showing all pending customer payments."}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={clearPendingDuesTillNow} disabled={clearingDues}>
          {clearingDues && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Clear till now
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total customers" value={summary.total} />
        <Metric label="Credit customers" value={summary.creditCustomers} />
        <Metric label="Pending dues" value={formatMoney(summary.pendingDue, symbol)} />
        <Metric label="Blocked" value={summary.blocked} />
      </div>

      <CustomerInsightsPanel
        insights={insights}
        symbol={symbol}
        canManage={canManage}
        onOpenCustomer={(customer) => setSelectedId(customer.id)}
        onShowInactive={() => setSegment("inactive")}
      />

      <div className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-card/40 p-2">
        {SEGMENTS.map((item) => (
          <button
            key={item.value}
            onClick={() => setSegment(item.value)}
            className={`shrink-0 rounded-md px-3 py-2 text-sm transition ${
              segment === item.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {item.label} <span className="font-mono">{segmentCounts[item.value]}</span>
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <UserRound className="mx-auto mb-3 h-8 w-8 opacity-50" />
            No customers found yet. New POS and website orders will create them automatically.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              symbol={symbol}
              due={duesByCustomer.get(customer.id)}
              onOpen={() => setSelectedId(customer.id)}
            />
          ))}
        </div>
      )}

      <CustomerSheet
        customer={selectedCustomer}
        customers={customers}
        canManage={canManage}
        canSettlePayments={canSettlePayments}
        symbol={symbol}
        due={selectedCustomer ? duesByCustomer.get(selectedCustomer.id) : undefined}
        duesCutoffAt={duesCutoffAt}
        open={!!selectedCustomer}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onEdit={() => setEditing(selectedCustomer)}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["customers-list"] });
          qc.invalidateQueries({ queryKey: ["customer-dues"] });
          qc.invalidateQueries({ queryKey: ["customer-pending-orders"] });
          qc.invalidateQueries({ queryKey: ["customer-addresses"] });
          qc.invalidateQueries({ queryKey: ["customer-orders"] });
          qc.invalidateQueries({ queryKey: ["customer-events"] });
        }}
      />

      <CustomerEditDialog
        customer={editing}
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["customers-list"] });
          qc.invalidateQueries({ queryKey: ["customer-events"] });
        }}
      />
    </div>
  );
}

function CustomerCreateDialog({
  restaurantId,
  branchId,
  onCreated,
}: {
  restaurantId: string;
  branchId: string | null;
  onCreated: (customer: CustomerRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const phone = form.primary_phone.trim();
    const phoneNormalized = normalizePhone(phone);
    if (!phone || !phoneNormalized) {
      toast.error("Customer phone is required.");
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .upsert(
          {
            restaurant_id: restaurantId,
            branch_id: branchId,
            name: nullable(form.name),
            primary_phone: phone,
            phone_normalized: phoneNormalized,
            email: nullable(form.email),
            default_address: nullable(form.default_address),
            notes: nullable(form.notes),
            spice_preference: nullable(form.spice_preference),
            is_vip: form.is_vip,
            is_blocked: form.is_blocked,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "restaurant_id,phone_normalized" },
        )
        .select(
          "id, restaurant_id, branch_id, name, primary_phone, phone_normalized, email, default_address, notes, spice_preference, is_vip, is_blocked, first_order_at, last_order_at, total_orders, total_spent, created_at, updated_at",
        )
        .single();
      if (error) throw new Error(error.message);

      const customer = data as CustomerRow;
      await recordCustomerEvent(customer, "customer_created", {
        phone,
        source: "manual",
      });
      toast.success("Customer saved");
      setForm(emptyCustomerForm());
      setOpen(false);
      onCreated(customer);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        New customer
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <CustomerFormFields form={form} setForm={setForm} />
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerCard({
  customer,
  symbol,
  due,
  onOpen,
}: {
  customer: CustomerRow;
  symbol: string;
  due?: CustomerDue;
  onOpen: () => void;
}) {
  const loyalty = getLoyaltySnapshot(customer);

  return (
    <button
      onClick={onOpen}
      className="rounded-lg border border-border bg-card/60 p-4 text-left shadow-card transition hover:border-primary/50 hover:bg-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl">
              {customer.name || "Unnamed customer"}
            </h2>
            <CustomerBadges customer={customer} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {customer.primary_phone || "No phone saved"}
            </span>
            {customer.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {customer.email}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg text-primary">
            {formatMoney(customer.total_spent, symbol)}
          </div>
          <div className="text-xs text-muted-foreground">
            {Number(customer.total_orders)} order
            {Number(customer.total_orders) === 1 ? "" : "s"}
          </div>
          {due && due.amount > 0 && (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-xs text-amber-300">
              Due {formatMoney(due.amount, symbol)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-background/35 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Gift className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{loyalty.label}</div>
              <div className="text-xs text-muted-foreground">
                {loyalty.points.toLocaleString()} estimated points
              </div>
            </div>
          </div>
          {loyalty.nextLabel && (
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              Next: {loyalty.nextLabel}
            </div>
          )}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${loyalty.progress}%` }}
          />
        </div>
      </div>

      {customer.default_address && (
        <div className="mt-4 line-clamp-2 rounded-md border border-border bg-background/35 p-3 text-sm text-muted-foreground">
          <MapPin className="mr-1 inline h-3.5 w-3.5 text-primary" />
          {customer.default_address}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" />
          Last order {formatDate(customer.last_order_at)}
        </span>
        {customer.notes && <span className="rounded-md bg-muted/40 px-2 py-1">{customer.notes}</span>}
      </div>
    </button>
  );
}

function CustomerInsightsPanel({
  insights,
  symbol,
  canManage,
  onOpenCustomer,
  onShowInactive,
}: {
  insights: CustomerInsights;
  symbol: string;
  canManage: boolean;
  onOpenCustomer: (customer: CustomerRow) => void;
  onShowInactive: () => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
      <Card className="bg-card/60 shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Customer intelligence
              </div>
              <h2 className="mt-1 font-display text-xl">Growth and repeat behavior</h2>
            </div>
            <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
              Live from orders
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Repeat guests" value={String(insights.repeatCustomers)} />
            <MiniStat label="Repeat rate" value={`${insights.repeatRate}%`} />
            <MiniStat label="New this month" value={String(insights.newThisMonth)} />
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <TrendingUp className="h-4 w-4 text-primary" />
                Top customers
              </div>
              <span className="text-xs text-muted-foreground">By lifetime spend</span>
            </div>
            {insights.topCustomers.length ? (
              <div className="space-y-2">
                {insights.topCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => onOpenCustomer(customer)}
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {customer.name || customer.primary_phone}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {Number(customer.total_orders || 0)} orders
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-sm text-primary">
                      {formatMoney(customer.total_spent, symbol)}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Top customers will appear after orders are linked to profiles.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/60 shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Follow-up queue
              </div>
              <h2 className="mt-1 font-display text-xl">Guests to bring back</h2>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onShowInactive}>
              View inactive
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {insights.followUpCustomers.length ? (
              insights.followUpCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="rounded-lg border border-border bg-background/35 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenCustomer(customer)}
                      className="min-w-0 text-left"
                    >
                      <div className="truncate text-sm font-medium">
                        {customer.name || customer.primary_phone}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{Number(customer.total_orders || 0)} orders</span>
                        <span>{formatMoney(customer.total_spent, symbol)}</span>
                      </div>
                    </button>
                    {canManage && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        asChild
                        onClick={() => {
                          void recordCustomerEvent(customer, "whatsapp_opened", {
                            phone: customer.primary_phone,
                            source: "follow_up_queue",
                          }).catch((error) => {
                            toast.error(
                              error instanceof Error ? error.message : "Could not log WhatsApp",
                            );
                          });
                        }}
                      >
                        <a href={whatsappUrl(customer)} target="_blank" rel="noreferrer">
                          <MessageCircle className="mr-2 h-4 w-4" />
                          WhatsApp
                        </a>
                      </Button>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    Last order {customer.last_order_at ? formatDate(customer.last_order_at) : "not recorded"}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                No inactive customers need follow-up right now.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerSheet({
  customer,
  customers,
  canManage,
  canSettlePayments,
  symbol,
  due,
  duesCutoffAt,
  open,
  onOpenChange,
  onEdit,
  onChanged,
}: {
  customer: CustomerRow | null;
  customers: CustomerRow[];
  canManage: boolean;
  canSettlePayments: boolean;
  symbol: string;
  due?: CustomerDue;
  duesCutoffAt?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [paymentOrder, setPaymentOrder] = useState<CustomerOrderRow | null>(null);
  const ordersQ = useQuery({
    queryKey: ["customer-orders", customer?.id],
    enabled: !!customer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_no, dining_type, status, payment_status, grand_total, amount_paid, created_at",
        )
        .eq("customer_id", customer!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as CustomerOrderRow[];
    },
  });

  const pendingOrdersQ = useQuery({
    queryKey: ["customer-pending-orders", customer?.id, duesCutoffAt],
    enabled: !!customer?.id,
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select(
          "id, order_no, dining_type, status, payment_status, grand_total, amount_paid, created_at",
        )
        .eq("customer_id", customer!.id)
        .in("payment_status", ["pending", "partial"]);
      if (duesCutoffAt) query = query.gte("created_at", duesCutoffAt);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as CustomerOrderRow[];
    },
  });

  const addressesQ = useQuery({
    queryKey: ["customer-addresses", customer?.id],
    enabled: !!customer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_addresses")
        .select("id, customer_id, label, address, area, city, instructions, is_default, created_at")
        .eq("customer_id", customer!.id)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerAddressRow[];
    },
  });

  const eventsQ = useQuery({
    queryKey: ["customer-events", customer?.id],
    enabled: !!customer?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_events")
        .select("id, event_type, meta, created_at")
        .eq("customer_id", customer!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as CustomerEventRow[];
    },
  });

  const pendingOrders = useMemo(
    () =>
      (pendingOrdersQ.data ?? []).filter(
        (order) => outstandingAmount(order) > 0 && isCollectibleOrder(order),
      ),
    [pendingOrdersQ.data],
  );

  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">
            {customer.name || "Unnamed customer"}
          </SheetTitle>
          <SheetDescription>{customer.primary_phone || "No phone saved"}</SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <CustomerBadges customer={customer} />
                <InfoLine icon={Phone} text={customer.primary_phone || "No phone saved"} />
                {customer.email && <InfoLine icon={Mail} text={customer.email} />}
                {customer.default_address && <InfoLine icon={MapPin} text={customer.default_address} />}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-2">
                  {normalizePhone(customer.primary_phone) && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={whatsappUrl(customer)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          void recordCustomerEvent(customer, "whatsapp_opened", {
                            phone: customer.phone_normalized || normalizePhone(customer.primary_phone),
                          })
                            .then(onChanged)
                            .catch(() => undefined);
                        }}
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        WhatsApp
                      </a>
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    Edit
                  </Button>
                  <CustomerMergeDialog
                    customer={customer}
                    candidates={customers}
                    symbol={symbol}
                    onMerged={onChanged}
                  />
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniStat label="Orders" value={Number(customer.total_orders).toLocaleString()} />
              <MiniStat label="Spent" value={formatMoney(customer.total_spent, symbol)} />
              <MiniStat label="Pending due" value={formatMoney(due?.amount ?? 0, symbol)} />
              <MiniStat label="Credit orders" value={String(due?.orders ?? 0)} />
              <MiniStat label="First order" value={formatDate(customer.first_order_at)} />
              <MiniStat label="Last order" value={formatDate(customer.last_order_at)} />
            </div>
          </div>

          <section className="space-y-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CreditCard className="h-4 w-4 text-amber-300" />
                Pending payments
              </h3>
              <Badge variant={pendingOrders.length ? "outline" : "secondary"}>
                {pendingOrders.length
                  ? `${formatMoney(pendingOrders.reduce((sum, order) => sum + outstandingAmount(order), 0), symbol)} due`
                  : "Clear"}
              </Badge>
            </div>
            {pendingOrdersQ.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : pendingOrders.length ? (
              <div className="space-y-2">
                {pendingOrders.map((order) => (
                  <div key={order.id} className="rounded-lg border border-border bg-background/45 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm">{order.order_no}</span>
                          <Badge variant="outline" className="capitalize">
                            {order.status}
                          </Badge>
                          <Badge variant="secondary" className="capitalize">
                            {order.payment_status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs capitalize text-muted-foreground">
                          {order.dining_type.replace("_", " ")} - {formatDate(order.created_at)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm text-amber-300">
                          {formatMoney(outstandingAmount(order), symbol)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          of {formatMoney(order.grand_total, symbol)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/receipt/${order.id}`}>Open receipt</a>
                      </Button>
                      {canSettlePayments && (
                        <Button size="sm" onClick={() => setPaymentOrder(order)}>
                          Record payment
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No pending dues for this customer.
              </div>
            )}
          </section>

          <LoyaltyPanel customer={customer} symbol={symbol} canManage={canManage} onChanged={onChanged} />

          {(customer.spice_preference || customer.notes) && (
            <section className="rounded-lg border border-border bg-background/35 p-4">
              <h3 className="mb-2 text-sm font-semibold">Service notes</h3>
              {customer.spice_preference && (
                <p className="text-sm text-muted-foreground">Spice: {customer.spice_preference}</p>
              )}
              {customer.notes && <p className="mt-1 text-sm text-muted-foreground">{customer.notes}</p>}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="h-4 w-4 text-primary" />
                Addresses
              </h3>
              {canManage && <AddressDialog customer={customer} onSaved={onChanged} />}
            </div>
            {addressesQ.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : addressesQ.data?.length ? (
              <div className="space-y-2">
                {addressesQ.data.map((address) => (
                  <div key={address.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {address.label}
                      {address.is_default && <Badge variant="outline">Default</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{address.address}</div>
                    {address.instructions && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Instructions: {address.instructions}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No saved addresses yet.
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" />
              Recent orders
            </h3>
            {ordersQ.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : ordersQ.data?.length ? (
              <div className="space-y-2">
                {ordersQ.data.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm">{order.order_no}</span>
                        <Badge variant="outline" className="capitalize">
                          {order.status}
                        </Badge>
                        <Badge variant="secondary" className="capitalize">
                          {order.payment_status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs capitalize text-muted-foreground">
                        {order.dining_type.replace("_", " ")} - {formatDate(order.created_at)}
                      </div>
                      {outstandingAmount(order) > 0 && isCollectibleOrder(order) && (
                        <div className="mt-1 text-xs text-amber-300">
                          Due {formatMoney(outstandingAmount(order), symbol)}
                        </div>
                      )}
                    </div>
                    <div className="font-mono text-sm text-primary">
                      {formatMoney(order.grand_total, symbol)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No linked orders yet.
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-primary" />
              Customer timeline
            </h3>
            {eventsQ.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : eventsQ.data?.length ? (
              <div className="space-y-2">
                {eventsQ.data.map((event) => (
                  <div key={event.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{eventLabel(event.event_type)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(event.created_at)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {eventSummary(event)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No timeline events yet.
              </div>
            )}
          </section>
        </div>
        <CustomerPaymentDialog
          order={paymentOrder}
          symbol={symbol}
          open={!!paymentOrder}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setPaymentOrder(null);
          }}
          onRecorded={() => {
            setPaymentOrder(null);
            onChanged();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function CustomerEditDialog({
  customer,
  open,
  onOpenChange,
  onSaved,
}: {
  customer: CustomerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustomerForm>(() => customerToForm(customer));

  useEffect(() => {
    setForm(customerToForm(customer));
  }, [customer]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!customer) return;
    const phone = form.primary_phone.trim();
    const phoneNormalized = normalizePhone(phone);
    if (!phone || !phoneNormalized) {
      toast.error("Customer phone is required.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({
          name: nullable(form.name),
          primary_phone: phone,
          phone_normalized: phoneNormalized,
          email: nullable(form.email),
          default_address: nullable(form.default_address),
          notes: nullable(form.notes),
          spice_preference: nullable(form.spice_preference),
          is_vip: form.is_vip,
          is_blocked: form.is_blocked,
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id);
      if (error) throw new Error(error.message);
      await recordCustomerEvent(customer, "profile_updated", {
        name: nullable(form.name),
        phone,
        vip: form.is_vip,
        blocked: form.is_blocked,
      });
      toast.success("Customer updated");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit customer</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <CustomerFormFields form={form} setForm={setForm} />
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save customer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerMergeDialog({
  customer,
  candidates,
  symbol,
  onMerged,
}: {
  customer: CustomerRow;
  candidates: CustomerRow[];
  symbol: string;
  onMerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const term = search.trim().toLowerCase();
    return candidates
      .filter((candidate) => candidate.id !== customer.id)
      .filter((candidate) => {
        if (!term) return true;
        return [
          candidate.name,
          candidate.primary_phone,
          candidate.phone_normalized,
          candidate.email,
          candidate.default_address,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((left, right) => duplicateCandidateScore(customer, right) - duplicateCandidateScore(customer, left))
      .slice(0, 8);
  }, [candidates, customer, search]);

  const selected = candidates.find((candidate) => candidate.id === sourceId) ?? null;

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSourceId("");
    }
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      toast.error("Choose the duplicate customer to merge.");
      return;
    }
    if (!isPostgresAuthEnabled()) {
      toast.error("Customer merge is available after PostgreSQL migration.");
      return;
    }

    setSaving(true);
    try {
      const result = await mergeCustomersPostgres({
        data: {
          targetCustomerId: customer.id,
          sourceCustomerId: selected.id,
        },
      });
      toast.success(
        `Merged ${result.movedOrders} order${result.movedOrders === 1 ? "" : "s"} into ${customer.name || customer.primary_phone}`,
      );
      setOpen(false);
      onMerged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not merge customers");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Merge
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge duplicate customer</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-border bg-background/35 p-4 text-sm">
            <div className="font-medium">Keep this profile</div>
            <div className="mt-1 text-muted-foreground">
              {customer.name || "Unnamed customer"} - {customer.primary_phone}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              The selected duplicate will be removed after its orders, addresses, and timeline are
              moved into this profile.
            </p>
          </div>

          <Field label="Find duplicate customer">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, phone, or address"
            />
          </Field>

          <div className="space-y-2">
            {options.length ? (
              options.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setSourceId(candidate.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    sourceId === candidate.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {candidate.name || "Unnamed customer"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {candidate.primary_phone}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{Number(candidate.total_orders)} orders</div>
                      <div>{formatMoney(candidate.total_spent, symbol)}</div>
                    </div>
                  </div>
                  {candidate.default_address && (
                    <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {candidate.default_address}
                    </div>
                  )}
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No matching duplicate customers found.
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
              Confirm merge from {selected.name || selected.primary_phone}. This action moves data
              into the kept profile and deletes the duplicate profile.
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={saving || !selected}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Merge duplicate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerFormFields({
  form,
  setForm,
}: {
  form: CustomerForm;
  setForm: (form: CustomerForm) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="Phone">
          <Input
            value={form.primary_phone}
            onChange={(event) => setForm({ ...form, primary_phone: event.target.value })}
            required
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>
        <Field label="Spice preference">
          <Input
            placeholder="Normal, less spicy, extra spicy"
            value={form.spice_preference}
            onChange={(event) => setForm({ ...form, spice_preference: event.target.value })}
          />
        </Field>
        <Field label="Default address" className="sm:col-span-2">
          <Textarea
            value={form.default_address}
            onChange={(event) => setForm({ ...form, default_address: event.target.value })}
          />
        </Field>
        <Field label="Internal notes" className="sm:col-span-2">
          <Textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ToggleRow
          label="VIP customer"
          checked={form.is_vip}
          onCheckedChange={(is_vip) => setForm({ ...form, is_vip })}
        />
        <ToggleRow
          label="Block customer"
          checked={form.is_blocked}
          onCheckedChange={(is_blocked) => setForm({ ...form, is_blocked })}
        />
      </div>
    </>
  );
}

function CustomerPaymentDialog({
  order,
  symbol,
  open,
  onOpenChange,
  onRecorded,
}: {
  order: CustomerOrderRow | null;
  symbol: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}) {
  const remaining = order ? outstandingAmount(order) : 0;
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && order) {
      setMethod("cash");
      setAmount(outstandingAmount(order).toFixed(2));
      setReference("");
    }
  }, [open, order]);

  async function submit() {
    if (!order) return;
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      toast.error("Enter a valid payment amount.");
      return;
    }
    if (paymentAmount > remaining) {
      toast.error("Payment cannot be more than the pending balance from this profile.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("record_payment", {
        _order_id: order.id,
        _method: method,
        _amount: paymentAmount,
        _reference: reference || "Customer profile settlement",
      });
      if (error) throw new Error(error.message);
      toast.success(`Payment recorded for ${order.order_no}`);
      onRecorded();
    } catch (error) {
      toast.error(errorMessage(error, "Could not record payment."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record customer payment</DialogTitle>
          <DialogDescription>
            This settles the payment balance for the selected order. Delivery and kitchen status stay unchanged.
          </DialogDescription>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono">{order.order_no}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Grand total</span>
                <span className="font-mono">{formatMoney(order.grand_total, symbol)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Already paid</span>
                <span className="font-mono">{formatMoney(order.amount_paid, symbol)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Pending</span>
                <span className="font-mono text-amber-300">{formatMoney(remaining, symbol)}</span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Method">
                <Select value={method} onValueChange={(value: PaymentMethod) => setMethod(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="font-mono"
                />
              </Field>
            </div>

            <Field label="Reference">
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Optional note, transaction ID, or staff note"
              />
            </Field>

            {Number(amount) > remaining && (
              <p className="flex items-center gap-2 text-sm text-amber-300">
                <AlertCircle className="h-4 w-4" />
                Use the receipt screen if you need to handle overpayment or change return.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !order}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddressDialog({ customer, onSaved }: { customer: CustomerRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("Delivery");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim()) {
      toast.error("Address is required.");
      return;
    }

    setSaving(true);
    try {
      if (isDefault) {
        const { error: resetError } = await supabase
          .from("customer_addresses")
          .update({ is_default: false, updated_at: new Date().toISOString() })
          .eq("customer_id", customer.id);
        if (resetError) throw new Error(resetError.message);
      }

      const { error } = await supabase.from("customer_addresses").upsert(
        {
          customer_id: customer.id,
          label: label.trim() || "Delivery",
          address: address.trim(),
          instructions: nullable(instructions),
          is_default: isDefault,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "customer_id,address" },
      );
      if (error) throw new Error(error.message);

      if (isDefault) {
        const { error: updateError } = await supabase
          .from("customers")
          .update({
            default_address: address.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", customer.id);
        if (updateError) throw new Error(updateError.message);
      }
      await recordCustomerEvent(customer, "address_saved", {
        label: label.trim() || "Delivery",
        address: address.trim(),
        default: isDefault,
      });

      toast.success("Address saved");
      setOpen(false);
      setLabel("Delivery");
      setAddress("");
      setInstructions("");
      setIsDefault(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save address");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add address
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add customer address</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Label">
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label="Address">
            <Textarea
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              required
            />
          </Field>
          <Field label="Delivery instructions">
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </Field>
          <ToggleRow label="Set as default" checked={isDefault} onCheckedChange={setIsDefault} />
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save address
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerBadges({ customer }: { customer: CustomerRow }) {
  const loyalty = getLoyaltySnapshot(customer);

  return (
    <>
      <Badge variant="outline" className={loyalty.badgeClassName}>
        <Star className="mr-1 h-3 w-3" />
        {loyalty.label}
      </Badge>
      {customer.is_vip && loyalty.label !== "VIP" && (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 text-amber-300">
          <Crown className="mr-1 h-3 w-3" />
          VIP
        </Badge>
      )}
      {customer.is_blocked && loyalty.label !== "Blocked" && (
        <Badge variant="destructive">
          <ShieldAlert className="mr-1 h-3 w-3" />
          Blocked
        </Badge>
      )}
    </>
  );
}

function LoyaltyPanel({
  customer,
  symbol,
  canManage,
  onChanged,
}: {
  customer: CustomerRow;
  symbol: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const loyalty = getLoyaltySnapshot(customer);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshStats() {
    if (!isPostgresAuthEnabled()) {
      toast.error("Loyalty refresh is available after PostgreSQL migration.");
      return;
    }

    setRefreshing(true);
    try {
      await recalculateCustomerStatsPostgres({ data: { customerId: customer.id } });
      toast.success("Customer loyalty totals refreshed");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh loyalty totals");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="h-4 w-4 text-primary" />
            Loyalty
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Rs {LOYALTY_POINT_SPEND.toLocaleString()} in paid completed orders earns 1 point.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className={loyalty.badgeClassName}>
            {loyalty.label}
          </Badge>
          {canManage && (
            <Button type="button" variant="outline" size="sm" onClick={refreshStats} disabled={refreshing}>
              {refreshing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Refresh
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat label="Points" value={loyalty.points.toLocaleString()} />
        <MiniStat
          label={loyalty.nextLabel ? `To ${loyalty.nextLabel}` : "Top tier"}
          value={
            loyalty.nextLabel
              ? formatMoney(loyalty.amountToNext, symbol)
              : "Unlocked"
          }
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Tier progress</span>
          <span>{loyalty.progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${loyalty.progress}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-background/35 p-3 text-xs leading-5 text-muted-foreground">
        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>{loyalty.insight}</span>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="bg-card/60 shadow-card">
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 font-mono text-2xl text-primary">{value}</div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm">{value}</div>
    </div>
  );
}

function InfoLine({ icon: Icon, text }: { icon: typeof Phone; text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function customerToForm(customer: CustomerRow | null): CustomerForm {
  return {
    name: customer?.name ?? "",
    primary_phone: customer?.primary_phone ?? "",
    email: customer?.email ?? "",
    default_address: customer?.default_address ?? "",
    notes: customer?.notes ?? "",
    spice_preference: customer?.spice_preference ?? "",
    is_vip: customer?.is_vip ?? false,
    is_blocked: customer?.is_blocked ?? false,
  };
}

function emptyCustomerForm(): CustomerForm {
  return {
    name: "",
    primary_phone: "",
    email: "",
    default_address: "",
    notes: "",
    spice_preference: "",
    is_vip: false,
    is_blocked: false,
  };
}

function buildCustomerDues(orders: CustomerDueOrderRow[]) {
  const dues = new Map<string, CustomerDue>();
  for (const order of orders) {
    if (!order.customer_id || !isCollectibleOrder(order)) continue;
    const amount = outstandingAmount(order);
    if (amount <= 0) continue;
    const current = dues.get(order.customer_id) ?? {
      amount: 0,
      orders: 0,
      lastOrderAt: null,
    };
    current.amount += amount;
    current.orders += 1;
    if (
      !current.lastOrderAt ||
      new Date(order.created_at).getTime() > new Date(current.lastOrderAt).getTime()
    ) {
      current.lastOrderAt = order.created_at;
    }
    dues.set(order.customer_id, current);
  }
  return dues;
}

function outstandingAmount(order: Pick<CustomerOrderRow, "grand_total" | "amount_paid">) {
  return Math.max(0, Number(order.grand_total || 0) - Number(order.amount_paid || 0));
}

function isCollectibleOrder(order: Pick<CustomerOrderRow, "status" | "payment_status">) {
  if (order.payment_status === "paid" || order.payment_status === "refunded") return false;
  return !["cancelled", "voided", "refunded"].includes(order.status);
}

function buildSegmentCounts(customers: CustomerRow[]) {
  return SEGMENTS.reduce(
    (counts, item) => {
      counts[item.value] = customers.filter((customer) => matchesSegment(customer, item.value))
        .length;
      return counts;
    },
    {} as Record<CustomerSegment, number>,
  );
}

function matchesSegment(customer: CustomerRow, segment: CustomerSegment) {
  if (segment === "all") return true;
  if (segment === "vip") return customer.is_vip;
  if (segment === "blocked") return customer.is_blocked;
  if (segment === "no_address") return !customer.default_address;
  if (segment === "high_value") {
    return Number(customer.total_spent) >= 5000 || Number(customer.total_orders) >= 5;
  }
  if (segment === "inactive") {
    if (!customer.last_order_at) return false;
    return new Date(customer.last_order_at).getTime() < Date.now() - 30 * 24 * 60 * 60 * 1000;
  }
  return true;
}

function buildCustomerInsights(customers: CustomerRow[]): CustomerInsights {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const inactiveCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const customersWithOrders = customers.filter((customer) => Number(customer.total_orders || 0) > 0);
  const repeatCustomers = customers.filter((customer) => Number(customer.total_orders || 0) >= 2)
    .length;
  const repeatRate = customersWithOrders.length
    ? Math.round((repeatCustomers / customersWithOrders.length) * 100)
    : 0;

  const topCustomers = [...customers]
    .filter((customer) => !customer.is_blocked && Number(customer.total_spent || 0) > 0)
    .sort((first, second) => {
      const spendDiff = Number(second.total_spent || 0) - Number(first.total_spent || 0);
      if (spendDiff !== 0) return spendDiff;
      return Number(second.total_orders || 0) - Number(first.total_orders || 0);
    })
    .slice(0, 5);

  const followUpCustomers = [...customers]
    .filter(
      (customer) =>
        !customer.is_blocked &&
        !!customer.last_order_at &&
        new Date(customer.last_order_at).getTime() < inactiveCutoff,
    )
    .sort((first, second) => {
      const firstLastOrder = first.last_order_at ? new Date(first.last_order_at).getTime() : 0;
      const secondLastOrder = second.last_order_at ? new Date(second.last_order_at).getTime() : 0;
      if (firstLastOrder !== secondLastOrder) return firstLastOrder - secondLastOrder;
      return Number(second.total_spent || 0) - Number(first.total_spent || 0);
    })
    .slice(0, 5);

  return {
    repeatCustomers,
    repeatRate,
    newThisMonth: customers.filter(
      (customer) => new Date(customer.created_at).getTime() >= monthStart,
    ).length,
    topCustomers,
    followUpCustomers,
  };
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function duplicateCandidateScore(target: CustomerRow, candidate: CustomerRow) {
  let score = 0;
  const targetDigits = target.primary_phone.replace(/\D/g, "");
  const candidateDigits = candidate.primary_phone.replace(/\D/g, "");
  if (target.phone_normalized && target.phone_normalized === candidate.phone_normalized) score += 100;
  if (targetDigits && targetDigits === candidateDigits) score += 80;
  if (target.name && candidate.name && target.name.toLowerCase() === candidate.name.toLowerCase()) {
    score += 30;
  }
  if (
    target.default_address &&
    candidate.default_address &&
    target.default_address.toLowerCase() === candidate.default_address.toLowerCase()
  ) {
    score += 20;
  }
  return score + Number(candidate.total_orders || 0);
}

function whatsappUrl(customer: CustomerRow) {
  const phone = customer.phone_normalized || normalizePhone(customer.primary_phone);
  return `https://wa.me/${phone}`;
}

async function recordCustomerEvent(
  customer: CustomerRow,
  eventType: string,
  meta: Record<string, unknown>,
) {
  const { error } = await supabase.from("customer_events").insert({
    customer_id: customer.id,
    restaurant_id: customer.restaurant_id,
    branch_id: customer.branch_id,
    event_type: eventType,
    meta,
  });
  if (error) throw new Error(error.message);
}

function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    customer_created: "Customer created",
    order_placed: "Order placed",
    profile_updated: "Profile updated",
    address_saved: "Address saved",
    whatsapp_opened: "WhatsApp opened",
    customer_merged: "Customer merged",
  };
  return labels[eventType] ?? eventType.replaceAll("_", " ");
}

function eventSummary(event: CustomerEventRow) {
  const meta = event.meta ?? {};
  if (event.event_type === "order_placed") {
    const orderNo = meta.order_no ? `Order ${meta.order_no}` : "Order recorded";
    const total = meta.grand_total ? ` - Rs${meta.grand_total}` : "";
    return `${orderNo}${total}`;
  }
  if (event.event_type === "customer_created") {
    return "Customer profile was created manually.";
  }
  if (event.event_type === "profile_updated") {
    const flags = [
      meta.vip ? "VIP" : null,
      meta.blocked ? "blocked" : null,
      meta.phone ? `phone ${meta.phone}` : null,
    ].filter(Boolean);
    return flags.length ? flags.join(", ") : "Customer information was updated.";
  }
  if (event.event_type === "address_saved") {
    return meta.address ? String(meta.address) : "Delivery address saved.";
  }
  if (event.event_type === "whatsapp_opened") {
    return meta.phone ? `Opened WhatsApp for ${meta.phone}` : "Opened WhatsApp conversation.";
  }
  if (event.event_type === "customer_merged") {
    const source = meta.source_phone ? ` from ${meta.source_phone}` : "";
    const orders = Number(meta.moved_orders ?? 0);
    return `Merged duplicate profile${source}; moved ${orders} order${orders === 1 ? "" : "s"}.`;
  }
  return "Customer activity recorded.";
}
