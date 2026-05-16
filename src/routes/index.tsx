import { useId, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChefHat,
  Clock3,
  Eye,
  Facebook,
  Flame,
  Heart,
  Instagram,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  Menu as MenuIcon,
  MapPin,
  MessageCircle,
  Minus,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  Truck,
  UserRound,
  UsersRound,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import heroImageUrl from "../../Images/img2.png";
import { getCustomerMenu, placeCustomerOrder } from "@/lib/customer-order.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/")({ component: CustomerHome });

type CartItem = { itemId: string; name: string; price: number; qty: number };
type CustomerCategory = { id: string; name: string };
type CustomerMenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  base_price: number;
  image_url: string | null;
};
type CustomerTax = { rate: number; is_inclusive: boolean };
type LastOrder = { orderNo: string; total: number; diningType: "takeaway" | "delivery" };

function CustomerHome() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const menuQ = useQuery({
    queryKey: ["customer-menu"],
    queryFn: () => getCustomerMenu(),
  });
  const menu = menuQ.data;
  const symbol = menu?.restaurant?.currency_symbol ?? "Rs";
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [diningType, setDiningType] = useState<"takeaway" | "delivery">("takeaway");
  const [submitting, setSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const categories = useMemo(
    () => (menu?.categories ?? []) as CustomerCategory[],
    [menu?.categories],
  );
  const menuItems = useMemo(() => (menu?.items ?? []) as CustomerMenuItem[], [menu?.items]);
  const taxes = useMemo(() => (menu?.taxes ?? []) as CustomerTax[], [menu?.taxes]);
  const restaurantName = menu?.restaurant?.name ?? "Angaar Kitchen";
  const navRestaurantName = restaurantName.replace(/^A/, "a");
  const branchName = menu?.branch?.name ?? "Angaar Kitchen";

  const featuredItems = useMemo(() => menuItems.slice(0, 3), [menuItems]);
  const filteredItems = useMemo(
    () => (cat === "all" ? menuItems : menuItems.filter((item) => item.category_id === cat)),
    [menuItems, cat],
  );
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const taxTotal = taxes
    .filter((tax) => !tax.is_inclusive)
    .reduce((sum, tax) => sum + subtotal * (Number(tax.rate) / 100), 0);
  const total = Math.round((subtotal + taxTotal) * 100) / 100;
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  function addItem(item: CustomerMenuItem) {
    setLastOrder(null);
    setCart((current) => {
      const found = current.find((line) => line.itemId === item.id);
      if (found) {
        return current.map((line) =>
          line.itemId === item.id ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...current,
        { itemId: item.id, name: item.name, price: Number(item.base_price), qty: 1 },
      ];
    });
  }

  function setQty(itemId: string, qty: number) {
    setCart((current) =>
      qty <= 0
        ? current.filter((line) => line.itemId !== itemId)
        : current.map((line) => (line.itemId === itemId ? { ...line, qty } : line)),
    );
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      toast.error("Enter your email and password");
      return;
    }
    setSigningIn(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    setSigningIn(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", data.user.id)
      .limit(1);
    if (roleError) {
      toast.error(roleError.message);
      return;
    }
    if (roles?.length) {
      nav({ to: "/dashboard" });
      return;
    }
    toast.success("Signed in for ordering");
  }

  async function submitOrder() {
    if (!menu?.branch?.id) return;
    if (cart.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      toast.error("Enter your name and phone number");
      return;
    }
    if (diningType === "delivery" && !deliveryAddress.trim()) {
      toast.error("Enter your delivery address");
      return;
    }
    const notes = [
      diningType === "delivery" ? `Delivery address: ${deliveryAddress.trim()}` : null,
      customerNotes.trim() || null,
    ]
      .filter(Boolean)
      .join("\n");

    setSubmitting(true);
    try {
      const result = await placeCustomerOrder({
        data: {
          branchId: menu.branch.id,
          diningType,
          customerName,
          customerPhone,
          notes: notes || null,
          items: cart.map((item) => ({ itemId: item.itemId, qty: item.qty })),
        },
      });
      toast.success(`Order ${result.orderNo} placed`);
      setLastOrder({ orderNo: result.orderNo, total, diningType });
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setCustomerNotes("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#080808] text-foreground">
      <section
        className="relative min-h-screen w-screen overflow-hidden bg-[#070504] bg-cover bg-[position:68%_center] shadow-2xl sm:bg-[position:66%_center] lg:min-h-screen lg:bg-[position:center_center]"
        style={{ backgroundImage: `url(${heroImageUrl})` }}
      >
        {/* Cinematic overlay: deep on the content side, transparent over the food so details stay appetizing. */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,4,3,0.98)_0%,rgba(5,4,3,0.92)_34%,rgba(5,4,3,0.52)_50%,rgba(5,4,3,0.08)_78%,rgba(5,4,3,0)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.38)_0%,rgba(0,0,0,0.02)_36%,rgba(0,0,0,0.18)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#080808] to-transparent" />

        <header className="relative z-20 border-b border-white/10 bg-black/18 backdrop-blur-md">
          <div className="mx-auto flex min-h-[68px] w-full max-w-none items-center justify-between gap-4 px-5 py-3 sm:px-7 lg:px-[clamp(1rem,1.5vw,1.875rem)]">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <Flame className="h-8 w-8 fill-primary text-primary sm:h-9 sm:w-9" />
              <div>
                <div className="font-display text-[19px] leading-none tracking-wide text-white sm:text-[21px]">
                  {navRestaurantName}
                </div>
                <div className="mt-1.5 text-[7px] font-bold uppercase tracking-[0.36em] text-primary sm:text-[8px] sm:tracking-[0.42em]">
                  Flavor forged in fire
                </div>
              </div>
            </Link>

            <nav className="ml-auto hidden items-center gap-2 lg:flex">
              <a
                href="#order"
                className="rounded-md px-2.5 py-2 text-sm font-medium text-zinc-200 outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                Order
              </a>
              <a
                href="#menu"
                className="rounded-md px-2.5 py-2 text-sm font-medium text-zinc-200 outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
              >
                Menu
              </a>
              <Button asChild size="sm" className="h-9 px-4">
                <a href="#order">Order Now</a>
              </Button>
              <AccountMenu
                userEmail={user?.email ?? null}
                onSignOut={signOut}
                onSignIn={signIn}
                loginEmail={loginEmail}
                loginPassword={loginPassword}
                showPassword={showPassword}
                signingIn={signingIn}
                setLoginEmail={setLoginEmail}
                setLoginPassword={setLoginPassword}
                setShowPassword={setShowPassword}
              />
            </nav>

            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-black/28 text-white outline-none transition hover:border-primary/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-hero-nav"
              aria-label="Open navigation"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          </div>
          {mobileNavOpen && (
            <div
              id="mobile-hero-nav"
              className="border-t border-white/10 bg-black/84 px-5 py-4 shadow-2xl backdrop-blur-md sm:px-8 lg:hidden"
            >
              <div className="grid gap-3">
                <Button asChild className="h-11">
                  <a href="#order" onClick={() => setMobileNavOpen(false)}>
                    Order Now
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-11 border-white/15 bg-white/5">
                  <a href="#menu" onClick={() => setMobileNavOpen(false)}>
                    View Menu
                  </a>
                </Button>
                <div className="pt-1">
                  <AccountMenu
                    userEmail={user?.email ?? null}
                    onSignOut={signOut}
                    onSignIn={signIn}
                    loginEmail={loginEmail}
                    loginPassword={loginPassword}
                    showPassword={showPassword}
                    signingIn={signingIn}
                    setLoginEmail={setLoginEmail}
                    setLoginPassword={setLoginPassword}
                    setShowPassword={setShowPassword}
                    align="start"
                    fullWidth
                  />
                </div>
              </div>
            </div>
          )}
        </header>

        {/* 12-column hero grid: 45% content, 55% open food imagery for a full-width restaurant feel. */}
        <div className="relative z-10 mx-auto grid min-h-[calc(100vh-68px)] w-full max-w-none grid-cols-1 px-5 py-8 sm:px-7 sm:py-11 lg:grid-cols-12 lg:items-center lg:px-[clamp(1rem,1.5vw,1.875rem)] lg:py-10">
          <div className="max-w-[620px] lg:col-span-5">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              <Flame className="h-3.5 w-3.5 fill-primary" />
              Premium BBQ kitchen
            </div>
            <h1 className="font-display text-[clamp(2.15rem,5.8vw,5.65rem)] leading-[0.95] text-white">
              <span className="block whitespace-nowrap">More than a meal.</span>
              <span className="block whitespace-nowrap text-primary">An experience</span>
              <span className="block text-primary">served hot.</span>
            </h1>
            <p className="mt-5 max-w-[510px] text-[clamp(0.98rem,1.05vw,1.12rem)] leading-7 text-zinc-200 sm:mt-6">
              From smoky grills to rich traditional flavors, Angaar Kitchen brings people together
              around unforgettable food.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 px-7 text-[15px] shadow-ember">
                <a href="#order">
                  <ShoppingBag className="h-5 w-5" />
                  Order Now
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 border-white/18 bg-white/7 px-7 text-[15px] text-white hover:border-primary/60 hover:bg-primary/10"
              >
                <a href="#menu">
                  <Utensils className="h-5 w-5" />
                  View Menu
                </a>
              </Button>
            </div>
            <div className="mt-8 grid max-w-[600px] grid-cols-2 gap-2.5 sm:grid-cols-4">
              <HeroSignal icon={Flame} label="Smoky Grills" />
              <HeroSignal icon={Utensils} label="Rich Flavors" />
              <HeroSignal icon={UsersRound} label="Warm Hospitality" />
              <HeroSignal icon={Heart} label="Made to Share" />
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
              <div className="h-px w-9 bg-primary" />
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-300">
                Follow
              </div>
              <div className="flex gap-2">
                <SocialButton icon={Facebook} label="Facebook" />
                <SocialButton icon={Instagram} label="Instagram" />
                <SocialButton icon={MessageCircle} label="WhatsApp" />
              </div>
            </div>
          </div>
          <div
            className="pointer-events-none hidden h-full lg:col-span-7 lg:block"
            aria-hidden="true"
          />
        </div>
      </section>

      <main
        id="order"
        className="mx-auto grid w-full max-w-[1500px] gap-5 px-5 py-9 sm:px-7 lg:grid-cols-[minmax(0,1fr)_390px] lg:px-[clamp(0.375rem,0.8vw,1rem)] lg:py-11"
      >
        <section id="menu" className="min-w-0 space-y-5">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-primary">
                Online menu
              </p>
              <h2 className="mt-1.5 font-display text-3xl leading-tight text-white sm:text-[2.35rem]">
                Choose your favorites
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                Browse live availability from {branchName}. Prices and taxes are confirmed by the
                kitchen system when you place the order.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 text-center text-xs text-muted-foreground md:w-auto">
              <MiniMetric icon={Clock3} value="25-40" label="min prep" />
              <MiniMetric icon={Truck} value="Takeaway" label="or delivery" />
              <MiniMetric icon={Sparkles} value="Fresh" label="daily menu" />
            </div>
          </div>

          {featuredItems.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {featuredItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => addItem(item)}
                  className="group min-h-[170px] overflow-hidden rounded-md border border-border bg-card text-left shadow-card outline-none transition hover:-translate-y-0.5 hover:border-primary/60 hover:bg-card/95 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <MenuImage item={item} className="h-24 w-full rounded-none" />
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="line-clamp-1 font-medium">{item.name}</div>
                      <div className="font-mono text-sm text-primary">
                        {formatMoney(item.base_price, symbol)}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">Tap to add</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {menuQ.isLoading ? (
            <div className="flex h-60 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !menu?.branch ? (
            <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
              Online ordering is not available yet.
            </div>
          ) : (
            <>
              <Tabs value={cat} onValueChange={setCat}>
                <TabsList className="h-auto max-w-full justify-start overflow-x-auto rounded-md p-1">
                  <TabsTrigger value="all">All</TabsTrigger>
                  {categories.map((category) => (
                    <TabsTrigger key={category.id} value={category.id}>
                      {category.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredItems.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => addItem(item)}
                    className="group flex min-h-[126px] gap-3 rounded-md border border-border bg-card p-3 text-left shadow-card outline-none transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card/95 focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <MenuImage item={item} className="h-22 w-22 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 font-medium">{item.name}</div>
                      {item.description && (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {item.description}
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="font-mono text-sm text-primary">
                          {formatMoney(item.base_price, symbol)}
                        </span>
                        <span className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition group-hover:shadow-ember">
                          Add
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {filteredItems.length === 0 && (
                <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
                  No items are available in this category right now.
                </div>
              )}
            </>
          )}
        </section>

        <aside className="h-fit overflow-hidden rounded-md border border-border bg-card shadow-card lg:sticky lg:top-5">
          <div className="border-b border-border bg-black/10 p-3.5">
            <h2 className="flex items-center gap-2 font-display text-xl">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Your order
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {cartCount > 0
                ? `${cartCount} item${cartCount === 1 ? "" : "s"} selected.`
                : "Orders are unpaid until confirmed at the restaurant."}
            </p>
          </div>
          <div className="space-y-3 p-3.5">
            {lastOrder && (
              <div
                role="status"
                className="rounded-md border border-primary/35 bg-primary/10 p-3 text-sm"
              >
                <div className="font-medium text-primary">Order {lastOrder.orderNo} received</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {lastOrder.diningType === "delivery" ? "Delivery" : "Takeaway"} total{" "}
                  {formatMoney(lastOrder.total, symbol)}. The restaurant will confirm timing.
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={diningType === "takeaway" ? "default" : "outline"}
                onClick={() => setDiningType("takeaway")}
                aria-pressed={diningType === "takeaway"}
                className="h-10"
              >
                Takeaway
              </Button>
              <Button
                type="button"
                variant={diningType === "delivery" ? "default" : "outline"}
                onClick={() => setDiningType("delivery")}
                aria-pressed={diningType === "delivery"}
                className="h-10"
              >
                Delivery
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="space-y-1.5">
                <Label htmlFor="customer-name">Name</Label>
                <Input
                  id="customer-name"
                  autoComplete="name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-phone">Phone</Label>
                <Input
                  id="customer-phone"
                  type="tel"
                  autoComplete="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>
            </div>
            {diningType === "delivery" && (
              <div className="space-y-1.5">
                <Label htmlFor="delivery-address">Delivery address</Label>
                <Input
                  id="delivery-address"
                  autoComplete="street-address"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="House, street, area"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="customer-notes">Notes</Label>
              <Textarea
                id="customer-notes"
                rows={2}
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="No onions, extra spicy, call on arrival..."
              />
            </div>
          </div>

          <div className="max-h-[340px] overflow-y-auto border-y border-border p-3.5">
            {cart.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Your cart is empty.
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((line) => (
                  <div key={line.itemId} className="rounded-md border border-border p-3">
                    <div className="flex justify-between gap-3">
                      <div className="min-w-0 truncate text-sm font-medium">{line.name}</div>
                      <div className="font-mono text-sm">
                        {formatMoney(line.price * line.qty, symbol)}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => setQty(line.itemId, line.qty - 1)}
                        aria-label={`Decrease ${line.name} quantity`}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center font-mono text-sm">{line.qty}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        onClick={() => setQty(line.itemId, line.qty + 1)}
                        aria-label={`Increase ${line.name} quantity`}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto h-7 w-7"
                        onClick={() => setQty(line.itemId, 0)}
                        aria-label={`Remove ${line.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 p-3.5">
            <MoneyRow label="Subtotal" value={formatMoney(subtotal, symbol)} />
            <MoneyRow label="Taxes" value={formatMoney(taxTotal, symbol)} muted />
            <MoneyRow label="Total" value={formatMoney(total, symbol)} strong />
            <Button
              className="w-full"
              size="lg"
              onClick={submitOrder}
              disabled={submitting || cart.length === 0 || !menu?.branch?.id}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Place order
            </Button>
            <div className="flex items-start gap-2 rounded-md bg-secondary/45 p-3 text-xs leading-5 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {menu?.branch?.address ?? "Pickup details will be confirmed by the branch."}
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs leading-5 text-muted-foreground">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Customer accounts can order here. Operational access is staff-only.</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function AccountMenu({
  userEmail,
  onSignOut,
  onSignIn,
  loginEmail,
  loginPassword,
  showPassword,
  signingIn,
  setLoginEmail,
  setLoginPassword,
  setShowPassword,
  align = "end",
  fullWidth = false,
}: {
  userEmail: string | null;
  onSignOut: () => void;
  onSignIn: (e: React.FormEvent) => void;
  loginEmail: string;
  loginPassword: string;
  showPassword: boolean;
  signingIn: boolean;
  setLoginEmail: (value: string) => void;
  setLoginPassword: (value: string) => void;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  align?: "start" | "center" | "end";
  fullWidth?: boolean;
}) {
  const emailId = useId();
  const passwordId = useId();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-10 items-center justify-center gap-2.5 rounded-md border border-white/12 bg-white/6 px-4 text-sm font-semibold text-zinc-200 outline-none transition hover:border-primary/55 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary ${fullWidth ? "w-full" : ""}`}
        >
          <UserRound className="h-[18px] w-[18px]" />
          {userEmail ? "Account" : "Staff Portal"}
          <ChevronDown className="h-4 w-4 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className="w-[min(92vw,360px)] border-white/10 bg-[#12100e]/95 p-3 text-zinc-100 shadow-2xl backdrop-blur-md"
      >
        {userEmail ? (
          <div className="grid gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-primary">Signed in</div>
              <div className="mt-1 truncate text-sm text-zinc-300">{userEmail}</div>
            </div>
            <DropdownMenuSeparator className="bg-white/10" />
            <Button variant="outline" size="sm" onClick={onSignOut} className="justify-start">
              Sign out
            </Button>
            <Button variant="ghost" size="sm" asChild className="justify-start">
              <Link to="/login">
                <LogIn className="h-4 w-4" />
                Staff portal
              </Link>
            </Button>
          </div>
        ) : (
          /* Staff access is intentionally tucked away so the public nav stays restaurant-first. */
          <form onSubmit={onSignIn} className="grid gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-primary">Staff access</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                Restaurant operations and account controls.
              </div>
            </div>
            <div className="relative">
              <label htmlFor={emailId} className="sr-only">
                Email
              </label>
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={emailId}
                type="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="Email"
                className="h-11 rounded-md border-white/15 bg-black/40 pl-9 text-sm text-white placeholder:text-zinc-400 focus-visible:ring-primary"
              />
            </div>
            <div className="relative">
              <label htmlFor={passwordId} className="sr-only">
                Password
              </label>
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={passwordId}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Password"
                className="h-11 rounded-md border-white/15 bg-black/40 pl-9 pr-10 text-sm text-white placeholder:text-zinc-400 focus-visible:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground outline-none transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Eye className="h-4 w-4" />
              </button>
            </div>
            <Button type="submit" className="h-11 shadow-ember" disabled={signingIn}>
              {signingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
            <div className="text-xs text-muted-foreground">
              New to Angaar?{" "}
              <Link
                to="/signup"
                className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                Create an account
              </Link>
            </div>
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeroSignal({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/24 px-3 py-3 backdrop-blur-[2px] transition hover:border-primary/40 hover:bg-primary/10">
      <Icon className="h-7 w-7 text-primary" aria-hidden="true" />
      <div className="mt-2.5 text-xs font-semibold leading-4 text-zinc-100">{label}</div>
    </div>
  );
}

function SocialButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/7 text-zinc-100 outline-none transition hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      aria-label={label}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}

function MiniMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <Icon className="mx-auto mb-1 h-4 w-4 text-primary" aria-hidden="true" />
      <div className="font-mono text-[11px] text-foreground">{value}</div>
      <div className="text-[10px]">{label}</div>
    </div>
  );
}

function MenuImage({ item, className }: { item: CustomerMenuItem; className: string }) {
  if (item.image_url) {
    return (
      <img
        src={item.image_url}
        alt={item.name}
        loading="lazy"
        decoding="async"
        className={`${className} rounded-md object-cover`}
      />
    );
  }
  return (
    <div className={`${className} flex items-center justify-center rounded-md bg-secondary`}>
      <ChefHat className="h-7 w-7 text-primary" />
    </div>
  );
}

function MoneyRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between text-sm ${muted ? "text-muted-foreground" : ""} ${strong ? "border-t border-border pt-3 text-lg" : ""}`}
    >
      <span className={strong ? "font-display" : ""}>{label}</span>
      <span className={`font-mono ${strong ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}
