import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Trash2, Loader2, Receipt, Search, X, MessageSquare } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/format";

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
  dining_type: "dine_in" | "takeaway" | "delivery";
  customer_name: string | null;
  customer_phone: string | null;
  table_label: string | null;
  notes: string | null;
  discount_total: number | string | null;
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
  const { user } = useAuth();
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₨";
  const nav = useNavigate();
  const searchParams = useSearch({ from: Route.id });
  const qc = useQueryClient();
  const editOrderId = searchParams.editOrderId;

  const [search, setSearch] = useState("");
  const [diningType, setDiningType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [discount, setDiscount] = useState("0");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [expandedNoteUid, setExpandedNoteUid] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hydratedEditOrderId, setHydratedEditOrderId] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const itemsQ = useQuery<MenuItemRow[]>({
    queryKey: ["pos-items", branch?.id],
    enabled: !!branch,
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
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await rpc<StockStatus[]>("get_menu_item_stock_status", {
        _branch: branch!.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const editOrderQ = useQuery<{ order: EditableOrder; items: EditableOrderItem[] }>({
    queryKey: ["pos-edit-order", editOrderId],
    enabled: !!editOrderId,
    queryFn: async () => {
      const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", editOrderId!)
        .single();
      if (error) throw error;

      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", editOrderId!);
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
    if (search.trim()) {
      const s = search.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(s));
    }
    return items;
  }, [itemsQ.data, activeCat, search]);
  const editingOrder = editOrderQ.data?.order;
  const isEditing = !!editOrderId;

  useEffect(() => {
    if (!editOrderId || !editOrderQ.data || hydratedEditOrderId === editOrderId) return;
    const order = editOrderQ.data.order;
    const items = editOrderQ.data.items;
    const parsedNotes = parseOrderNotes(order.notes);

    setDiningType(order.dining_type ?? "dine_in");
    setCustomerName(order.customer_name ?? "");
    setCustomerPhone(order.customer_phone ?? "");
    setCustomerAddress(parsedNotes.address);
    setOrderNotes(parsedNotes.notes);
    setTableLabel(order.table_label ?? "");
    setDiscount(String(Number(order.discount_total ?? 0)));
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
  }, [editOrderId, editOrderQ.data, hydratedEditOrderId]);

  function addToCart(it: MenuItemRow) {
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
  }
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
    setOrderNotes("");
    setTableLabel("");
    setDiscount("0");
    setExpandedNoteUid(null);
  }
  function exitEditMode() {
    setHydratedEditOrderId(null);
    clearCart();
    nav({ to: "/pos" });
  }

  const subtotal = cart.reduce((s, x) => s + x.unit_price * x.qty, 0);
  const discountNum = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const taxableBase = Math.max(0, subtotal - discountNum);
  const taxBreakdown = (taxesQ.data ?? []).map((t) => {
    const rate = Number(t.rate);
    const amount = t.is_inclusive
      ? +(taxableBase - taxableBase / (1 + rate / 100)).toFixed(2)
      : +((taxableBase * rate) / 100).toFixed(2);
    return { tax_id: t.id, name: t.name, rate, amount, is_inclusive: t.is_inclusive };
  });
  const taxTotal = taxBreakdown.filter((t) => !t.is_inclusive).reduce((s, t) => s + t.amount, 0);
  const grandTotal = +(taxableBase + taxTotal).toFixed(2);

  async function placeOrder() {
    if (!branch || !user) return;
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
        _dining_type: diningType,
        _customer_name: customerName,
        _customer_phone: customerPhone,
        _table_label: diningType === "dine_in" ? tableLabel : "",
        _notes: buildOrderNotes(diningType === "delivery" ? customerAddress : "", orderNotes),
        _discount: discountNum,
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
      const savedOrderId = row?.order_id ?? row?.updated_order_id;
      if (!savedOrderId) throw new Error("No order returned");
      toast.success(
        isEditing
          ? `Order ${row.order_no} updated`
          : `Order ${row.order_no} placed · sent to kitchen`,
      );
      idempotencyKeyRef.current = crypto.randomUUID();
      clearCart();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orders-list"] }),
        qc.invalidateQueries({ queryKey: ["order", savedOrderId] }),
        qc.invalidateQueries({ queryKey: ["menu-stock-status"] }),
      ]);
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
          {filteredItems.map((it) => {
            const stock = stockByItem.get(it.id);
            const warning = getStockWarning(stock);
            return (
              <button
                key={it.id}
                onClick={() => addToCart(it)}
                className="group flex min-h-[108px] flex-col items-start rounded-lg border border-border bg-card p-3 text-left shadow-card transition hover:border-primary/50 hover:shadow-ember"
              >
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    alt={it.name}
                    className="mb-2 h-24 w-full rounded-md object-cover"
                  />
                ) : null}
                <div className="line-clamp-2 text-sm font-medium">{it.name}</div>
                {warning && (
                  <Badge variant="outline" className={`mt-2 text-[10px] ${warning.cls}`}>
                    {warning.label}
                  </Badge>
                )}
                <div className="mt-auto pt-3 font-mono text-sm text-primary">
                  {formatMoney(it.base_price, symbol)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: cart */}
      <aside className="flex min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
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
          <div className="grid grid-cols-3 gap-2">
            {(["dine_in", "takeaway", "delivery"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={diningType === d ? "default" : "outline"}
                size="sm"
                onClick={() => setDiningType(d)}
                className="capitalize"
              >
                {d.replace("_", " ")}
              </Button>
            ))}
          </div>
          {diningType === "dine_in" && (
            <Input
              placeholder="Table number"
              value={tableLabel}
              onChange={(e) => setTableLabel(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Customer name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <Input
              placeholder="Phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
            {diningType === "delivery" && (
              <Textarea
                className="col-span-2 min-h-[58px] resize-none"
                placeholder="Delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <Receipt className="mx-auto mb-3 h-8 w-8 opacity-50" />
              No items added.
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((c) => (
                <li key={c.uid} className="rounded-md border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {formatMoney(c.unit_price, symbol)} each
                      </div>
                      {c.notes && expandedNoteUid !== c.uid && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          Note: {c.notes}
                        </div>
                      )}
                    </div>
                    <div className="font-mono text-sm">
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

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function buildOrderNotes(address: string, notes: string) {
  const lines: string[] = [];
  const cleanAddress = address.trim();
  const cleanNotes = notes.trim();
  if (cleanAddress) lines.push(`Address: ${cleanAddress}`);
  if (cleanNotes) lines.push(`Notes: ${cleanNotes}`);
  return lines.join("\n");
}

function parseOrderNotes(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { address: "", notes: "" };

  const lines = raw.split(/\r?\n/);
  const addressLine = lines.find((line) => /^address:/i.test(line));
  const notesLine = lines.find((line) => /^notes:/i.test(line));
  if (addressLine || notesLine) {
    return {
      address: addressLine?.replace(/^address:\s*/i, "").trim() ?? "",
      notes: notesLine?.replace(/^notes:\s*/i, "").trim() ?? "",
    };
  }

  return { address: "", notes: raw };
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
