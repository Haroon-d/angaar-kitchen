import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { hasPermission } from "@/lib/rbac";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/promotions")({
  component: PromotionsPage,
});

type CouponRow = {
  id: string;
  restaurant_id: string;
  code: string;
  name: string;
  discount_type: "amount" | "percent" | "free_delivery";
  discount_value: number | string;
  max_discount: number | string | null;
  min_order_total: number | string;
  usage_limit: number | string | null;
  per_customer_limit: number | string;
  applies_to: "both" | "pos" | "website";
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

type CouponForm = {
  code: string;
  name: string;
  discount_type: "amount" | "percent" | "free_delivery";
  discount_value: string;
  max_discount: string;
  min_order_total: string;
  usage_limit: string;
  per_customer_limit: string;
  applies_to: "both" | "pos" | "website";
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

type HomepagePromotionRow = {
  id: string;
  restaurant_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  image_url: string | null;
  cta_text: string;
  cta_link: string;
  action_type: "link" | "whatsapp" | "menu_item";
  menu_item_id: string | null;
  start_date: string | null;
  end_date: string | null;
  priority: number | string;
  is_active: boolean;
  created_at: string;
};

type HomepagePromotionForm = {
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  cta_text: string;
  cta_link: string;
  action_type: "link" | "whatsapp" | "menu_item";
  menu_item_id: string;
  start_date: string;
  end_date: string;
  priority: string;
  is_active: boolean;
};

function PromotionsPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const qc = useQueryClient();
  const canManage = hasPermission(roles, "customers:manage") || hasPermission(roles, "orders:adjust");
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["coupon-campaigns", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coupon_campaigns")
        .select(
          "id, restaurant_id, code, name, discount_type, discount_value, max_discount, min_order_total, usage_limit, per_customer_limit, applies_to, starts_at, ends_at, is_active, created_at",
        )
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CouponRow[];
    },
  });

  const promosQ = useQuery({
    queryKey: ["homepage-promotions", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_promotions")
        .select(
          "id, restaurant_id, title, subtitle, description, image_url, cta_text, cta_link, action_type, menu_item_id, start_date, end_date, priority, is_active, created_at",
        )
        .eq("restaurant_id", restaurant!.id)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as HomepagePromotionRow[];
    },
  });

  const coupons = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data ?? []).filter((coupon) => {
      if (!term) return true;
      return [coupon.code, coupon.name, coupon.applies_to]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [q.data, search]);

  if (!restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a restaurant first.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Promotions</h1>
          <p className="text-sm text-muted-foreground">
            Coupons for POS and online ordering, with limits and expiry controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 sm:w-72"
              placeholder="Search coupons"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {canManage && (
            <>
              <HomepagePromotionDialog
                restaurantId={restaurant.id}
                branchId={branch?.id ?? null}
                onSaved={() => qc.invalidateQueries({ queryKey: ["homepage-promotions"] })}
              />
              <CouponDialog
                restaurantId={restaurant.id}
                onSaved={() => qc.invalidateQueries({ queryKey: ["coupon-campaigns"] })}
              />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Active coupons" value={(q.data ?? []).filter((coupon) => coupon.is_active).length} />
        <Metric label="Website offers" value={(q.data ?? []).filter((coupon) => coupon.applies_to !== "pos").length} />
        <Metric label="Homepage banners" value={(promosQ.data ?? []).filter((promo) => promo.is_active).length} />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-2xl">Homepage banners</h2>
          <p className="text-sm text-muted-foreground">
            Customer-facing promo cards below the hero. Active banners auto-hide outside their date window.
          </p>
        </div>
        {promosQ.isLoading ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-border">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (promosQ.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No homepage banners yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 xl:grid-cols-3">
            {(promosQ.data ?? []).map((promo) => (
              <HomepagePromotionCard
                key={promo.id}
                promo={promo}
                branchId={branch?.id ?? null}
                canManage={canManage}
                onChanged={() => qc.invalidateQueries({ queryKey: ["homepage-promotions"] })}
              />
            ))}
          </div>
        )}
      </section>

      {q.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : coupons.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Gift className="mx-auto mb-3 h-8 w-8 opacity-50" />
            No coupons yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {coupons.map((coupon) => (
            <CouponCard
              key={coupon.id}
              coupon={coupon}
              symbol={symbol}
              canManage={canManage}
              onChanged={() => qc.invalidateQueries({ queryKey: ["coupon-campaigns"] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HomepagePromotionCard({
  promo,
  branchId,
  canManage,
  onChanged,
}: {
  promo: HomepagePromotionRow;
  branchId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const activeNow = isPromotionCurrentlyActive(promo);

  async function toggleActive(active: boolean) {
    const { error } = await supabase
      .from("homepage_promotions")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", promo.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(active ? "Banner activated" : "Banner paused");
    onChanged();
  }

  async function deleteBanner() {
    const { error } = await supabase.from("homepage_promotions").delete().eq("id", promo.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Banner deleted");
    onChanged();
  }

  return (
    <article className="rounded-lg border border-border bg-card/60 p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={activeNow ? "outline" : "secondary"}>
              {activeNow ? "Live" : promo.is_active ? "Scheduled/expired" : "Paused"}
            </Badge>
            <Badge variant="outline">Priority {promo.priority}</Badge>
          </div>
          <h2 className="mt-3 font-display text-xl">{promo.title}</h2>
          {promo.subtitle && <div className="mt-1 text-sm text-primary">{promo.subtitle}</div>}
          {promo.description && (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
              {promo.description}
            </p>
          )}
        </div>
        {canManage && <Switch checked={promo.is_active} onCheckedChange={toggleActive} />}
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <Info
          label="Action"
          value={
            promo.action_type === "menu_item"
              ? `Add menu item (${promo.menu_item_id ?? "not selected"})`
              : `${promo.cta_text} -> ${promo.cta_link}`
          }
        />
        <Info
          label="Window"
          value={`${promo.start_date ? formatDate(promo.start_date) : "Now"} - ${
            promo.end_date ? formatDate(promo.end_date) : "No expiry"
          }`}
        />
      </div>
      {canManage && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <HomepagePromotionDialog
            restaurantId={promo.restaurant_id}
            branchId={branchId}
            promo={promo}
            onSaved={onChanged}
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete homepage banner?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes "{promo.title}" from the customer slider. Existing orders and menu
                  items are not affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteBanner}>Delete banner</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </article>
  );
}

function HomepagePromotionDialog({
  restaurantId,
  branchId,
  promo,
  onSaved,
}: {
  restaurantId: string;
  branchId: string | null;
  promo?: HomepagePromotionRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isEditing = Boolean(promo);
  const [form, setForm] = useState<HomepagePromotionForm>(() =>
    promo ? homepagePromotionToForm(promo) : emptyHomepagePromotionForm(),
  );
  const menuItemsQ = useQuery({
    queryKey: ["promotion-menu-items", branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_items")
        .select("id, name, base_price, is_available")
        .eq("branch_id", branchId!)
        .eq("is_available", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; base_price: string | number }>;
    },
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error("Banner title is required.");
      return;
    }
    if (!form.image_url.trim()) {
      toast.error("Banner image URL is required.");
      return;
    }
    if (form.action_type === "menu_item" && !form.menu_item_id) {
      toast.error("Select the menu item this banner should add to cart.");
      return;
    }
    if (form.action_type !== "menu_item" && !form.cta_link.trim()) {
      toast.error("CTA link is required for link and WhatsApp banners.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        restaurant_id: restaurantId,
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        cta_text: form.cta_text.trim() || "Order now",
        cta_link: form.cta_link.trim() || "#order",
        action_type: form.action_type,
        menu_item_id: form.action_type === "menu_item" ? form.menu_item_id : null,
        start_date: nullableDateTime(form.start_date),
        end_date: nullableDateTime(form.end_date),
        priority: Number.isFinite(Number(form.priority)) ? Number(form.priority) : 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      const { error } = promo
        ? await supabase.from("homepage_promotions").update(payload).eq("id", promo.id)
        : await supabase.from("homepage_promotions").insert(payload);
      if (error) throw new Error(error.message);
      toast.success(isEditing ? "Homepage banner updated" : "Homepage banner created");
      if (!isEditing) {
        setForm(emptyHomepagePromotionForm());
      }
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save banner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setForm(promo ? homepagePromotionToForm(promo) : emptyHomepagePromotionForm());
        }
      }}
    >
      <Button variant="outline" size={isEditing ? "sm" : "default"} onClick={() => setOpen(true)}>
        {isEditing ? <Pencil className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
        {isEditing ? "Edit" : "Homepage banner"}
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit homepage banner" : "New homepage banner"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Family BBQ platter"
              />
            </Field>
            <Field label="Subtitle">
              <Input
                value={form.subtitle}
                onChange={(event) => setForm({ ...form, subtitle: event.target.value })}
                placeholder="Weekend offer"
              />
            </Field>
            <Field label="CTA text">
              <Input
                value={form.cta_text}
                onChange={(event) => setForm({ ...form, cta_text: event.target.value })}
              />
            </Field>
            <Field label="CTA link">
              <Input
                value={form.cta_link}
                onChange={(event) => setForm({ ...form, cta_link: event.target.value })}
                placeholder={form.action_type === "whatsapp" ? "https://wa.me/923..." : "#order or https://..."}
              />
            </Field>
            <Field label="Image URL">
              <Input
                value={form.image_url}
                onChange={(event) => setForm({ ...form, image_url: event.target.value })}
                placeholder="Cloudinary URL recommended"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Design banner at 1600 x 700 px. Paste the normal Cloudinary image URL; the
                website optimizes it automatically.
              </p>
            </Field>
            <Field label="Action type">
              <Select
                value={form.action_type}
                onValueChange={(action_type: "link" | "whatsapp" | "menu_item") =>
                  setForm({
                    ...form,
                    action_type,
                    cta_text: action_type === "menu_item" ? "Order Now" : form.cta_text,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="menu_item">Add menu item to cart</SelectItem>
                  <SelectItem value="whatsapp">Open WhatsApp/link</SelectItem>
                  <SelectItem value="link">Open page/link</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.action_type === "menu_item" && (
              <Field label="Menu item/deal">
                <Select
                  value={form.menu_item_id}
                  onValueChange={(menu_item_id) => setForm({ ...form, menu_item_id })}
                  disabled={!branchId || menuItemsQ.isLoading}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={menuItemsQ.isLoading ? "Loading items..." : "Select item"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(menuItemsQ.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Priority">
              <Input
                type="number"
                value={form.priority}
                onChange={(event) => setForm({ ...form, priority: event.target.value })}
              />
            </Field>
            <Field label="Starts at">
              <Input
                type="datetime-local"
                value={form.start_date}
                onChange={(event) => setForm({ ...form, start_date: event.target.value })}
              />
            </Field>
            <Field label="Ends at">
              <Input
                type="datetime-local"
                value={form.end_date}
                onChange={(event) => setForm({ ...form, end_date: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Description">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Short customer-facing banner copy"
            />
          </Field>
          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm font-medium">Active</span>
            <Switch
              checked={form.is_active}
              onCheckedChange={(is_active) => setForm({ ...form, is_active })}
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : "Save banner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CouponCard({
  coupon,
  symbol,
  canManage,
  onChanged,
}: {
  coupon: CouponRow;
  symbol: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const discount =
    coupon.discount_type === "free_delivery"
      ? "Free delivery"
      : coupon.discount_type === "percent"
      ? `${Number(coupon.discount_value)}%`
      : formatMoney(coupon.discount_value, symbol);
  const activeNow = isCouponCurrentlyActive(coupon);

  async function toggleActive(active: boolean) {
    const { error } = await supabase
      .from("coupon_campaigns")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", coupon.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(active ? "Coupon activated" : "Coupon paused");
    onChanged();
  }

  return (
    <article className="rounded-lg border border-border bg-card/60 p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md bg-primary/12 px-2.5 py-1 font-mono text-sm font-semibold text-primary">
              {coupon.code}
            </div>
            <Badge variant="outline" className="capitalize">
              {coupon.applies_to}
            </Badge>
            <Badge variant={activeNow ? "outline" : "secondary"}>
              {activeNow ? "Live" : coupon.is_active ? "Scheduled/expired" : "Paused"}
            </Badge>
          </div>
          <h2 className="mt-3 font-display text-xl">{coupon.name}</h2>
          <div className="mt-1 text-sm text-muted-foreground">
            {coupon.discount_type === "free_delivery" ? discount : `${discount} off`}
            {Number(coupon.min_order_total) > 0
              ? ` after ${formatMoney(coupon.min_order_total, symbol)}`
              : ""}
            {coupon.discount_type === "percent" && coupon.max_discount
              ? `, capped at ${formatMoney(coupon.max_discount, symbol)}`
              : ""}
          </div>
        </div>
        {canManage && (
          <Switch checked={coupon.is_active} onCheckedChange={toggleActive} />
        )}
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <Info label="Usage limit" value={coupon.usage_limit ? String(coupon.usage_limit) : "No limit"} />
        <Info label="Per customer" value={String(coupon.per_customer_limit)} />
        <Info
          label="Window"
          value={`${coupon.starts_at ? formatDate(coupon.starts_at) : "Now"} - ${
            coupon.ends_at ? formatDate(coupon.ends_at) : "No expiry"
          }`}
        />
      </div>
    </article>
  );
}

function CouponDialog({
  restaurantId,
  onSaved,
}: {
  restaurantId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CouponForm>(() => emptyCouponForm());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const code = normalizeCouponCode(form.code);
    if (!code) {
      toast.error("Coupon code is required.");
      return;
    }
    const value = Number(form.discount_value);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Discount value must be greater than zero.");
      return;
    }
    if (form.discount_type === "percent" && value > 100) {
      toast.error("Percentage discount cannot be more than 100%.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("coupon_campaigns").insert({
        restaurant_id: restaurantId,
        code,
        name: form.name.trim() || code,
        discount_type: form.discount_type,
        discount_value: value.toFixed(2),
        max_discount: nullableMoney(form.max_discount),
        min_order_total: moneyOrZero(form.min_order_total),
        usage_limit: nullableInteger(form.usage_limit),
        per_customer_limit: Math.max(1, nullableInteger(form.per_customer_limit) ?? 1),
        applies_to: form.applies_to,
        starts_at: nullableDateTime(form.starts_at),
        ends_at: nullableDateTime(form.ends_at),
        is_active: form.is_active,
      });
      if (error) throw new Error(error.message);
      toast.success("Coupon created");
      setForm(emptyCouponForm());
      setOpen(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save coupon");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        New coupon
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New coupon</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code">
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
                placeholder="ANGAR100"
              />
            </Field>
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Weekend reward"
              />
            </Field>
            <Field label="Discount type">
              <Select
                value={form.discount_type}
                onValueChange={(discount_type: "amount" | "percent" | "free_delivery") =>
                  setForm({ ...form, discount_type })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">Rs amount off</SelectItem>
                  <SelectItem value="percent">Percentage off</SelectItem>
                  <SelectItem value="free_delivery">Free delivery</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Discount value">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.discount_value}
                onChange={(event) => setForm({ ...form, discount_value: event.target.value })}
              />
            </Field>
            <Field label="Minimum order">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.min_order_total}
                onChange={(event) => setForm({ ...form, min_order_total: event.target.value })}
              />
            </Field>
            <Field label="Max discount">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.max_discount}
                onChange={(event) => setForm({ ...form, max_discount: event.target.value })}
                placeholder="Only for % coupons"
              />
            </Field>
            <Field label="Usage limit">
              <Input
                type="number"
                min="1"
                value={form.usage_limit}
                onChange={(event) => setForm({ ...form, usage_limit: event.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Per customer limit">
              <Input
                type="number"
                min="1"
                value={form.per_customer_limit}
                onChange={(event) => setForm({ ...form, per_customer_limit: event.target.value })}
              />
            </Field>
            <Field label="Applies to">
              <Select
                value={form.applies_to}
                onValueChange={(applies_to: "both" | "pos" | "website") =>
                  setForm({ ...form, applies_to })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Website and POS</SelectItem>
                  <SelectItem value="website">Website only</SelectItem>
                  <SelectItem value="pos">POS only</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Starts at">
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
              />
            </Field>
            <Field label="Ends at">
              <Input
                type="datetime-local"
                value={form.ends_at}
                onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <span className="text-sm font-medium">Active</span>
            <Switch
              checked={form.is_active}
              onCheckedChange={(is_active) => setForm({ ...form, is_active })}
            />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save coupon
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/35 p-3">
      <div className="uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-foreground">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function emptyCouponForm(): CouponForm {
  return {
    code: "",
    name: "",
    discount_type: "amount",
    discount_value: "",
    max_discount: "",
    min_order_total: "0",
    usage_limit: "",
    per_customer_limit: "1",
    applies_to: "both",
    starts_at: "",
    ends_at: "",
    is_active: true,
  };
}

function emptyHomepagePromotionForm(): HomepagePromotionForm {
  return {
    title: "",
    subtitle: "",
    description: "",
    image_url: "",
    cta_text: "Order now",
    cta_link: "#order",
    action_type: "menu_item",
    menu_item_id: "",
    start_date: "",
    end_date: "",
    priority: "0",
    is_active: true,
  };
}

function homepagePromotionToForm(promo: HomepagePromotionRow): HomepagePromotionForm {
  return {
    title: promo.title ?? "",
    subtitle: promo.subtitle ?? "",
    description: promo.description ?? "",
    image_url: promo.image_url ?? "",
    cta_text: promo.cta_text ?? "Order now",
    cta_link: promo.cta_link ?? "#order",
    action_type: promo.action_type ?? "link",
    menu_item_id: promo.menu_item_id ?? "",
    start_date: toDatetimeLocalValue(promo.start_date),
    end_date: toDatetimeLocalValue(promo.end_date),
    priority: String(promo.priority ?? 0),
    is_active: promo.is_active,
  };
}

function toDatetimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function moneyOrZero(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "0.00";
}

function nullableMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : null;
}

function nullableInteger(value: string) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function nullableDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function isCouponCurrentlyActive(coupon: CouponRow) {
  const now = Date.now();
  const startsAt = coupon.starts_at ? new Date(coupon.starts_at).getTime() : null;
  const endsAt = coupon.ends_at ? new Date(coupon.ends_at).getTime() : null;
  return coupon.is_active && (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
}

function isPromotionCurrentlyActive(promo: HomepagePromotionRow) {
  const now = Date.now();
  const startsAt = promo.start_date ? new Date(promo.start_date).getTime() : null;
  const endsAt = promo.end_date ? new Date(promo.end_date).getTime() : null;
  return promo.is_active && (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
}
