import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Armchair,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  UserCheck,
  UtensilsCrossed,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";
import { previewCouponPostgres } from "@/lib/coupons.postgres.functions";
import { searchCustomersForPosPostgres } from "@/lib/customers.postgres.functions";
import { cloudinaryImageSrcSet, optimizeCloudinaryImageUrl } from "@/lib/image-delivery";

export const Route = createFileRoute("/_authenticated/pos")({
  validateSearch: z.object({ editOrderId: z.string().optional() }),
  component: POSPage,
});

type CartItem = {
  uid: string;
  item_id: string;
  name: string;
  unit_price: number;
  qty: number;
  notes?: string;
};

type DiningType = "dine_in" | "takeaway" | "delivery" | "outdoor";

type MenuItemRow = {
  id: string;
  name: string;
  base_price: number | string;
  is_available: boolean;
  category_id: string;
  image_url: string | null;
};

type MenuCategoryRow = {
  id: string;
  name: string;
};

type TaxRow = {
  id: string;
  name: string;
  rate: number | string;
  is_inclusive: boolean;
};

type StockStatus = {
  item_id: string;
  missing_recipe: boolean;
  is_negative: boolean;
  is_low: boolean;
  max_possible_qty: number | string | null;
};

type EditableOrder = {
  id: string;
  order_no: string;
  dining_type: DiningType;
  customer_name: string | null;
  customer_phone: string | null;
  table_label: string | null;
  notes: string | null;
  discount_total: number | string | null;
};

type OpenDineInOrder = {
  id: string;
  order_no: string;
  status: string;
  customer_name: string | null;
  table_label: string | null;
  notes: string | null;
  grand_total: number | string;
  created_at: string;
};

type EditableOrderItem = {
  item_id: string;
  name_snapshot: string;
  unit_price: number | string;
  qty: number | string;
  notes: string | null;
};

type PosOrderRpcRow = {
  order_id?: string;
  updated_order_id?: string;
  order_no?: string;
};

type PosCustomerMatch = {
  id: string;
  name: string | null;
  phone: string;
  defaultAddress: string | null;
  spicePreference: string | null;
  isBlocked: boolean;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: string | null;
};

type RpcResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

const QUICK_ITEM_NOTES = [
  "Normal spice",
  "Less spice",
  "Extra spicy",
  "No onion",
  "No sauce",
  "Parcel separately",
];

const SERVICE_OPTIONS: Array<{
  value: DiningType;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}> = [
  {
    value: "dine_in",
    title: "Dine in",
    subtitle: "Table, waiter, kitchen flow",
    icon: UtensilsCrossed,
  },
  {
    value: "takeaway",
    title: "Takeaway",
    subtitle: "Counter pickup order",
    icon: ShoppingBag,
  },
  {
    value: "outdoor",
    title: "Outdoor",
    subtitle: "Outdoor seating order",
    icon: Armchair,
  },
  {
    value: "delivery",
    title: "Delivery",
    subtitle: "Customer address and rider notes",
    icon: Truck,
  },
];

const DINING_HALLS = [
  {
    name: "Main Hall",
    description: "Front service area",
    tables: Array.from({ length: 5 }, (_, index) => ({
      id: `M-${index + 1}`,
      label: `Table ${index + 1}`,
    })),
  },
  {
    name: "Family Hall",
    description: "Family seating area",
    tables: Array.from({ length: 4 }, (_, index) => ({
      id: `F-${index + 1}`,
      label: `Table ${index + 1}`,
    })),
  },
];

function hasSeatLabel(type: DiningType) {
  return type === "dine_in" || type === "outdoor";
}

async function rpc<T>(fn: string, args: Record<string, unknown>) {
  return (await supabase.rpc(fn, args)) as RpcResult<T>;
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function POSPage() {
  const { user, session } = useAuth();
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₨";
  const nav = useNavigate();
  const searchParams = useSearch({ from: Route.id });
  const qc = useQueryClient();
  const editOrderId = searchParams.editOrderId;

  const [search, setSearch] = useState("");
  const [diningType, setDiningType] = useState<DiningType | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerMatches, setCustomerMatches] = useState<PosCustomerMatch[]>([]);
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [discount, setDiscount] = useState("0");
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponDiscountType, setCouponDiscountType] = useState<"amount" | "percent" | "free_delivery" | null>(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [expandedNoteUid, setExpandedNoteUid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hydratedEditOrderId, setHydratedEditOrderId] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const deferredSearch = useDeferredValue(search);

  const itemsQ = useQuery<MenuItemRow[]>({
    queryKey: ["pos-items", branch?.id],
    enabled: !!branch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, name, base_price, is_available, category_id, image_url")
        .eq("branch_id", branch!.id)
        .eq("is_available", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as MenuItemRow[];
    },
  });
  const catsQ = useQuery<MenuCategoryRow[]>({
    queryKey: ["pos-cats", branch?.id],
    enabled: !!branch,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_categories")
        .select("id, name")
        .eq("branch_id", branch!.id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as MenuCategoryRow[];
    },
  });
  const taxesQ = useQuery<TaxRow[]>({
    queryKey: ["pos-taxes", restaurant?.id],
    enabled: !!restaurant,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("taxes")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .eq("is_active", true)
        .eq("apply_by_default", true);
      if (error) throw error;
      return (data ?? []) as TaxRow[];
    },
  });
  const stockQ = useQuery<StockStatus[]>({
    queryKey: ["menu-stock-status", branch?.id],
    enabled: !!branch,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await rpc<StockStatus[]>("get_menu_item_stock_status", {
        _branch: branch!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const dineInOrdersQ = useQuery<OpenDineInOrder[]>({
    queryKey: ["pos-dine-in-table-orders", branch?.id],
    enabled: !!branch && diningType === "dine_in",
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_no, status, customer_name, table_label, notes, grand_total, created_at")
        .eq("branch_id", branch!.id)
        .eq("dining_type", "dine_in")
        .in("status", ["open", "placed", "preparing", "ready", "served"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpenDineInOrder[];
    },
  });
  const editOrderQ = useQuery<{ order: EditableOrder; items: EditableOrderItem[] }>({
    queryKey: ["pos-edit-order", editOrderId],
    enabled: !!editOrderId,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const orderRequest = supabase
        .from("orders")
        .select(
          "id, order_no, dining_type, customer_name, customer_phone, table_label, notes, discount_total",
        )
        .eq("id", editOrderId!)
        .single();

      const itemsRequest = supabase
        .from("order_items")
        .select("item_id, name_snapshot, unit_price, qty, notes")
        .eq("order_id", editOrderId!);

      const [{ data: order, error }, { data: items, error: itemsError }] = await Promise.all([
        orderRequest,
        itemsRequest,
      ]);
      if (error) throw error;
      if (itemsError) throw itemsError;

      return {
        order: order as EditableOrder,
        items: (items ?? []) as EditableOrderItem[],
      };
    },
  });

  const [activeCat, setActiveCat] = useState<string>("all");
  const stockByItem = useMemo(
    () => new Map((stockQ.data ?? []).map((s) => [s.item_id, s])),
    [stockQ.data],
  );
  const filteredItems = useMemo(() => {
    let items = itemsQ.data ?? [];
    if (activeCat !== "all") items = items.filter((i) => i.category_id === activeCat);
    if (deferredSearch.trim()) {
      const s = deferredSearch.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(s));
    }
    return items;
  }, [itemsQ.data, activeCat, deferredSearch]);
  const editingOrder = editOrderQ.data?.order;
  const isEditing = !!editOrderId;
  const currentDiningType: DiningType = diningType ?? editingOrder?.dining_type ?? "dine_in";
  const tableOrders = useMemo(() => {
    const map = new Map<string, OpenDineInOrder>();
    for (const order of dineInOrdersQ.data ?? []) {
      const key = normalizeTableLabel(order.table_label);
      if (key && !map.has(key)) map.set(key, order);
    }
    return map;
  }, [dineInOrdersQ.data]);

  useEffect(() => {
    if (!editOrderId || !editOrderQ.data || hydratedEditOrderId === editOrderId) return;
    if (editOrderQ.isFetching || editOrderQ.isError) return;
    const order = editOrderQ.data.order;
    const items = editOrderQ.data.items;
    const parsedNotes = parseOrderNotes(order.notes);

    setDiningType(order.dining_type ?? "dine_in");
    setCustomerName(order.customer_name ?? "");
    setCustomerPhone(order.customer_phone ?? "");
    setCustomerAddress(parsedNotes.address);
    setCustomerMatches([]);
    setSelectedCustomerId(null);
    setOrderNotes(parsedNotes.notes);
    setAssignedTo(parsedNotes.assignedTo || "");
    setTableLabel(order.table_label ?? "");
    setDiscount(String(Number(order.discount_total ?? 0)));
    setCouponCode("");
    setCouponDiscount(0);
    setCouponDiscountType(null);
    setCouponMessage("");
    setCart(
      items.map((item) => ({
        uid: crypto.randomUUID(),
        item_id: item.item_id,
        name: item.name_snapshot,
        unit_price: Number(item.unit_price),
        qty: Number(item.qty),
        notes: item.notes ?? undefined,
      })),
    );
    setHydratedEditOrderId(editOrderId);
  }, [editOrderId, editOrderQ.data, editOrderQ.isError, editOrderQ.isFetching, hydratedEditOrderId]);

  const addToCart = useCallback((it: MenuItemRow) => {
    setCart((c) => {
      const found = c.find((x) => x.item_id === it.id);
      if (found) return c.map((x) => (x.uid === found.uid ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...c,
        {
          uid: crypto.randomUUID(),
          item_id: it.id,
          name: it.name,
          unit_price: Number(it.base_price),
          qty: 1,
        },
      ];
    });
  }, []);
  function setQty(uid: string, qty: number) {
    if (qty <= 0) setCart((c) => c.filter((x) => x.uid !== uid));
    else setCart((c) => c.map((x) => (x.uid === uid ? { ...x, qty } : x)));
  }
  function setItemNotes(uid: string, notes: string) {
    setCart((c) => c.map((x) => (x.uid === uid ? { ...x, notes: notes.trim() || undefined } : x)));
  }
  function appendItemNote(uid: string, note: string) {
    setCart((c) =>
      c.map((x) => {
        if (x.uid !== uid) return x;
        const parts = (x.notes ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        if (!parts.some((part) => part.toLowerCase() === note.toLowerCase())) parts.push(note);
        return { ...x, notes: parts.join(", ") };
      }),
    );
  }
  function clearCart() {
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setCustomerMatches([]);
    setSelectedCustomerId(null);
    setOrderNotes("");
    setAssignedTo("");
    setTableLabel("");
    setDiningType(null);
    setDiscount("0");
    setCouponCode("");
    setCouponDiscount(0);
    setCouponDiscountType(null);
    setCouponMessage("");
    setExpandedNoteUid(null);
  }
  function exitEditMode() {
    setHydratedEditOrderId(null);
    clearCart();
    nav({ to: "/pos" });
  }

  const subtotal = cart.reduce((s, x) => s + x.unit_price * x.qty, 0);
  const discountNum = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const deliveryFee = currentDiningType === "delivery" ? Number(branch?.delivery_fee ?? 0) : 0;
  const couponItemDiscount = couponDiscountType === "free_delivery" ? 0 : couponDiscount;
  const couponDeliveryDiscount = couponDiscountType === "free_delivery" ? couponDiscount : 0;
  const itemDiscount = Math.max(0, Math.min(subtotal, discountNum + couponItemDiscount));
  const taxableBase = Math.max(0, subtotal - itemDiscount);
  const taxBreakdown = (taxesQ.data ?? []).map((t) => {
    const rate = Number(t.rate);
    const amount = t.is_inclusive
      ? +(taxableBase - taxableBase / (1 + rate / 100)).toFixed(2)
      : +((taxableBase * rate) / 100).toFixed(2);
    return { tax_id: t.id, name: t.name, rate, amount, is_inclusive: t.is_inclusive };
  });
  const taxTotal = taxBreakdown.filter((t) => !t.is_inclusive).reduce((s, t) => s + t.amount, 0);
  const grandTotal = +(taxableBase + taxTotal + deliveryFee - couponDeliveryDiscount).toFixed(2);

  const applyCustomerMatch = useCallback(
    (customer: PosCustomerMatch, options: { silent?: boolean } = {}) => {
      setSelectedCustomerId(customer.id);
      setCustomerName(customer.name ?? "");
      setCustomerPhone(customer.phone);
      if (customer.defaultAddress) {
        setCustomerAddress(customer.defaultAddress);
        setDiningType((current) => current ?? "delivery");
      }
      if (customer.spicePreference) {
        setOrderNotes((current) => (current.trim() ? current : customer.spicePreference ?? ""));
      }
      setCustomerMatches([]);
      if (customer.isBlocked) {
        toast.error("This customer is blocked. Please review before taking an order.");
        return;
      }
      if (!options.silent) toast.success("Customer details loaded");
    },
    [],
  );

  useEffect(() => {
    if (!branch?.id || !session?.access_token || isEditing) return;
    const query = customerPhone.trim().length >= 3 ? customerPhone.trim() : customerName.trim();
    if (query.length < 2) {
      setCustomerMatches([]);
      setCustomerLookupLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCustomerLookupLoading(true);
      try {
        const matches = await searchCustomersForPosPostgres({
          data: { branchId: branch.id, query },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        setCustomerMatches(matches);
        const exactPhone = normalizePhone(customerPhone) || null;
        const autoMatch =
          exactPhone && matches.find((customer) => normalizePhone(customer.phone) === exactPhone);
        if (autoMatch) {
          applyCustomerMatch(autoMatch, { silent: true });
        }
      } catch {
        if (!cancelled) setCustomerMatches([]);
      } finally {
        if (!cancelled) setCustomerLookupLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyCustomerMatch, branch?.id, customerName, customerPhone, isEditing, session?.access_token]);

  async function applyCoupon() {
    if (!branch?.id) return;
    if (!couponCode.trim()) {
      setCouponDiscount(0);
      setCouponMessage("");
      return;
    }
    if (subtotal <= 0) {
      toast.error("Add items before applying a coupon");
      return;
    }

    setCheckingCoupon(true);
    try {
      const coupon = await previewCouponPostgres({
        data: {
          branchId: branch.id,
          code: couponCode.trim(),
          subtotal,
          deliveryFee,
          source: "pos",
        },
      });
      setCouponDiscount(coupon?.discountAmount ?? 0);
      setCouponDiscountType(coupon?.discountType ?? null);
      setCouponMessage(
        coupon
          ? `${coupon.code} applied: ${formatMoney(coupon.discountAmount, symbol)} off`
          : "",
      );
      if (coupon) toast.success(`${coupon.code} applied`);
    } catch (error) {
      setCouponDiscount(0);
      setCouponDiscountType(null);
      setCouponMessage("");
      toast.error(error instanceof Error ? error.message : "Coupon could not be applied");
    } finally {
      setCheckingCoupon(false);
    }
  }

  function chooseTable(table: string) {
    const order = tableOrders.get(normalizeTableLabel(table));
    if (order) toast.message(`${table} has ${order.order_no} already open`);
    setTableLabel(table);
  }

  async function placeOrder() {
    if (!branch || !user) return;
    if (!currentDiningType) {
      toast.error("Choose dine in, takeaway, outdoor, or delivery first");
      return;
    }
    if (cart.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    if (isEditing && !editOrderId) {
      toast.error("Missing order id for edit");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        _dining_type: currentDiningType,
        _customer_name: customerName,
        _customer_phone: customerPhone,
        _table_label: hasSeatLabel(currentDiningType) ? tableLabel : "",
        _notes: buildOrderNotes(
          currentDiningType === "delivery" ? customerAddress : "",
          orderNotes,
          assignedTo,
        ),
        _discount: discountNum,
        _coupon_code: couponCode.trim() || null,
        _items: cart.map((x) => ({ item_id: x.item_id, qty: x.qty, notes: x.notes ?? null })),
      };
      const { data, error } = isEditing
        ? await rpc<PosOrderRpcRow[]>("update_pos_order", {
            _order_id: editOrderId,
            ...payload,
          })
        : await rpc<PosOrderRpcRow[]>("create_pos_order", {
            _branch: branch.id,
            ...payload,
            _idempotency_key: idempotencyKeyRef.current,
          });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("No order returned");
      const savedOrderId = row?.order_id ?? row?.updated_order_id;
      if (!savedOrderId) throw new Error("No order returned");
      toast.success(
        isEditing
          ? `Order ${row.order_no} updated`
          : `Order ${row.order_no} placed · sent to kitchen`,
      );
      idempotencyKeyRef.current = crypto.randomUUID();
      clearCart();
      [
        ["orders-list"],
        ["order", savedOrderId],
        ["dashboard-today"],
        ["item-usage-report"],
        ["menu-stock-status"],
        ["inventory-items"],
        ["inventory-movements"],
        ["inventory-reports"],
        ["inventory-menu-performance"],
        ["inventory-control-branch"],
        ["pos-edit-order", savedOrderId],
      ].forEach((queryKey) => {
        void qc.invalidateQueries({ queryKey });
      });
      nav({
        to: "/receipt/$orderId",
        params: { orderId: savedOrderId },
        search: isEditing ? {} : { placed: true },
      });
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to place order"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!branch)
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;
  if (isEditing && editOrderQ.isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (isEditing && editOrderQ.error) {
    return (
      <div className="p-8 text-center text-destructive">Could not load order for editing.</div>
    );
  }
  if (!diningType && !isEditing) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col justify-center p-4 sm:p-8">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
              Start order
            </p>
            <h1 className="mt-2 font-display text-3xl sm:text-4xl">Choose service type</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Select how this order will be served. The POS will show only the fields needed for
              that workflow.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {SERVICE_OPTIONS.map((option) => (
              <ServiceTypeCard
                key={option.value}
                title={option.title}
                subtitle={option.subtitle}
                icon={option.icon}
                onClick={() => setDiningType(option.value)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (currentDiningType === "dine_in" && !tableLabel && !isEditing) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col justify-center p-4 sm:p-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                Dine in
              </p>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl">Choose table</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Select a table from Main Hall or Family Hall. After this, the menu opens fully.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDiningType(null);
                setTableLabel("");
              }}
            >
              Change service
            </Button>
          </div>

          <TableBoard
            selectedTable={tableLabel}
            tableOrders={tableOrders}
            loading={dineInOrdersQ.isLoading}
            symbol={symbol}
            onSelect={chooseTable}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
      {/* Left: items */}
      <div className="flex min-h-0 min-w-0 flex-col p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-display text-2xl">{isEditing ? "Edit Order" : "Point of Sale"}</h1>
            {isEditing && editingOrder && (
              <div className="text-xs text-muted-foreground">
                {editingOrder.order_no} · unpaid order edit
              </div>
            )}
            {!isEditing && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="capitalize">
                  {currentDiningType.replace("_", " ")}
                  {hasSeatLabel(currentDiningType) && tableLabel ? ` · ${tableLabel}` : ""}
                </span>
                {currentDiningType === "dine_in" && (
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setTableLabel("")}
                  >
                    Change table
                  </button>
                )}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => {
                    setDiningType(null);
                    setTableLabel("");
                  }}
                >
                  Change service
                </button>
              </div>
            )}
          </div>
          <div className="ml-auto relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 w-64"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <Tabs value={activeCat} onValueChange={setActiveCat} className="mt-4">
          <TabsList className="flex h-auto max-h-[76px] w-full flex-wrap justify-start gap-1 overflow-y-auto overflow-x-hidden">
            <TabsTrigger value="all" className="h-8 px-2.5">
              All
            </TabsTrigger>
            {catsQ.data?.map((c) => (
              <TabsTrigger
                key={c.id}
                value={c.id}
                className="h-8 whitespace-normal px-2.5 text-xs leading-tight"
              >
                {c.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="mt-4 grid flex-1 auto-rows-min gap-3 overflow-y-auto pb-4 grid-cols-2 sm:grid-cols-3">
          {itemsQ.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          {filteredItems.length === 0 && !itemsQ.isLoading && (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No items.{" "}
              <Link to="/menu" className="text-primary">
                Add some
              </Link>
              .
            </div>
          )}
          {filteredItems.map((it) => (
            <MenuItemButton
              key={it.id}
              item={it}
              stock={stockByItem.get(it.id)}
              symbol={symbol}
              onAdd={addToCart}
            />
          ))}
        </div>
      </div>

      {/* Right: cart */}
      <aside className="flex min-h-0 flex-col overflow-y-auto border-t border-border bg-card lg:max-h-[calc(100vh-3.5rem)] lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg">{isEditing ? "Edit Cart" : "Current Order"}</h2>
          {isEditing ? (
            <Button variant="ghost" size="sm" onClick={exitEditMode}>
              <X className="mr-1 h-4 w-4" />
              Exit
            </Button>
          ) : (
            cart.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearCart}>
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )
          )}
        </div>

        <div className="space-y-3 border-b border-border p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {(["dine_in", "takeaway", "outdoor", "delivery"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={currentDiningType === d ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setDiningType(d);
                  if (!hasSeatLabel(d)) setTableLabel("");
                }}
                className="capitalize"
              >
                {d.replace("_", " ")}
              </Button>
            ))}
          </div>
          {hasSeatLabel(currentDiningType) && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/45 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {currentDiningType === "outdoor" ? "Outdoor spot" : "Table"}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{tableLabel || "Not set"}</span>
                {!isEditing && (
                  <button
                    type="button"
                    className="text-xs text-primary underline-offset-4 hover:underline"
                    onClick={() => setTableLabel("")}
                  >
                    Change
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck className="h-3.5 w-3.5" />
              Assigned to
            </Label>
            <Input
              placeholder="e.g. Haroon, Usman, waiter name"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => {
                setSelectedCustomerId(null);
                setCustomerName(e.target.value);
              }}
            />
            <Input
              placeholder="Phone"
              value={customerPhone}
              onChange={(e) => {
                setSelectedCustomerId(null);
                setCustomerPhone(e.target.value);
              }}
            />
            {(customerLookupLoading || customerMatches.length > 0 || selectedCustomerId) && (
              <div className="col-span-2 rounded-md border border-border bg-background/45 p-2 text-xs">
                {customerLookupLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking saved customers...
                  </div>
                ) : selectedCustomerId ? (
                  <div className="text-success">Saved customer loaded.</div>
                ) : (
                  <div className="space-y-1">
                    {customerMatches.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        onClick={() => applyCustomerMatch(customer)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {customer.name || "Unnamed customer"}
                            {customer.isBlocked ? " - blocked" : ""}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {customer.phone}
                            {customer.defaultAddress ? ` · ${customer.defaultAddress}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {customer.totalOrders} orders
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {currentDiningType === "delivery" && (
              <Textarea
                className="col-span-2 min-h-[58px] resize-none"
                placeholder="Delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
              />
            )}
            {currentDiningType === "outdoor" && (
              <Input
                className="col-span-2"
                placeholder="Outdoor table / spot (optional)"
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
              />
            )}
            <Textarea
              className="col-span-2 min-h-[48px] resize-none"
              placeholder="Order notes, e.g. normal spice"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <div className="min-h-[160px] flex-none overflow-y-auto p-4 lg:max-h-[34vh]">
          {cart.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Receipt className="mx-auto mb-3 h-8 w-8 opacity-50" />
              No items added.
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((c) => (
                <li key={c.uid} className="rounded-md border border-border bg-background/25 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-snug break-words">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {formatMoney(c.unit_price, symbol)} each
                      </div>
                      {c.notes && expandedNoteUid !== c.uid && (
                        <div className="mt-0.5 text-xs leading-snug text-muted-foreground break-words">
                          Note: {c.notes}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 font-mono text-sm">
                      {formatMoney(c.unit_price * c.qty, symbol)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setQty(c.uid, c.qty - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center font-mono text-sm">{c.qty}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setQty(c.uid, c.qty + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 px-2 text-xs"
                      onClick={() => setExpandedNoteUid(expandedNoteUid === c.uid ? null : c.uid)}
                    >
                      <MessageSquare className="mr-1 h-3.5 w-3.5" />
                      {c.notes ? "Edit note" : "Note"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setQty(c.uid, 0)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {expandedNoteUid === c.uid && (
                    <div className="mt-2 space-y-2 rounded-md border border-border bg-background/35 p-2">
                      <Input
                        value={c.notes ?? ""}
                        onChange={(e) => setItemNotes(c.uid, e.target.value)}
                        placeholder="Item note"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_ITEM_NOTES.map((note) => (
                          <Button
                            key={note}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => appendItemNote(c.uid, note)}
                          >
                            {note}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotal, symbol)} />
            <div className="flex items-center justify-between">
              <Label className="text-sm">Discount</Label>
              <Input
                type="number"
                className="h-8 w-28 text-right font-mono"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 rounded-md border border-border bg-background/35 p-2">
              <Label className="text-xs">Coupon</Label>
              <div className="flex gap-2">
                <Input
                  className="h-8 uppercase"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase());
                    setCouponDiscount(0);
                    setCouponDiscountType(null);
                    setCouponMessage("");
                  }}
                  placeholder="CODE"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={applyCoupon}
                  disabled={checkingCoupon || cart.length === 0}
                >
                  {checkingCoupon && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Apply
                </Button>
              </div>
              {couponMessage && <div className="text-xs text-success">{couponMessage}</div>}
            </div>
            {couponDiscount > 0 && (
              <Row label="Coupon" value={`-${formatMoney(couponDiscount, symbol)}`} muted />
            )}
            {deliveryFee > 0 && (
              <Row label="Delivery fee" value={formatMoney(deliveryFee, symbol)} muted />
            )}
            {taxBreakdown.map((t) => (
              <Row
                key={t.tax_id}
                label={`${t.name} (${t.rate}%)${t.is_inclusive ? " incl." : ""}`}
                value={formatMoney(t.amount, symbol)}
                muted
              />
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 text-lg">
              <span className="font-display">Total</span>
              <span className="font-mono text-primary">{formatMoney(grandTotal, symbol)}</span>
            </div>
          </div>

          <Button
            onClick={placeOrder}
            disabled={submitting || cart.length === 0}
            size="lg"
            className="w-full"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save Changes" : "Place Order"}
            {/*
            Place Order · Send to Kitchen
            )}
            */}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Payment & printing happen on the order screen.
          </p>
        </div>
      </aside>
    </div>
  );
}

function ServiceTypeCard({
  title,
  subtitle,
  icon: Icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[180px] flex-col rounded-xl border border-border bg-card p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-ember"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <span className="mt-6 font-display text-2xl">{title}</span>
      <span className="mt-2 text-sm text-muted-foreground">{subtitle}</span>
    </button>
  );
}

function TableBoard({
  selectedTable,
  tableOrders,
  loading,
  symbol,
  onSelect,
}: {
  selectedTable: string;
  tableOrders: Map<string, OpenDineInOrder>;
  loading: boolean;
  symbol: string;
  onSelect: (table: string) => void;
}) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-card/70 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Armchair className="h-4 w-4 text-primary" />
            Dine-in tables
          </div>
          <div className="text-xs text-muted-foreground">
            Select a table before adding items. Status is based on open dine-in orders.
          </div>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        {DINING_HALLS.map((hall) => (
          <section key={hall.name} className="rounded-lg border border-border bg-background/35 p-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold uppercase tracking-[0.14em]">
                  {hall.name}
                </div>
                <div className="text-xs text-muted-foreground">{hall.description}</div>
              </div>
              <Badge variant="outline" className="shrink-0 border-primary/30 text-[10px] text-primary">
                {hall.tables.length} tables
              </Badge>
            </div>

            <div
              className={`grid grid-cols-2 gap-2 ${
                hall.tables.length === 5 ? "sm:grid-cols-5 xl:grid-cols-5" : "sm:grid-cols-4 xl:grid-cols-4"
              }`}
            >
              {hall.tables.map((table) => {
                const order = tableOrders.get(normalizeTableLabel(table.id));
                const status = getTableStatus(order);
                const selected = normalizeTableLabel(selectedTable) === normalizeTableLabel(table.id);
                const assignedTo = order ? parseOrderNotes(order.notes).assignedTo : "";
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => onSelect(table.id)}
                    className={`flex min-h-[72px] min-w-0 flex-col rounded-lg border p-2 text-left transition ${
                      selected
                        ? "border-primary bg-primary/15 shadow-ember"
                        : "border-border bg-card/70 hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-semibold text-primary">{table.id}</div>
                        <div className="truncate text-sm font-semibold">{table.label}</div>
                      </div>
                      <Badge variant="outline" className={`shrink-0 px-1.5 text-[9px] ${status.className}`}>
                        {status.label}
                      </Badge>
                    </div>

                    {order ? (
                      <div className="mt-1.5 min-w-0 text-[10px] leading-tight text-muted-foreground">
                        <div className="truncate font-mono text-foreground">{order.order_no}</div>
                        <div className="truncate">{assignedTo || order.customer_name || "Open order"}</div>
                        <div className="mt-0.5 font-mono font-semibold text-primary">
                          {formatMoney(order.grand_total, symbol)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-auto pt-1.5 text-[10px] text-muted-foreground">Available</div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

const MenuItemButton = memo(function MenuItemButton({
  item,
  stock,
  symbol,
  onAdd,
}: {
  item: MenuItemRow;
  stock: StockStatus | undefined;
  symbol: string;
  onAdd: (item: MenuItemRow) => void;
}) {
  const warning = getStockWarning(stock);

  return (
    <button
      onClick={() => onAdd(item)}
      className="group flex min-h-[108px] flex-col items-start rounded-lg border border-border bg-card p-3 text-left shadow-card transition hover:border-primary/50 hover:shadow-ember"
    >
      {item.image_url ? (
        <img
          src={
            optimizeCloudinaryImageUrl(item.image_url, {
              width: 360,
              height: 220,
              quality: "auto:eco",
            }) ?? item.image_url
          }
          srcSet={cloudinaryImageSrcSet(item.image_url, [240, 360, 520])}
          sizes="(min-width: 640px) 30vw, 45vw"
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="mb-2 h-24 w-full rounded-md object-cover"
        />
      ) : null}
      <div className="line-clamp-2 text-sm font-medium">{item.name}</div>
      {warning && (
        <Badge variant="outline" className={`mt-2 text-[10px] ${warning.cls}`}>
          {warning.label}
        </Badge>
      )}
      <div className="mt-auto pt-3 font-mono text-sm text-primary">
        {formatMoney(item.base_price, symbol)}
      </div>
    </button>
  );
});

function buildOrderNotes(address: string, notes: string, assignedTo: string) {
  const lines: string[] = [];
  const cleanAddress = address.trim();
  const cleanNotes = notes.trim();
  const cleanAssignedTo = assignedTo === "unassigned" ? "" : assignedTo.trim();
  if (cleanAddress) lines.push(`Address: ${cleanAddress}`);
  if (cleanAssignedTo) lines.push(`Assigned to: ${cleanAssignedTo}`);
  if (cleanNotes) lines.push(`Notes: ${cleanNotes}`);
  return lines.join("\n");
}

function parseOrderNotes(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { address: "", notes: "", assignedTo: "" };

  const lines = raw.split(/\r?\n/);
  const addressLine = lines.find((line) => /^address:/i.test(line));
  const assignedToLine = lines.find((line) => /^assigned to:/i.test(line));
  const notesLine = lines.find((line) => /^notes:/i.test(line));
  if (addressLine || assignedToLine || notesLine) {
    return {
      address: addressLine?.replace(/^address:\s*/i, "").trim() ?? "",
      assignedTo: assignedToLine?.replace(/^assigned to:\s*/i, "").trim() ?? "",
      notes: notesLine?.replace(/^notes:\s*/i, "").trim() ?? "",
    };
  }

  return { address: "", notes: raw, assignedTo: "" };
}

function normalizeTableLabel(value: string | null | undefined) {
  const clean = (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!clean) return "";

  const normalized = clean
    .replace(/^table/, "")
    .replace(/^mainhall/, "m")
    .replace(/^main/, "m")
    .replace(/^familyhall/, "f")
    .replace(/^family/, "f");

  const match = normalized.match(/^([tmf])[-_]?0*(\d+)$/);
  if (match) {
    const prefix = match[1] === "t" ? "" : `${match[1]}-`;
    return `${prefix}${Number(match[2])}`;
  }

  const numberOnly = normalized.match(/^0*(\d+)$/);
  if (numberOnly) return `${Number(numberOnly[1])}`;

  return normalized.replace(/[-_]/g, "");
}

function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

function getStockWarning(stock: StockStatus | undefined) {
  if (!stock) return null;
  if (stock.missing_recipe)
    return { label: "No recipe", cls: "border-muted bg-muted/40 text-muted-foreground" };
  if (stock.is_negative)
    return {
      label: "Negative stock",
      cls: "border-destructive/30 bg-destructive/15 text-destructive",
    };
  if (stock.max_possible_qty !== null && Number(stock.max_possible_qty) <= 0)
    return { label: "Out by recipe", cls: "border-amber-500/30 bg-amber-500/15 text-amber-300" };
  if (stock.is_low)
    return { label: "Low stock", cls: "border-amber-500/30 bg-amber-500/15 text-amber-300" };
  return null;
}

function getTableStatus(order: OpenDineInOrder | undefined) {
  if (!order) return { label: "Available", className: "border-success/30 text-success" };
  if (order.status === "served")
    return { label: "Served", className: "border-blue-500/30 bg-blue-500/10 text-blue-300" };
  if (order.status === "ready")
    return { label: "Ready", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
  if (order.status === "preparing")
    return { label: "Cooking", className: "border-primary/40 bg-primary/10 text-primary" };
  return { label: "Reserved", className: "border-muted-foreground/30 text-muted-foreground" };
}
