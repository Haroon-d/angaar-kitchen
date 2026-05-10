import { useState } from "react";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { Flame, Loader2, MapPin } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { setupAngaarKitchen } from "@/lib/onboarding.functions";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/onboarding")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: OnboardingPage,
});

const Schema = z.object({
  address: z.string().max(240).optional(),
  phone: z.string().max(40).optional(),
});

function OnboardingPage() {
  const { session, user } = useAuth();
  const { refetch } = useActiveBranch();
  const { refetch: refetchRoles } = useMyRoles();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    address: "Pakistan",
    phone: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Schema.safeParse(f);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!user || !session?.access_token) return;

    setLoading(true);
    try {
      await setupAngaarKitchen({
        data: parsed.data,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      toast.success("Angaar Kitchen is ready.");
      await refetchRoles();
      await refetch();
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
            <CardTitle className="font-display text-3xl">Set up Angaar Kitchen</CardTitle>
            <CardDescription>Configured for Pakistan with PKR currency, Karachi timezone, and GST defaults.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="grid gap-3 rounded-lg border border-border bg-secondary/35 p-4 sm:grid-cols-3">
                <div><div className="text-xs text-muted-foreground">Restaurant</div><div className="font-medium">Angaar Kitchen</div></div>
                <div><div className="text-xs text-muted-foreground">Currency</div><div className="font-medium">Pakistani Rupee · ₨</div></div>
                <div><div className="text-xs text-muted-foreground">Tax</div><div className="font-medium">GST 15%</div></div>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="flex items-center gap-2 font-display text-lg"><MapPin className="h-4 w-4 text-primary" />Restaurant details</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Address</Label>
                    <Input value={f.address} onChange={(e) => set("address")(e.target.value)} placeholder="City, Pakistan" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Phone</Label>
                    <Input value={f.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="03XX XXXXXXX" />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start Angaar Kitchen
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
