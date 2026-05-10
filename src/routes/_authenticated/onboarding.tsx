import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { Flame, Loader2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/onboarding")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: OnboardingPage,
});

const Schema = z.object({
  restaurant_name: z.string().min(2).max(80),
  legal_name: z.string().max(120).optional(),
  currency_symbol: z.string().min(1).max(4),
  currency: z.string().min(2).max(8),
  branch_name: z.string().min(2).max(80),
  branch_code: z.string().min(1).max(8).regex(/^[A-Z0-9]+$/, "Uppercase letters and numbers only"),
  branch_address: z.string().max(200).optional(),
  branch_phone: z.string().max(40).optional(),
});

const CURRENCIES = [
  { sym: "₹", code: "INR", label: "Indian Rupee (₹)" },
  { sym: "$", code: "USD", label: "US Dollar ($)" },
  { sym: "€", code: "EUR", label: "Euro (€)" },
  { sym: "£", code: "GBP", label: "British Pound (£)" },
  { sym: "AED", code: "AED", label: "UAE Dirham (AED)" },
];

function OnboardingPage() {
  const { user } = useAuth();
  const { refetch } = useActiveBranch();
  const { refetch: refetchRoles } = useMyRoles();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    restaurant_name: "",
    legal_name: "",
    currency_symbol: "₹",
    currency: "INR",
    branch_name: "Main Branch",
    branch_code: "MAIN",
    branch_address: "",
    branch_phone: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Schema.safeParse(f);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!user) return;

    setLoading(true);
    try {
      // 1. Create restaurant
      const { data: r, error: rErr } = await supabase.from("restaurants").insert({
        owner_id: user.id,
        name: f.restaurant_name,
        legal_name: f.legal_name || null,
        currency: f.currency,
        currency_symbol: f.currency_symbol,
      }).select().single();
      if (rErr) throw rErr;

      // 2. Owner role
      const { error: roleErr } = await supabase.from("user_roles").insert({
        user_id: user.id, restaurant_id: r.id, role: "owner", branch_id: null,
      });
      if (roleErr) throw roleErr;

      // 3. First branch
      const { data: b, error: bErr } = await supabase.from("branches").insert({
        restaurant_id: r.id,
        name: f.branch_name,
        code: f.branch_code.toUpperCase(),
        address: f.branch_address || null,
        phone: f.branch_phone || null,
      }).select().single();
      if (bErr) throw bErr;

      // 4. Default operating hours (10am-10pm)
      await supabase.from("operating_hours").insert(
        Array.from({ length: 7 }).map((_, weekday) => ({
          branch_id: b.id, weekday, open_time: "10:00", close_time: "22:00", is_closed: false,
        }))
      );

      toast.success("Restaurant created. Let's get cooking.");
      refetchRoles();
      refetch();
      nav({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen ember-glow grain bg-coal-gradient overflow-hidden">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:py-16">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ember-gradient shadow-ember">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl">Angaar Kitchen</span>
        </div>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-3xl">Set up your restaurant</CardTitle>
            <CardDescription>This takes about a minute. You can change anything later in Settings.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Restaurant name</Label>
                  <Input value={f.restaurant_name} onChange={(e) => set("restaurant_name")(e.target.value)} placeholder="Angaar Kitchen" required />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Legal / business name (optional)</Label>
                  <Input value={f.legal_name} onChange={(e) => set("legal_name")(e.target.value)} placeholder="Angaar Hospitality Pvt. Ltd." />
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Select value={f.currency} onValueChange={(v) => {
                    const found = CURRENCIES.find((c) => c.code === v);
                    setF((p) => ({ ...p, currency: v, currency_symbol: found?.sym ?? p.currency_symbol }));
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Symbol</Label>
                  <Input value={f.currency_symbol} onChange={(e) => set("currency_symbol")(e.target.value)} maxLength={4} />
                </div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="font-display text-lg">First branch</h3>
                <p className="text-sm text-muted-foreground">Every restaurant needs at least one location.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Branch name</Label>
                    <Input value={f.branch_name} onChange={(e) => set("branch_name")(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Branch code</Label>
                    <Input value={f.branch_code} onChange={(e) => set("branch_code")(e.target.value.toUpperCase())} maxLength={8} required />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Address</Label>
                    <Input value={f.branch_address} onChange={(e) => set("branch_address")(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Phone</Label>
                    <Input value={f.branch_phone} onChange={(e) => set("branch_phone")(e.target.value)} />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create restaurant
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
