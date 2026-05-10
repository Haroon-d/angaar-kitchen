import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WEEKDAYS } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const { restaurant, branch } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);

  if (!admin) {
    return <div className="p-8"><Card><CardContent className="py-12 text-center text-muted-foreground">Only owners and admins can access settings.</CardContent></Card></div>;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="font-display text-3xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure your restaurant, taxes, and operating hours.</p>
      </div>
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="taxes">Taxes</TabsTrigger>
          <TabsTrigger value="hours">Hours</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6"><ProfileTab /></TabsContent>
        <TabsContent value="taxes" className="mt-6"><TaxesTab /></TabsContent>
        <TabsContent value="hours" className="mt-6">{branch ? <HoursTab branchId={branch.id} /> : <p className="text-muted-foreground">Select a branch.</p>}</TabsContent>
      </Tabs>
    </div>
  );
}

const ProfileSchema = z.object({
  name: z.string().min(2).max(80),
  legal_name: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().or(z.literal("")).nullable(),
  address: z.string().max(200).optional().nullable(),
  currency: z.string().min(2).max(8),
  currency_symbol: z.string().min(1).max(4),
});

function ProfileTab() {
  const { restaurant, refetch } = useActiveBranch();
  const [f, setF] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (restaurant) setF({ ...restaurant }); }, [restaurant]);
  if (!f) return null;

  async function save() {
    const p = ProfileSchema.safeParse(f);
    if (!p.success) { toast.error(p.error.issues[0].message); return; }
    setLoading(true);
    const { error } = await supabase.from("restaurants").update(p.data).eq("id", restaurant!.id);
    setLoading(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); refetch(); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Restaurant profile</CardTitle><CardDescription>Public information about your business.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label>Name</Label><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Legal name</Label><Input value={f.legal_name ?? ""} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Phone</Label><Input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Address</Label><Input value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Currency code</Label><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={8} /></div>
          <div className="space-y-1.5"><Label>Symbol</Label><Input value={f.currency_symbol} onChange={(e) => setF({ ...f, currency_symbol: e.target.value })} maxLength={4} /></div>
        </div>
        <Button onClick={save} disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-2 h-4 w-4" />Save changes</Button>
      </CardContent>
    </Card>
  );
}

function TaxesTab() {
  const { restaurant } = useActiveBranch();
  const qc = useQueryClient();
  const taxesQ = useQuery({
    queryKey: ["taxes", restaurant?.id],
    enabled: !!restaurant,
    queryFn: async () => {
      const { data, error } = await supabase.from("taxes").select("*").eq("restaurant_id", restaurant!.id).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [f, setF] = useState({ name: "", rate: "15", is_inclusive: false, apply_by_default: true });
  const [loading, setLoading] = useState(false);

  async function add() {
    const rate = Number(f.rate);
    if (!f.name.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100) { toast.error("Enter valid name and rate (0-100)"); return; }
    setLoading(true);
    const { error } = await supabase.from("taxes").insert({
      restaurant_id: restaurant!.id, name: f.name.trim(), rate, is_inclusive: f.is_inclusive, apply_by_default: f.apply_by_default,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else { toast.success("Tax added"); setF({ name: "", rate: "15", is_inclusive: false, apply_by_default: true }); qc.invalidateQueries({ queryKey: ["taxes"] }); }
  }
  async function del(id: string) {
    const { error } = await supabase.from("taxes").delete().eq("id", id);
    if (error) toast.error(error.message); else { qc.invalidateQueries({ queryKey: ["taxes"] }); toast.success("Removed"); }
  }
  async function toggle(id: string, field: "is_active" | "apply_by_default", val: boolean) {
    const patch: { is_active?: boolean; apply_by_default?: boolean } = {};
    patch[field] = val;
    await supabase.from("taxes").update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["taxes"] });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Taxes</CardTitle><CardDescription>Define taxes that can be applied to orders.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-5 items-end rounded-lg border border-border p-4">
          <div className="space-y-1.5 sm:col-span-2"><Label>Name</Label><Input placeholder="GST" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Rate %</Label><Input type="number" step="0.01" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
          <div className="flex items-center gap-2"><Switch checked={f.is_inclusive} onCheckedChange={(v) => setF({ ...f, is_inclusive: v })} /><Label>Inclusive</Label></div>
          <Button onClick={add} disabled={loading}><Plus className="mr-2 h-4 w-4" />Add</Button>
        </div>
        <div className="space-y-2">
          {taxesQ.data?.length === 0 && <p className="text-sm text-muted-foreground">No taxes yet.</p>}
          {taxesQ.data?.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <div className="flex-1 min-w-[150px]"><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.is_inclusive ? "Inclusive" : "Added on top"}</div></div>
              <div className="font-mono">{Number(t.rate).toFixed(2)}%</div>
              <div className="flex items-center gap-2"><Switch checked={t.apply_by_default} onCheckedChange={(v) => toggle(t.id, "apply_by_default", v)} /><span className="text-xs text-muted-foreground">Default</span></div>
              <div className="flex items-center gap-2"><Switch checked={t.is_active} onCheckedChange={(v) => toggle(t.id, "is_active", v)} /><span className="text-xs text-muted-foreground">Active</span></div>
              <Button variant="ghost" size="sm" onClick={() => del(t.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HoursTab({ branchId }: { branchId: string }) {
  const qc = useQueryClient();
  const hoursQ = useQuery({
    queryKey: ["hours", branchId],
    queryFn: async () => {
      const { data, error } = await supabase.from("operating_hours").select("*").eq("branch_id", branchId).order("weekday");
      if (error) throw error;
      return data ?? [];
    },
  });
  const save = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.from("operating_hours").update({
        open_time: row.open_time, close_time: row.close_time, is_closed: row.is_closed,
      }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Hours updated"); qc.invalidateQueries({ queryKey: ["hours"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Operating hours</CardTitle><CardDescription>Set the daily schedule for this branch.</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {hoursQ.data?.map((h: any) => (
          <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
            <div className="w-28 font-medium">{WEEKDAYS[h.weekday]}</div>
            <div className="flex items-center gap-2"><Switch checked={!h.is_closed} onCheckedChange={(v) => save.mutate({ ...h, is_closed: !v })} /><span className="text-xs text-muted-foreground">{h.is_closed ? "Closed" : "Open"}</span></div>
            {!h.is_closed && (
              <>
                <Input type="time" className="w-32" value={h.open_time?.slice(0,5) ?? ""} onChange={(e) => save.mutate({ ...h, open_time: e.target.value })} />
                <span className="text-muted-foreground">to</span>
                <Input type="time" className="w-32" value={h.close_time?.slice(0,5) ?? ""} onChange={(e) => save.mutate({ ...h, close_time: e.target.value })} />
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
