import { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Minus, Trash2, Loader2, Receipt, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pos")({ component: POSPage });

type CartItem = {
  uid: string; item_id: string; name: string; unit_price: number; qty: number; notes?: string;
};

function POSPage() {
  const { user } = useAuth();
  const { branch, restaurant } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₨";
  const nav = useNavigate();

  const [search, setSearch] = useState("");
  const [diningType, setDiningType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [discount, setDiscount] = useState("0");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const itemsQ = useQuery({
    queryKey: ["pos-items", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase.from("menu_items").select("id, name, base_price, is_available, category_id, image_url").eq("branch_id", branch!.id).eq("is_available", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const catsQ = useQuery({
    queryKey: ["pos-cats", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase.from("menu_categories").select("id, name").eq("branch_id", branch!.id).eq("is_active", true).order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
  const taxesQ = useQuery({
    queryKey: ["pos-taxes", restaurant?.id],
    enabled: !!restaurant,
    queryFn: async () => {
      const { data, error } = await supabase.from("taxes").select("*").eq("restaurant_id", restaurant!.id).eq("is_active", true).eq("apply_by_default", true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const stockQ = useQuery({
    queryKey: ["menu-stock-status", branch?.id],
    enabled: !!branch,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_menu_item_stock_status", { _branch: branch!.id });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [activeCat, setActiveCat] = useState<string>("all");
  const stockByItem = useMemo(() => new Map((stockQ.data ?? []).map((s: any) => [s.item_id, s])), [stockQ.data]);
  const filteredItems = useMemo(() => {
    let items = itemsQ.data ?? [];
    if (activeCat !== "all") items = items.filter((i) => i.category_id === activeCat);
    if (search.trim()) {
      const s = search.toLowerCase();
      items = items.filter((i) => i.name.toLowerCase().includes(s));
    }
    return items;
  }, [itemsQ.data, activeCat, search]);

  function addToCart(it: any) {
    setCart((c) => {
      const found = c.find((x) => x.item_id === it.id);
      if (found) return c.map((x) => x.uid === found.uid ? { ...x, qty: x.qty + 1 } : x);
      return [...c, { uid: crypto.randomUUID(), item_id: it.id, name: it.name, unit_price: Number(it.base_price), qty: 1 }];
    });
  }
  function setQty(uid: string, qty: number) {
    if (qty <= 0) setCart((c) => c.filter((x) => x.uid !== uid));
    else setCart((c) => c.map((x) => x.uid === uid ? { ...x, qty } : x));
  }
  function clearCart() { setCart([]); setCustomerName(""); setCustomerPhone(""); setTableLabel(""); setDiscount("0"); }

  const subtotal = cart.reduce((s, x) => s + x.unit_price * x.qty, 0);
  const discountNum = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const taxableBase = Math.max(0, subtotal - discountNum);
  const taxBreakdown = (taxesQ.data ?? []).map((t: any) => {
    const rate = Number(t.rate);
    const amount = t.is_inclusive
      ? +(taxableBase - taxableBase / (1 + rate / 100)).toFixed(2)
      : +(taxableBase * rate / 100).toFixed(2);
    return { tax_id: t.id, name: t.name, rate, amount, is_inclusive: t.is_inclusive };
  });
  const taxTotal = taxBreakdown.filter((t) => !t.is_inclusive).reduce((s, t) => s + t.amount, 0);
  const grandTotal = +(taxableBase + taxTotal).toFixed(2);

  async function placeOrder() {
    if (!branch || !user) return;
    if (cart.length === 0) { toast.error("Cart is empty"); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_pos_order", {
        _branch: branch.id,
        _dining_type: diningType,
        _customer_name: customerName,
        _customer_phone: customerPhone,
        _table_label: tableLabel,
        _discount: discountNum,
        _items: cart.map((x) => ({ item_id: x.item_id, qty: x.qty, notes: x.notes ?? null })),
        _idempotency_key: idempotencyKeyRef.current,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.order_id) throw new Error("No order returned");
      toast.success(`Order ${row.order_no} placed · sent to kitchen`);
      idempotencyKeyRef.current = crypto.randomUUID();
      clearCart();
      nav({ to: "/receipt/$orderId", params: { orderId: row.order_id }, search: { placed: true } });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  if (!branch) return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[1fr_400px]">
      {/* Left: items */}
      <div className="flex min-h-0 flex-col p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl">Point of Sale</h1>
          <div className="ml-auto relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 w-64" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <Tabs value={activeCat} onValueChange={setActiveCat} className="mt-4">
          <TabsList className="overflow-x-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            {catsQ.data?.map((c) => <TabsTrigger key={c.id} value={c.id}>{c.name}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        <div className="mt-4 grid flex-1 auto-rows-min gap-3 overflow-y-auto pb-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
          {itemsQ.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          {filteredItems.length === 0 && !itemsQ.isLoading && (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">No items. <Link to="/menu" className="text-primary">Add some</Link>.</div>
          )}
          {filteredItems.map((it) => {
            const stock = stockByItem.get(it.id) as any;
            const warning = getStockWarning(stock);
            return (
              <button key={it.id} onClick={() => addToCart(it)} className="group flex min-h-[108px] flex-col items-start rounded-lg border border-border bg-card p-3 text-left shadow-card transition hover:border-primary/50 hover:shadow-ember">
                {it.image_url ? (
                  <img src={it.image_url} alt={it.name} className="mb-2 h-24 w-full rounded-md object-cover" />
                ) : null}
                <div className="line-clamp-2 text-sm font-medium">{it.name}</div>
                {warning && <Badge variant="outline" className={`mt-2 text-[10px] ${warning.cls}`}>{warning.label}</Badge>}
                <div className="mt-auto pt-3 font-mono text-sm text-primary">{formatMoney(it.base_price, symbol)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: cart */}
      <aside className="flex min-h-0 flex-col border-t lg:border-t-0 lg:border-l border-border bg-card">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-lg">Current Order</h2>
          {cart.length > 0 && <Button variant="ghost" size="sm" onClick={clearCart}><X className="mr-1 h-4 w-4" />Clear</Button>}
        </div>

        <div className="space-y-3 p-4 border-b border-border">
          <div className="grid grid-cols-3 gap-2">
            {(["dine_in","takeaway","delivery"] as const).map((d) => (
              <Button key={d} type="button" variant={diningType === d ? "default" : "outline"} size="sm" onClick={() => setDiningType(d)} className="capitalize">{d.replace("_"," ")}</Button>
            ))}
          </div>
          {diningType === "dine_in" && (
            <Input placeholder="Table number" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <Input placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground"><Receipt className="mx-auto mb-3 h-8 w-8 opacity-50" />No items added.</div>
          ) : (
            <ul className="space-y-2">
              {cart.map((c) => (
                <li key={c.uid} className="rounded-md border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{formatMoney(c.unit_price, symbol)} each</div>
                    </div>
                    <div className="font-mono text-sm">{formatMoney(c.unit_price * c.qty, symbol)}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(c.uid, c.qty - 1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-8 text-center font-mono text-sm">{c.qty}</span>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setQty(c.uid, c.qty + 1)}><Plus className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={() => setQty(c.uid, 0)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
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
              <Input type="number" className="h-8 w-28 text-right font-mono" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            {taxBreakdown.map((t) => (
              <Row key={t.tax_id} label={`${t.name} (${t.rate}%)${t.is_inclusive ? " incl." : ""}`} value={formatMoney(t.amount, symbol)} muted />
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 text-lg">
              <span className="font-display">Total</span>
              <span className="font-mono text-primary">{formatMoney(grandTotal, symbol)}</span>
            </div>
          </div>

          <Button onClick={placeOrder} disabled={submitting || cart.length === 0} size="lg" className="w-full">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Place Order · Send to Kitchen
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
  return <div className={`flex items-center justify-between ${muted ? "text-muted-foreground" : ""}`}><span>{label}</span><span className="font-mono">{value}</span></div>;
}

function getStockWarning(stock: any) {
  if (!stock) return null;
  if (stock.missing_recipe) return { label: "No recipe", cls: "border-muted bg-muted/40 text-muted-foreground" };
  if (stock.is_negative) return { label: "Negative stock", cls: "border-destructive/30 bg-destructive/15 text-destructive" };
  if (stock.max_possible_qty !== null && Number(stock.max_possible_qty) <= 0) return { label: "Out by recipe", cls: "border-amber-500/30 bg-amber-500/15 text-amber-300" };
  if (stock.is_low) return { label: "Low stock", cls: "border-amber-500/30 bg-amber-500/15 text-amber-300" };
  return null;
}
