import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import dealOneImageUrl from "../../Images/deal-1-optimized.jpg";
import heroImageUrl from "../../Images/img2-optimized.jpg";
import {
  getCustomerMenu as getCustomerMenuSupabase,
  lookupCustomerForOrder as lookupCustomerForOrderSupabase,
  placeCustomerOrder as placeCustomerOrderSupabase,
} from "@/lib/customer-order.functions";
import {
  getCustomerMenuPostgres as getCustomerMenu,
  lookupCustomerForOrderPostgres as lookupCustomerForOrder,
  placeCustomerOrderPostgres as placeCustomerOrder,
  trackCustomerCommerceEventPostgres,
} from "@/lib/customer-order.postgres.functions";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatMoney } from "@/lib/format";
import { cloudinaryImageSrcSet, optimizeCloudinaryImageUrl } from "@/lib/image-delivery";
import { firstAllowedPath } from "@/lib/rbac";
import { previewCouponPostgres } from "@/lib/coupons.postgres.functions";

export const Route = createFileRoute("/")({ component: CustomerHome });

const PROMO_SLIDES = [
  {
    eyebrow: "Family deal",
    title: "BBQ platters for sharing",
    description: "Build a table around smoky grills, fresh naan, rice, and house sauces.",
    action: "Order a deal",
    image: dealOneImageUrl,
  },
  {
    eyebrow: "Today special",
    title: "Fresh karahi from the flame",
    description: "Choose chicken, mutton, beef, or handi favorites prepared after order confirmation.",
    action: "Explore karahi",
  },
  {
    eyebrow: "Quick delivery",
    title: "Order for home or office",
    description: "Add your address, notes, and spice preference before sending the order to kitchen.",
    action: "Start order",
  },
  {
    eyebrow: "Weekend offer",
    title: "Deals for two and four",
    description: "Perfect for friends, family dinners, and late-night cravings with warm naan.",
    action: "View deals",
  },
  {
    eyebrow: "Spice notes",
    title: "Tell us your taste",
    description: "Normal, mild, extra spicy, no onions, or call on arrival can be added at checkout.",
    action: "Add notes",
  },
  {
    eyebrow: "WhatsApp help",
    title: "Need help choosing?",
    description: "Ask about availability, delivery timing, or spice level before placing your order.",
    action: "Open WhatsApp",
  },
];

const INITIAL_VISIBLE_ITEMS = 12;
const VISIBLE_ITEMS_INCREMENT = 12;
const MENU_IMAGE_DISPLAY_LIMIT = 12;
const DEFAULT_LOCATION = "Grand Trunk Rd, near Punjab College, Pak Town, Kamoke, 52470";

type CartItem = { itemId: string; name: string; price: number; qty: number };
type CustomerCategory = { id: string; name: string };
type CustomerBranch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  delivery_fee?: number | string | null;
} | null;
type CustomerRestaurant = {
  id?: string;
  name?: string;
  currency_symbol?: string;
  address?: string | null;
  phone?: string | null;
} | null;
type CustomerMenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  base_price: number;
  image_url: string | null;
  is_best_seller?: boolean;
  is_chef_recommended?: boolean;
  is_popular?: boolean;
  is_new_item?: boolean;
  spice_level?: string | null;
  serving_size?: string | null;
};
type CustomerTax = { rate: number; is_inclusive: boolean };
type CustomerLive = {
  isOpenNow: boolean;
  todayHours: { openTime: string; closeTime: string } | null;
  activeOrders: number;
  todayOrders: number;
  latestOrderAt: string | null;
  menuUpdatedAt: string | null;
} | null;
type CustomerMenuResponse = {
  branch: CustomerBranch;
  restaurant: CustomerRestaurant;
  categories: CustomerCategory[];
  items: CustomerMenuItem[];
  taxes: CustomerTax[];
  hours?: unknown[];
  live?: CustomerLive;
  promotions?: Array<{
    id: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    image_url: string | null;
    cta_text: string;
    cta_link: string;
    action_type?: "link" | "whatsapp" | "menu_item";
    menu_item_id?: string | null;
    priority: number;
  }>;
  reviews?: {
    averageRating: number;
    totalReviews: number;
    recent: Array<{
      id: string;
      rating: number;
      review: string | null;
      customerName: string | null;
      createdAt: string;
      isVerifiedPurchase: boolean;
    }>;
  };
  rankings?: {
    mostOrderedItemIds: string[];
  };
};
type LastOrder = { orderNo: string; total: number; diningType: "takeaway" | "delivery" };
type CustomerLookup = {
  customer: {
    name: string | null;
    phone: string;
    defaultAddress: string | null;
    spicePreference: string | null;
    isBlocked: boolean;
  };
  addresses: Array<{
    id: string;
    label: string;
    address: string;
    instructions: string | null;
    isDefault: boolean;
  }>;
  lastOrder: {
    orderNo: string;
    diningType: "takeaway" | "delivery" | "dine_in";
    grandTotal: number;
    createdAt: string;
    items: Array<{ itemId: string; name: string; qty: number; price: number }>;
  } | null;
};

function CustomerHome() {
  const { user, signIn: authSignIn, signOut } = useAuth();
  const { data: roles } = useMyRoles();
  const nav = useNavigate();
  const menuQ = useQuery<CustomerMenuResponse>({
    queryKey: ["customer-menu"],
    queryFn: async () =>
      (isPostgresAuthEnabled() ? await getCustomerMenu() : await getCustomerMenuSupabase()) as CustomerMenuResponse,
    staleTime: 120_000,
    gcTime: 10 * 60_000,
    refetchInterval: 180_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
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
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [cartOpen, setCartOpen] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(INITIAL_VISIBLE_ITEMS);
  const [customerLookup, setCustomerLookup] = useState<CustomerLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponDiscountType, setCouponDiscountType] = useState<
    "amount" | "percent" | "free_delivery" | null
  >(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const promoRailRef = useRef<HTMLDivElement | null>(null);
  const promoCardRefs = useRef<Array<HTMLElement | null>>([]);

  const categories = useMemo(
    () => (menu?.categories ?? []) as CustomerCategory[],
    [menu?.categories],
  );
  const menuItems = useMemo(() => (menu?.items ?? []) as CustomerMenuItem[], [menu?.items]);
  const taxes = useMemo(() => (menu?.taxes ?? []) as CustomerTax[], [menu?.taxes]);
  const live = (menu?.live ?? null) as CustomerLive;
  const restaurantName = menu?.restaurant?.name ?? "Angaar Kitchen";
  const navRestaurantName = restaurantName.replace(/^A/, "a");
  const displayRestaurantName = restaurantName.replace(/^A/, "a");
  const branchName = menu?.branch?.name ?? "Angaar Kitchen";
  const footerAddress = displayLocation(menu?.branch?.address ?? menu?.restaurant?.address);
  const workspacePath = roles?.length ? firstAllowedPath(roles) : "/login";
  const openStatusLabel = live?.isOpenNow ? "Open now" : live?.todayHours ? "Closed now" : "Call for hours";
  const todayHoursLabel = live?.todayHours
    ? `${formatClock(live.todayHours.openTime)} - ${formatClock(live.todayHours.closeTime)}`
    : "Today";
  const contactPhone = menu?.branch?.phone ?? menu?.restaurant?.phone ?? "0335 7200955";
  const whatsappHref = buildWhatsAppHref(contactPhone);
  const promoBanners = useMemo(() => {
    if (!menu) return [];
    if (menu.promotions?.length) {
      return menu.promotions.map((promotion) => ({
        eyebrow: promotion.subtitle || "Featured offer",
        title: promotion.title,
        description: promotion.description || "Available now for online ordering.",
        action: promotion.cta_text || "Order now",
        href: promotion.cta_link || "#order",
        image: promotion.image_url || null,
        actionType: promotion.action_type || "link",
        menuItemId: promotion.menu_item_id || null,
      }));
    }
    return PROMO_SLIDES.map((promotion) => ({
      ...promotion,
      href: promotion.action.toLowerCase().includes("whatsapp") ? whatsappHref : "#order",
      image: promotion.image ?? null,
      actionType: "link" as const,
      menuItemId: null,
    }));
  }, [menu, whatsappHref]);
  const [activePromoIndex, setActivePromoIndex] = useState(0);
  const mostOrdered = useMemo(
    () => new Set(menu?.rankings?.mostOrderedItemIds ?? []),
    [menu?.rankings?.mostOrderedItemIds],
  );

  useEffect(() => {
    const restaurantId = menu?.restaurant?.id;
    const query = deferredSearchQuery.trim();
    if (!isPostgresAuthEnabled() || !restaurantId || query.length < 3) return;
    const handle = window.setTimeout(() => {
      void trackCustomerCommerceEventPostgres({
        data: {
          restaurantId,
          branchId: menu.branch?.id ?? null,
          eventType: "search",
          searchQuery: query,
        },
      }).catch(() => undefined);
    }, 1_200);
    return () => window.clearTimeout(handle);
  }, [deferredSearchQuery, menu?.branch?.id, menu?.restaurant?.id]);

  const filteredItems = useMemo(
    () =>
      (cat === "all" ? menuItems : menuItems.filter((item) => item.category_id === cat)).filter(
        (item) => {
          const query = deferredSearchQuery.trim().toLowerCase();
          if (!query) return true;
          return [item.name, item.description]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query));
        },
      ),
    [menuItems, cat, deferredSearchQuery],
  );
  const orderedFilteredItems = useMemo(
    () =>
      cat === "all" && !deferredSearchQuery.trim()
        ? curateInitialMenuItems(filteredItems, categories)
        : filteredItems,
    [cat, categories, deferredSearchQuery, filteredItems],
  );
  const displayedItems = orderedFilteredItems.slice(0, visibleItemCount);
  const hasMoreItems = displayedItems.length < orderedFilteredItems.length;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const deliveryFee =
    diningType === "delivery" ? Number(menu?.branch?.delivery_fee ?? 0) : 0;
  const couponItemDiscount = couponDiscountType === "free_delivery" ? 0 : couponDiscount;
  const couponDeliveryDiscount = couponDiscountType === "free_delivery" ? couponDiscount : 0;
  const discountedSubtotal = Math.max(0, subtotal - couponItemDiscount);
  const taxTotal = taxes
    .filter((tax) => !tax.is_inclusive)
    .reduce((sum, tax) => sum + discountedSubtotal * (Number(tax.rate) / 100), 0);
  const total =
    Math.round((discountedSubtotal + taxTotal + deliveryFee - couponDeliveryDiscount) * 100) / 100;
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);

  useEffect(() => {
    setVisibleItemCount(INITIAL_VISIBLE_ITEMS);
  }, [cat, deferredSearchQuery]);

  useEffect(() => {
    if (activePromoIndex > promoBanners.length - 1) {
      setActivePromoIndex(0);
    }
  }, [activePromoIndex, promoBanners.length]);

  useEffect(() => {
    if (promoBanners.length <= 1) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const nextIndex = (activePromoIndex + 1) % promoBanners.length;
      scrollPromoTo(nextIndex);
    }, 4_500);
    return () => window.clearInterval(timer);
  }, [activePromoIndex, promoBanners.length]);

  function addItem(item: CustomerMenuItem) {
    setLastOrder(null);
    setCouponDiscount(0);
    setCouponDiscountType(null);
    setCouponMessage("");
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
    toast.success(`${item.name} added to cart`);
    if (isPostgresAuthEnabled() && menu?.restaurant?.id) {
      void trackCustomerCommerceEventPostgres({
        data: {
          restaurantId: menu.restaurant.id,
          branchId: menu.branch?.id ?? null,
          itemId: item.id,
          eventType: "cart_addition",
        },
      }).catch(() => undefined);
    }
  }

  function setQty(itemId: string, qty: number) {
    setCart((current) =>
      qty <= 0
        ? current.filter((line) => line.itemId !== itemId)
        : current.map((line) => (line.itemId === itemId ? { ...line, qty } : line)),
    );
    setCouponDiscount(0);
    setCouponDiscountType(null);
    setCouponMessage("");
  }

  function scrollPromoRail(direction: "previous" | "next") {
    const nextIndex =
      direction === "next"
        ? (activePromoIndex + 1) % promoBanners.length
        : (activePromoIndex - 1 + promoBanners.length) % promoBanners.length;
    scrollPromoTo(nextIndex);
  }

  function scrollPromoTo(index: number) {
    const rail = promoRailRef.current;
    const card = promoCardRefs.current[index];
    if (!rail || !card) return;
    setActivePromoIndex(index);
    const railRect = rail.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const nextLeft =
      rail.scrollLeft + cardRect.left - railRect.left - (rail.clientWidth - card.clientWidth) / 2;
    rail.scrollTo({ left: nextLeft, behavior: "smooth" });
  }

  function handlePromoAction(promo: (typeof promoBanners)[number]) {
    if (promo.actionType === "menu_item" && promo.menuItemId) {
      const item = menuItems.find((menuItem) => menuItem.id === promo.menuItemId);
      if (!item) {
        toast.error("This offer is not available right now.");
        return;
      }
      addItem(item);
      setCartOpen(true);
      return;
    }

    if (promo.href.startsWith("#")) {
      document.querySelector(promo.href)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.open(promo.href, promo.actionType === "whatsapp" ? "_blank" : "_self", "noreferrer");
  }

  async function applyCoupon() {
    if (!menu?.branch?.id) return;
    if (!isPostgresAuthEnabled()) {
      toast.error("Coupons are available after PostgreSQL migration.");
      return;
    }
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
          branchId: menu.branch.id,
          code: couponCode.trim(),
          subtotal,
          deliveryFee,
          source: "website",
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

  function handleCustomerPhoneChange(value: string) {
    setCustomerPhone(value);
    setCustomerLookup(null);
  }

  async function lookupSavedCustomer() {
    if (!menu?.branch?.id) return;
    if (customerPhone.trim().length < 6) {
      toast.error("Enter a phone number first");
      return;
    }

    setLookupLoading(true);
    try {
      const result = (isPostgresAuthEnabled()
        ? await lookupCustomerForOrder({
            data: { branchId: menu.branch.id, phone: customerPhone.trim() },
          })
        : await lookupCustomerForOrderSupabase({
            data: { branchId: menu.branch.id, phone: customerPhone.trim() },
          })) as CustomerLookup | null;

      if (!result) {
        setCustomerLookup(null);
        toast.info("No saved customer found for this phone");
        return;
      }

      setCustomerLookup(result);
      if (result.customer.isBlocked) {
        toast.error("This customer profile needs restaurant assistance");
        return;
      }

      if (!customerName.trim() && result.customer.name) {
        setCustomerName(result.customer.name);
      }

      const savedAddress =
        result.addresses.find((address) => address.isDefault)?.address ??
        result.customer.defaultAddress ??
        result.addresses[0]?.address;
      if (!deliveryAddress.trim() && savedAddress) {
        setDeliveryAddress(savedAddress);
      }

      if (!customerNotes.trim() && result.customer.spicePreference) {
        setCustomerNotes(result.customer.spicePreference);
      }

      toast.success("Saved customer details loaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load saved customer");
    } finally {
      setLookupLoading(false);
    }
  }

  function repeatLastOrder() {
    const order = customerLookup?.lastOrder;
    if (!order?.items.length) {
      toast.error("No repeatable order found");
      return;
    }

    const menuById = new Map(menuItems.map((item) => [item.id, item]));
    const repeatLines = order.items
      .map((line) => {
        const item = menuById.get(line.itemId);
        if (!item) return null;
        return {
          itemId: item.id,
          name: item.name,
          price: Number(item.base_price),
          qty: line.qty,
        };
      })
      .filter((line): line is CartItem => Boolean(line));

    if (repeatLines.length === 0) {
      toast.error("The previous items are not available right now");
      return;
    }

    setLastOrder(null);
    setCart((current) => {
      const next = current.map((line) => ({ ...line }));
      for (const repeatLine of repeatLines) {
        const existing = next.find((line) => line.itemId === repeatLine.itemId);
        if (existing) {
          existing.qty += repeatLine.qty;
        } else {
          next.push(repeatLine);
        }
      }
      return next;
    });
    setCartOpen(true);
    toast.success(`Order ${order.orderNo} added to cart`);
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      toast.error("Enter your email and password");
      return;
    }
    setSigningIn(true);
    try {
      const result = await authSignIn({ email: loginEmail.trim(), password: loginPassword });
      if (result.roles.length) {
        nav({ to: firstAllowedPath(result.roles) });
        return;
      }
      toast.success("Signed in for ordering");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign in");
    } finally {
      setSigningIn(false);
    }
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
    if (customerLookup?.customer.isBlocked) {
      toast.error("Please contact the restaurant before placing this order");
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
      const payload = {
        branchId: menu.branch.id,
        diningType,
        customerName,
        customerPhone,
        notes: notes || null,
        couponCode: couponCode.trim() || null,
        items: cart.map((item) => ({ itemId: item.itemId, qty: item.qty })),
      };
      const result = isPostgresAuthEnabled()
        ? await placeCustomerOrder({ data: payload })
        : await placeCustomerOrderSupabase({ data: payload });
      toast.success(`Order ${result.orderNo} placed`);
      setLastOrder({ orderNo: result.orderNo, total, diningType });
      setCartOpen(true);
      setCart([]);
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setCustomerNotes("");
      setCouponCode("");
      setCouponDiscount(0);
      setCouponDiscountType(null);
      setCouponMessage("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not place order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ak-menu-board min-h-screen overflow-x-hidden text-foreground">
      <section
        className="relative min-h-[82vh] w-screen overflow-hidden bg-[#070504] bg-cover bg-[position:68%_center] shadow-2xl sm:min-h-[80vh] sm:bg-[position:66%_center] lg:min-h-[84vh] lg:bg-[position:center_center]"
        style={{ backgroundImage: `url(${heroImageUrl})` }}
      >
        {/* Cinematic overlay: deep on the content side, transparent over the food so details stay appetizing. */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,4,3,0.98)_0%,rgba(5,4,3,0.92)_34%,rgba(5,4,3,0.52)_50%,rgba(5,4,3,0.08)_78%,rgba(5,4,3,0)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.44)_0%,rgba(0,0,0,0.04)_36%,rgba(0,0,0,0.28)_100%)]" />
        <div className="pointer-events-none absolute inset-4 hidden border border-[#b8954e]/18 lg:block" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#080808] to-transparent" />

        <header className="relative z-20 border-b border-[#b8954e]/25 bg-black/36 backdrop-blur-md">
          <div className="mx-auto flex min-h-[68px] w-full max-w-none items-center justify-between gap-4 px-5 py-3 sm:px-7 lg:px-[clamp(1rem,1.5vw,1.875rem)]">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <Flame className="h-8 w-8 fill-primary text-primary drop-shadow-[0_0_18px_rgba(255,113,45,0.35)] sm:h-9 sm:w-9" />
              <div>
                <div className="font-display text-[19px] leading-none tracking-wide text-[#f8efd8] sm:text-[21px]">
                  {navRestaurantName}
                </div>
                <div className="mt-1.5 text-[7px] font-bold uppercase tracking-[0.36em] text-[#d8bd77] sm:text-[8px] sm:tracking-[0.42em]">
                  Flavor forged in fire
                </div>
              </div>
            </Link>

            <nav className="ml-auto hidden items-center gap-2 lg:flex">
              <a
                href="#order"
                className="rounded-md px-2.5 py-2 text-sm font-medium text-[#e8dcc2] outline-none transition hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary"
              >
                Order
              </a>
              <a
                href="#menu"
                className="rounded-md px-2.5 py-2 text-sm font-medium text-[#e8dcc2] outline-none transition hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary"
              >
                Menu
              </a>
              <Button asChild size="sm" className="ak-gold-cta h-9 px-4">
                <a href="#order">Order Now</a>
              </Button>
              <CartButton cartCount={cartCount} onClick={() => setCartOpen(true)} />
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
                workspacePath={workspacePath}
              />
            </nav>

            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#b8954e]/28 bg-black/35 text-[#f8efd8] outline-none transition hover:border-[#d8bd77]/70 hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
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
                <Button asChild className="ak-gold-cta h-11">
                  <a href="#order" onClick={() => setMobileNavOpen(false)}>
                    Order Now
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 border-[#b8954e]/35 bg-black/35 text-[#f8efd8] hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385]"
                >
                  <a href="#menu" onClick={() => setMobileNavOpen(false)}>
                    View Menu
                  </a>
                </Button>
                <CartButton
                  cartCount={cartCount}
                  onClick={() => {
                    setMobileNavOpen(false);
                    setCartOpen(true);
                  }}
                  fullWidth
                />
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
                    workspacePath={workspacePath}
                    align="start"
                    fullWidth
                  />
                </div>
              </div>
            </div>
          )}
        </header>

        {/* 12-column hero grid: 45% content, 55% open food imagery for a full-width restaurant feel. */}
        <div className="relative z-10 mx-auto grid min-h-[calc(82vh-68px)] w-full max-w-none grid-cols-1 px-5 py-7 sm:min-h-[calc(80vh-68px)] sm:px-7 sm:py-9 lg:min-h-[calc(84vh-68px)] lg:grid-cols-12 lg:items-center lg:px-[clamp(1rem,1.5vw,1.875rem)] lg:py-8">
          <div className="max-w-[620px] lg:col-span-5">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#b8954e]/45 bg-black/45 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#f2d385] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
              <Flame className="h-3.5 w-3.5 fill-primary" />
              Premium BBQ kitchen
            </div>
            <h1 className="font-display text-[clamp(2.45rem,6.4vw,6.25rem)] leading-[0.95] text-[#fff8e7] drop-shadow-[0_4px_24px_rgba(0,0,0,0.45)]">
              <span className="block whitespace-nowrap">More than a meal.</span>
              <span className="block whitespace-nowrap text-[#f2d385]">An experience</span>
              <span className="block text-[#f2d385]">served hot.</span>
            </h1>
            <div className="ak-ornate-line mt-4 h-px w-40" />
            <p className="mt-4 max-w-[500px] text-[clamp(0.95rem,1vw,1.05rem)] leading-7 text-[#e8dcc2] sm:mt-5">
              From smoky grills to rich traditional flavors, {displayRestaurantName} brings people together
              around unforgettable food.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="ak-gold-cta h-12 px-7 text-[15px]">
                <a href="#order">
                  <ShoppingBag className="h-5 w-5" />
                  Order Now
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 border-[#b8954e]/35 bg-black/35 px-7 text-[15px] text-[#f8efd8] hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385]"
              >
                <a href="#menu">
                  <Utensils className="h-5 w-5" />
                  View Menu
                </a>
              </Button>
            </div>
            <div className="mt-6 grid max-w-[650px] grid-cols-2 gap-2.5 sm:grid-cols-4">
              <HeroSignal icon={Flame} label="Smoky grills" eyebrow="Signature" />
              <HeroSignal icon={Utensils} label="Rich flavors" eyebrow="Traditional" />
              <HeroSignal icon={UsersRound} label="Warm hospitality" eyebrow="Family first" />
              <HeroSignal icon={Heart} label="Made to share" eyebrow="Gatherings" />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 sm:mt-8">
              <div className="h-px w-9 bg-[#d8bd77]" />
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#d8bd77]">
                Follow
              </div>
              <div className="flex gap-2">
                <SocialButton icon={Facebook} label="Facebook" />
                <SocialButton icon={Instagram} label="Instagram" />
                <SocialButton icon={MessageCircle} label="WhatsApp" href={whatsappHref} />
              </div>
            </div>
          </div>
          <div
            className="pointer-events-none hidden h-full lg:col-span-7 lg:block"
            aria-hidden="true"
          />
        </div>
      </section>

      {promoBanners.length > 0 && (
        <section className="relative overflow-hidden border-y border-[#b8954e]/25 bg-[linear-gradient(180deg,#0c0a06_0%,#151007_48%,#060504_100%)] py-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(216,189,119,0.68),transparent)]" />
          <div className="mx-auto max-w-[1500px] px-5 sm:px-7 lg:px-[clamp(1rem,1.5vw,1.875rem)]">
            <div className="mb-5 flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#d8bd77]">
                  Offers board
                </div>
                <h2 className="mt-1 font-display text-3xl leading-none text-[#fff8e7] sm:text-4xl">
                  Featured deals
                </h2>
                <div className="mt-2 max-w-xl text-sm leading-6 text-[#bfb19a]">
                  Slide through current platters, limited specials, and customer-friendly ordering notes.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#b8954e]/28 bg-black/35 text-[#f8efd8] outline-none transition hover:border-[#d8bd77]/70 hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => scrollPromoRail("previous")}
                  aria-label="Previous offers"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#b8954e]/28 bg-black/35 text-[#f8efd8] outline-none transition hover:border-[#d8bd77]/70 hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => scrollPromoRail("next")}
                  aria-label="Next offers"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              ref={promoRailRef}
              className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-[14vw] pb-2 pt-1 [scrollbar-width:none] sm:-mx-7 sm:px-7 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
            >
              {promoBanners.map((promo, index) => {
                const actionLabel = promo.action || "Order Now";
                const isActive = index === activePromoIndex;
                return (
                  <article
                    ref={(node) => {
                      promoCardRefs.current[index] = node;
                    }}
                    key={`${promo.eyebrow}-${promo.title}`}
                    className={`min-w-[72vw] snap-center overflow-hidden rounded-md border bg-black/28 transition duration-300 sm:min-w-[calc(50%_-_0.375rem)] lg:min-w-[calc(33.333%_-_0.5rem)] ${
                      isActive
                        ? "border-[#d8bd77]/65 opacity-100 shadow-[0_20px_54px_-34px_rgba(216,189,119,0.86)]"
                        : "border-[#b8954e]/22 opacity-70"
                    }`}
                  >
                    {promo.image ? (
                      <div className="relative">
                        <img
                          src={optimizeCloudinaryImageUrl(promo.image, {
                            width: 1200,
                            height: 525,
                          }) ?? promo.image}
                          srcSet={cloudinaryImageSrcSet(promo.image, [640, 960, 1200, 1600])}
                          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 72vw"
                          alt={promo.title}
                          loading={index === 0 ? "eager" : "lazy"}
                          fetchPriority={index === 0 ? "high" : "low"}
                          decoding="async"
                          className="aspect-[16/7] w-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 flex items-end justify-end bg-gradient-to-t from-black/70 via-black/15 to-transparent p-2.5">
                          <button
                            type="button"
                            onClick={() => handlePromoAction(promo)}
                            className="inline-flex h-9 items-center justify-center rounded-md bg-[#d8bd77] px-3.5 text-xs font-bold text-[#130f08] shadow-[0_14px_30px_-18px_rgba(0,0,0,0.9)] outline-none transition hover:bg-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:h-10 sm:px-4 sm:text-sm"
                          >
                            {actionLabel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#d8bd77]">
                            {promo.eyebrow}
                          </div>
                          <div className="font-mono text-[10px] text-[#8f846f]">
                            {String(index + 1).padStart(2, "0")}
                          </div>
                        </div>
                        <div className="mt-3 font-display text-xl leading-tight text-[#fff8e7]">
                          {promo.title}
                        </div>
                        <p className="mt-2 min-h-[3rem] text-sm leading-6 text-[#bfb19a]">
                          {promo.description}
                        </p>
                        <button
                          type="button"
                          onClick={() => handlePromoAction(promo)}
                          className="mt-4 inline-flex rounded-md font-semibold text-[#d8bd77] outline-none underline-offset-4 transition hover:text-[#f2d385] hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          {actionLabel}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {promoBanners.map((promo, index) => (
                <button
                  key={`${promo.title}-dot`}
                  type="button"
                  onClick={() => scrollPromoTo(index)}
                  className={`h-1.5 rounded-full transition ${
                    index === activePromoIndex ? "w-8 bg-[#d8bd77]" : "w-2 bg-[#6b5d42]"
                  }`}
                  aria-label={`Show offer ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      <main
        id="order"
        className="mx-auto w-full max-w-[1500px] px-5 py-10 sm:px-7 lg:px-[clamp(0.75rem,1.2vw,1.25rem)] lg:py-12"
      >
        <section id="menu" className="min-w-0 space-y-6 rounded-md border border-[#b8954e]/18 bg-[linear-gradient(180deg,rgba(13,15,14,0.82),rgba(5,5,4,0.98))] p-4 shadow-[0_28px_70px_-58px_rgba(0,0,0,0.9)] sm:p-5">
          <div className="flex flex-col gap-4 border-b border-[#b8954e]/20 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#d8bd77]">
                Online menu
              </p>
              <h2 className="mt-1.5 font-display text-4xl leading-tight text-[#fff8e7] sm:text-5xl">
                Choose your favorites
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#bfb19a]">
                Browse current availability from {branchName}. The menu refreshes automatically
                while the restaurant prepares fresh orders.
              </p>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 text-center text-xs text-muted-foreground md:w-auto">
              <MiniMetric
                icon={Clock3}
                value={openStatusLabel}
                label={todayHoursLabel}
                active={live?.isOpenNow}
              />
              <MiniMetric
                icon={MessageCircle}
                value="WhatsApp"
                label="quick contact"
                href={whatsappHref}
              />
              <MiniMetric icon={Sparkles} value={`${menuItems.length}`} label="available items" />
            </div>
          </div>

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
              <div className="ak-gold-frame sticky top-0 z-20 -mx-5 border-y px-5 py-4 backdrop-blur-md sm:-mx-7 sm:px-7 lg:mx-0 lg:rounded-md lg:border lg:px-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#d8bd77]">
                        Categories
                      </div>
                      <div className="shrink-0 font-mono text-[10px] text-[#ad9d82]">
                        {filteredItems.length}/{menuItems.length}
                      </div>
                    </div>
                    <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <CategoryButton active={cat === "all"} onClick={() => setCat("all")}>
                        All
                      </CategoryButton>
                      {categories.map((category) => (
                        <CategoryButton
                          key={category.id}
                          active={cat === category.id}
                          onClick={() => setCat(category.id)}
                        >
                          {category.name}
                        </CategoryButton>
                      ))}
                    </div>
                  </div>
                  <div className="relative w-full xl:max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search kebab, karahi, chai..."
                      className="h-11 rounded-md border-[#b8954e]/25 bg-black/45 pl-10 text-[#fff8e7] placeholder:text-[#8f846f]"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {displayedItems.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => addItem(item)}
                    className="ak-customer-card group overflow-hidden rounded-md border text-left shadow-card outline-none transition hover:-translate-y-0.5 hover:border-[#d8bd77]/65 hover:shadow-[0_16px_40px_-34px_rgba(216,189,119,0.8)] focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Add ${item.name} to cart`}
                  >
                    <div className="relative">
                      <MenuImage
                        item={item}
                        showImage={index < MENU_IMAGE_DISPLAY_LIMIT}
                        className="h-24 w-full rounded-none sm:h-28 lg:h-32"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/75 to-transparent" />
                      <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
                        {item.is_best_seller || mostOrdered.has(item.id) ? (
                          <ProductBadge>Best seller</ProductBadge>
                        ) : null}
                        {item.is_chef_recommended ? <ProductBadge>Chef pick</ProductBadge> : null}
                        {item.is_popular ? <ProductBadge>Popular</ProductBadge> : null}
                        {item.is_new_item ? <ProductBadge>New</ProductBadge> : null}
                      </div>
                    </div>
                    <div className="grid min-h-[96px] content-between gap-3 p-3">
                      <div>
                        <div className="line-clamp-2 text-sm font-semibold leading-5 text-[#fff8e7] sm:text-[15px]">
                          {item.name}
                        </div>
                        {item.description && (
                          <div className="mt-1 hidden text-xs leading-5 text-[#a99d89] sm:line-clamp-1 sm:block">
                            {item.description}
                          </div>
                        )}
                        {(item.spice_level || item.serving_size) && (
                          <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8f846f]">
                            {item.spice_level && <span>{item.spice_level}</span>}
                            {item.serving_size && <span>{item.serving_size}</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-[#e1c16f]">
                          {formatMoney(item.base_price, symbol)}
                        </span>
                        <span className="rounded-md bg-[#d8bd77] px-2.5 py-1 text-[11px] font-semibold text-[#130f08] transition group-hover:bg-[#f2d385]">
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
              {hasMoreItems && (
                <div className="flex justify-center pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-[#b8954e]/30 bg-black/25 text-[#f8efd8] hover:border-[#d8bd77]/65 hover:bg-[#2a2110]/70"
                    onClick={() =>
                      setVisibleItemCount((count) => count + VISIBLE_ITEMS_INCREMENT)
                    }
                  >
                    Show more items
                    <span className="ml-2 font-mono text-xs text-[#d8bd77]">
                      {displayedItems.length}/{filteredItems.length}
                    </span>
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {cartOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
            onClick={() => setCartOpen(false)}
            aria-label="Close cart"
          />
        )}
        <aside
          className={`ak-gold-frame fixed right-0 top-0 z-50 h-dvh w-full max-w-[520px] overflow-hidden border-l shadow-2xl transition duration-300 sm:w-[min(92vw,520px)] ${
            cartOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
          }`}
          aria-hidden={!cartOpen}
        >
          <div className="border-b border-[#b8954e]/25 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-display text-2xl">
                <ShoppingBag className="h-5 w-5 text-[#d8bd77]" />
                Your cart
              </h2>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => setCartOpen(false)}
                aria-label="Close cart"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {cartCount > 0
                ? `${cartCount} item${cartCount === 1 ? "" : "s"} selected.`
                : "Orders are unpaid until confirmed at the restaurant."}
            </p>
            <div className="mt-3 flex items-center justify-between rounded-md border border-border bg-secondary/35 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Need help?</span>
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#d8bd77] underline-offset-4 hover:text-[#f2d385] hover:underline"
              >
                Message us on WhatsApp
              </a>
            </div>
          </div>
          <div className="grid h-[calc(100dvh-116px)] gap-4 overflow-y-auto p-4">
            <div className="space-y-3">
            {lastOrder && (
              <div
                role="status"
                className="rounded-md border border-[#b8954e]/35 bg-[#1c1609]/55 p-3 text-sm"
              >
                <div className="font-medium text-[#f2d385]">Order {lastOrder.orderNo} received</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {lastOrder.diningType === "delivery" ? "Delivery" : "Takeaway"} total{" "}
                  {formatMoney(lastOrder.total, symbol)}. The restaurant will confirm timing.
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDiningType("takeaway")}
                aria-pressed={diningType === "takeaway"}
                className={`h-10 ${
                  diningType === "takeaway"
                    ? "ak-gold-cta"
                    : "border-[#b8954e]/28 bg-black/35 text-[#f8efd8] hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385]"
                }`}
              >
                Takeaway
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDiningType("delivery")}
                aria-pressed={diningType === "delivery"}
                className={`h-10 ${
                  diningType === "delivery"
                    ? "ak-gold-cta"
                    : "border-[#b8954e]/28 bg-black/35 text-[#f8efd8] hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385]"
                }`}
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
                  onChange={(e) => handleCustomerPhoneChange(e.target.value)}
                />
              </div>
            </div>
            <div className="rounded-md border border-border bg-secondary/25 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">Returning customer?</div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    Saved address and previous order from this phone.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={lookupSavedCustomer}
                  disabled={lookupLoading || !menu?.branch?.id}
                >
                  {lookupLoading && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Use saved details
                </Button>
              </div>

              {customerLookup && (
                <div className="mt-3 rounded-md border border-white/10 bg-black/20 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-foreground">
                        {customerLookup.customer.name || "Saved customer"}
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        {customerLookup.addresses.length} saved address
                        {customerLookup.addresses.length === 1 ? "" : "es"}
                      </div>
                    </div>
                    {customerLookup.lastOrder?.items.length ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={repeatLastOrder}
                      >
                        Repeat last order
                      </Button>
                    ) : null}
                  </div>
                  {customerLookup.customer.spicePreference && (
                    <div className="mt-2 rounded bg-secondary/45 px-2 py-1.5 text-muted-foreground">
                      Preference: {customerLookup.customer.spicePreference}
                    </div>
                  )}
                  {diningType === "delivery" && customerLookup.addresses.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {customerLookup.addresses.map((address) => (
                        <button
                          key={address.id}
                          type="button"
                          className="min-w-[180px] rounded-md border border-border bg-background/60 px-3 py-2 text-left transition hover:border-primary/55"
                          onClick={() => setDeliveryAddress(address.address)}
                        >
                          <div className="font-medium text-foreground">
                            {address.label}
                            {address.isDefault ? " - Default" : ""}
                          </div>
                          <div className="mt-1 line-clamp-2 text-muted-foreground">
                            {address.address}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

            <div className="flex items-start gap-2 rounded-md bg-secondary/45 p-3 text-xs leading-5 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#d8bd77]" />
              <span>
                {menu?.branch?.address ?? "Pickup details will be confirmed by the branch."}
              </span>
            </div>
            </div>

            <div className="grid gap-3">
              <div className="max-h-[300px] overflow-y-auto rounded-md border border-border p-3">
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

              <div className="space-y-3">
                <MoneyRow label="Subtotal" value={formatMoney(subtotal, symbol)} />
                <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
                  <Label htmlFor="coupon-code">Coupon code</Label>
                  <div className="flex gap-2">
                    <Input
                      id="coupon-code"
                      value={couponCode}
                      onChange={(event) => {
                        setCouponCode(event.target.value.toUpperCase());
                        setCouponDiscount(0);
                        setCouponDiscountType(null);
                        setCouponMessage("");
                      }}
                      placeholder="ANGAR100"
                      className="uppercase"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={applyCoupon}
                      disabled={checkingCoupon || cart.length === 0}
                    >
                      {checkingCoupon && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Apply
                    </Button>
                  </div>
                  {couponMessage && <div className="text-xs text-success">{couponMessage}</div>}
                </div>
                {couponDiscount > 0 && (
                  <MoneyRow label="Coupon" value={`-${formatMoney(couponDiscount, symbol)}`} muted />
                )}
                {deliveryFee > 0 && (
                  <MoneyRow label="Delivery fee" value={formatMoney(deliveryFee, symbol)} muted />
                )}
                <MoneyRow label="Taxes" value={formatMoney(taxTotal, symbol)} muted />
                <MoneyRow label="Total" value={formatMoney(total, symbol)} strong />
                <Button
                  className="ak-gold-cta w-full"
                  size="lg"
                  onClick={submitOrder}
                  disabled={submitting || cart.length === 0 || !menu?.branch?.id}
                >
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Place order
                </Button>
                <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs leading-5 text-muted-foreground">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#d8bd77]" />
                  <span>Customer accounts can order here. Operational access is staff-only.</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {menu?.branch && (
          <section className="mt-12 overflow-hidden rounded-md border border-[#b8954e]/24 bg-[linear-gradient(135deg,rgba(26,20,11,0.92),rgba(7,6,5,0.98)_62%,rgba(20,11,6,0.9))] p-5 shadow-[0_26px_70px_-56px_rgba(216,189,119,0.55)] sm:p-7">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#d8bd77]">
                  Customer trust
                </p>
                <h2 className="mt-1.5 font-display text-4xl leading-tight text-[#fff8e7] sm:text-5xl">
                  Verified guest reviews
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#bfb19a]">
                  Reviews are linked to completed customer orders, so public feedback stays
                  verified instead of open to fake comments.
                </p>
              </div>
              <div className="rounded-md border border-[#d8bd77]/35 bg-black/36 px-5 py-4">
                <div className="font-mono text-2xl text-[#d8bd77]">
                  {(menu.reviews?.averageRating ?? 0).toFixed(1)}
                </div>
                <div className="text-xs text-[#bfb19a]">
                  from {menu.reviews?.totalReviews ?? 0} verified review
                  {menu.reviews?.totalReviews === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            {(menu.reviews?.recent.length ?? 0) > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {menu.reviews!.recent.slice(0, 3).map((review) => (
                  <article
                    key={review.id}
                    className="rounded-md border border-[#b8954e]/22 bg-black/28 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-sm text-[#d8bd77]">
                        Rating {review.rating}/5
                      </div>
                      <span className="rounded-md border border-[#b8954e]/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f8efd8]">
                        Verified
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-4 text-sm leading-6 text-[#d8cdb8]">
                      {review.review || "A verified customer enjoyed their Angaar Kitchen order."}
                    </p>
                    <div className="mt-3 text-xs text-[#8f846f]">
                      {review.customerName || "Angaar customer"}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <TrustCard
                  title="Verified only"
                  text="Reviews appear after completed orders and admin approval."
                />
                <TrustCard
                  title="Order-linked"
                  text="Feedback stays connected to real customer history and repeat orders."
                />
                <TrustCard
                  title="No fake reviews"
                  text="The site will not show invented ratings while the review base is growing."
                />
              </div>
            )}
          </section>
        )}
      </main>

      {cartCount > 0 && !cartOpen && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-4 z-30 flex h-14 items-center justify-between rounded-md border border-[#d8bd77]/45 bg-[#0a0805]/95 px-4 text-left shadow-2xl backdrop-blur-md md:hidden"
        >
          <span className="font-semibold text-[#fff8e7]">
            {cartCount} item{cartCount === 1 ? "" : "s"} · {formatMoney(total, symbol)}
          </span>
          <span className="text-sm font-semibold text-[#d8bd77]">View cart</span>
        </button>
      )}

      <footer className="border-t border-[#b8954e]/25 bg-[linear-gradient(180deg,#080705_0%,#030303_100%)] px-5 py-14 sm:px-7 lg:px-[clamp(1rem,1.5vw,1.875rem)]">
        <div className="mx-auto grid max-w-[1500px] gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Flame className="h-9 w-9 fill-primary text-primary drop-shadow-[0_0_16px_rgba(255,113,45,0.35)]" />
              <div>
                <div className="font-display text-2xl leading-none text-[#fff8e7]">
                  {displayRestaurantName}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.34em] text-[#d8bd77]">
                  Flavor forged in fire
                </div>
              </div>
            </div>
            <div className="ak-ornate-line mt-4 h-px w-48" />
            <p className="mt-4 max-w-md text-sm leading-6 text-[#bfb19a]">
              Charcoal grills, desi heat, and family-style food prepared fresh for takeaway,
              delivery, and nights worth remembering.
            </p>
            <div className="mt-5 grid max-w-md grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-4">
              <span className="rounded-md border border-[#b8954e]/25 bg-[#1c1609]/55 px-3 py-2 text-[#f8efd8]">
                Smoky grills
              </span>
              <span className="rounded-md border border-[#b8954e]/25 bg-[#1c1609]/55 px-3 py-2 text-[#f8efd8]">
                Rich flavors
              </span>
              <span className="rounded-md border border-[#b8954e]/25 bg-[#1c1609]/55 px-3 py-2 text-[#f8efd8]">
                Warm service
              </span>
              <span className="rounded-md border border-[#b8954e]/25 bg-[#1c1609]/55 px-3 py-2 text-[#f8efd8]">
                Made to share
              </span>
            </div>
            <div className="mt-5 flex gap-2">
              <SocialButton icon={Facebook} label="Facebook" />
              <SocialButton icon={Instagram} label="Instagram" />
              <SocialButton icon={MessageCircle} label="WhatsApp" href={whatsappHref} />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8bd77]">Visit</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex gap-2">
                <MapPin className="mt-1 h-4 w-4 shrink-0 text-[#d8bd77]" />
                <span>{footerAddress}</span>
              </div>
              <div className="flex gap-2">
                <Clock3 className="mt-1 h-4 w-4 shrink-0 text-[#d8bd77]" />
                <span>{todayHoursLabel}</span>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.24em] text-[#d8bd77]">Order</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="flex gap-2 rounded-md outline-none transition hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary"
              >
                <MessageCircle className="mt-1 h-4 w-4 shrink-0 text-[#d8bd77]" />
                <span>WhatsApp {contactPhone}</span>
              </a>
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="inline-flex rounded-md font-semibold text-[#d8bd77] outline-none underline-offset-4 hover:text-[#f2d385] hover:underline focus-visible:ring-2 focus-visible:ring-primary"
              >
                Open cart
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative whitespace-nowrap rounded-full border px-5 py-2.5 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary ${
        active
          ? "border-[#d8bd77]/70 bg-[#d8bd77] text-[#130f08] shadow-[0_12px_26px_-24px_rgba(216,189,119,0.85)]"
          : "border-[#b8954e]/22 bg-black/35 text-[#d7ccb6] hover:border-[#d8bd77]/60 hover:bg-[#2a2110]/70 hover:text-[#f8efd8]"
      }`}
    >
      {children}
    </button>
  );
}

function ProductBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[#d8bd77]/35 bg-black/72 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f8efd8] backdrop-blur-sm">
      {children}
    </span>
  );
}

function TrustCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="rounded-md border border-[#b8954e]/22 bg-black/28 p-4">
      <div className="font-display text-xl text-[#fff8e7]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[#bfb19a]">{text}</p>
    </article>
  );
}

function CartButton({
  cartCount,
  onClick,
  fullWidth = false,
}: {
  cartCount: number;
  onClick: () => void;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8954e]/28 bg-black/35 px-4 text-sm font-semibold text-[#f8efd8] outline-none transition hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary ${
        fullWidth ? "w-full" : ""
      }`}
      aria-label={`Open cart with ${cartCount} item${cartCount === 1 ? "" : "s"}`}
    >
      <ShoppingBag className="h-[18px] w-[18px]" />
      Cart
      <span className="ml-1 inline-flex min-w-6 items-center justify-center rounded-full bg-[#d8bd77] px-2 py-0.5 font-mono text-xs text-[#130f08]">
        {cartCount}
      </span>
    </button>
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
  workspacePath,
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
  workspacePath: string;
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
          className={`inline-flex h-10 items-center justify-center gap-2.5 rounded-md border border-[#b8954e]/28 bg-black/35 px-4 text-sm font-semibold text-[#f8efd8] outline-none transition hover:border-[#d8bd77]/70 hover:bg-[#2a2110]/70 hover:text-[#f2d385] focus-visible:ring-2 focus-visible:ring-primary ${fullWidth ? "w-full" : ""}`}
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
              <a href={workspacePath}>
                <LogIn className="h-4 w-4" />
                Open operations
              </a>
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
            <Button type="submit" className="ak-gold-cta h-11" disabled={signingIn}>
              {signingIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in
            </Button>
            <div className="text-xs text-muted-foreground">
              Staff access is created by an owner or admin.
            </div>
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeroSignal({
  icon: Icon,
  label,
  eyebrow,
  href,
}: {
  icon: LucideIcon;
  label: string;
  eyebrow: string;
  href?: string;
}) {
  const className =
    "ak-gold-frame block rounded-md border px-3 py-3 text-left backdrop-blur-[2px] transition hover:border-[#d8bd77]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";
  const content = (
    <>
      <Icon className="h-7 w-7 text-[#d8bd77]" aria-hidden="true" />
      <div className="mt-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9d8f75]">
        {eyebrow}
      </div>
      <div className="mt-1 text-xs font-semibold leading-4 text-[#f8efd8]">{label}</div>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <div className={className}>
      {content}
    </div>
  );
}

function SocialButton({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
}) {
  const className =
    "flex h-10 w-10 items-center justify-center rounded-full border border-[#b8954e]/28 bg-black/35 text-[#f8efd8] outline-none transition hover:-translate-y-0.5 hover:border-[#d8bd77] hover:bg-[#d8bd77] hover:text-[#130f08] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black";
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className} aria-label={label}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
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
  href,
  active,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  href?: string;
  active?: boolean;
}) {
  const className =
    "ak-customer-card block rounded-md border px-3 py-2 transition hover:border-[#d8bd77]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const content = (
    <>
      <Icon
        className={`mx-auto mb-1 h-4 w-4 ${active ? "text-emerald-400" : "text-[#d8bd77]"}`}
        aria-hidden="true"
      />
      <div className="font-mono text-[11px] text-[#fff8e7]">{value}</div>
      <div className="text-[10px] text-[#aa9d87]">{label}</div>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }
  return (
    <div className={className}>
      {content}
    </div>
  );
}

function MenuImage({
  item,
  showImage,
  className,
}: {
  item: CustomerMenuItem;
  showImage: boolean;
  className: string;
}) {
  if (showImage && item.image_url) {
    return (
      <img
        src={optimizeCloudinaryImageUrl(item.image_url, { width: 520, height: 360 }) ?? item.image_url}
        srcSet={cloudinaryImageSrcSet(item.image_url, [320, 520, 760])}
        sizes="(min-width: 1536px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
        alt={item.name}
        loading="lazy"
        fetchPriority="low"
        decoding="async"
        className={`${className} rounded-md object-cover transition duration-500 group-hover:scale-105`}
      />
    );
  }

  return (
    <div
      className={`${className} flex items-center justify-center rounded-md border border-[#b8954e]/25 bg-[radial-gradient(circle_at_top,rgba(216,189,119,0.18),rgba(8,7,5,0.98)_58%)]`}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <ChefHat className="h-7 w-7 text-[#d8bd77]" />
        <span className="px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bfb19a]">
          angaar kitchen
        </span>
      </div>
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
      <span className={`font-mono ${strong ? "text-[#d8bd77]" : ""}`}>{value}</span>
    </div>
  );
}

function formatClock(value: string) {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

const CURATED_MENU_PATTERNS: RegExp[] = [
  /\bchicken\b.*\bkarahi\b|\bkarahi\b.*\bchicken\b/i,
  /\bchicken\b.*\bbiryani\b|\bbiryani\b.*\bchicken\b|\bbiryani\b/i,
  /\bbeef\b.*\b(dam\s*)?pulao\b|\b(dam\s*)?pulao\b.*\bbeef\b/i,
  /\bmutton\b.*\bkarahi\b|\bkarahi\b.*\bmutton\b/i,
  /\bbeef\b.*\bkarahi\b|\bkarahi\b.*\bbeef\b/i,
  /\b(bbq|bar\s*b\s*q|seekh|kebab|kabab|tikka|malai\s*boti|boti|grill)\b/i,
  /\b(raita|mint\s*raita|zeera\s*raita)\b/i,
  /\b(sauce|imli|chutney)\b/i,
  /\b(cold\s*drink|drink|pepsi|coke|cola|sprite|7up|water)\b/i,
  /\b(chai|tea)\b/i,
  /\b(naan|roti|paratha)\b/i,
  /\b(handi|daal|dal|shahi)\b/i,
];

function curateInitialMenuItems(
  items: CustomerMenuItem[],
  categories: CustomerCategory[],
) {
  if (items.length <= 1) return items;
  const selected: CustomerMenuItem[] = [];
  const selectedIds = new Set<string>();
  const regularItems = items.filter((item) => !isLowPriorityMenuItem(item, categories));
  const lowPriorityItems = items.filter((item) => isLowPriorityMenuItem(item, categories));

  for (const pattern of CURATED_MENU_PATTERNS) {
    const match = regularItems.find((item) => !selectedIds.has(item.id) && pattern.test(menuSearchText(item)));
    if (match) {
      selected.push(match);
      selectedIds.add(match.id);
    }
  }

  for (const item of diversifyMenuItemsByCategory(regularItems, categories)) {
    if (!selectedIds.has(item.id)) {
      selected.push(item);
      selectedIds.add(item.id);
    }
  }

  return [...selected, ...lowPriorityItems.filter((item) => !selectedIds.has(item.id))];
}

function diversifyMenuItemsByCategory(items: CustomerMenuItem[], categories: CustomerCategory[]) {
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  const groups = new Map<string, CustomerMenuItem[]>();

  for (const item of items) {
    const group = groups.get(item.category_id) ?? [];
    group.push(item);
    groups.set(item.category_id, group);
  }

  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) => (categoryOrder.get(left) ?? 999) - (categoryOrder.get(right) ?? 999))
    .map(([, group]) => group);
  const diversified: CustomerMenuItem[] = [];
  for (let round = 0; diversified.length < items.length; round += 1) {
    let added = false;
    for (const group of orderedGroups) {
      if (group[round]) {
        diversified.push(group[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return diversified;
}

function isLowPriorityMenuItem(item: CustomerMenuItem, categories: CustomerCategory[]) {
  const category = categories.find((entry) => entry.id === item.category_id)?.name ?? "";
  return /\b(deal|combo|offer|delivery|charge|fee)\b/i.test(`${item.name} ${category}`);
}

function menuSearchText(item: CustomerMenuItem) {
  return `${item.name} ${item.description ?? ""}`;
}

function displayLocation(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return !text || text.toLowerCase() === "pakistan" ? DEFAULT_LOCATION : text;
}

function buildWhatsAppHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized || "923357200955"}`;
}
