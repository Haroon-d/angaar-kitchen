import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Trash2, Pencil, ChefHat, FolderPlus } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/menu")({ component: MenuPage });

function MenuPage() {
  const { branch, restaurant } = useActiveBranch();
  const qc = useQueryClient();
  const symbol = restaurant?.currency_symbol ?? "₹";
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const catsQ = useQuery({
    queryKey: ["categories", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase.from("menu_categories").select("*").eq("branch_id", branch!.id).order("sort_order").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const itemsQ = useQuery({
    queryKey: ["items", branch?.id, activeCat],
    enabled: !!branch,
    queryFn: async () => {
      let q = supabase.from("menu_items").select("*").eq("branch_id", branch!.id).order("sort_order").order("name");
      if (activeCat) q = q.eq("category_id", activeCat);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!branch) return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Menu</h1>
          <p className="text-sm text-muted-foreground">Manage categories and items for {branch.name}.</p>
        </div>
        <div className="flex gap-2">
          <CategoryDialog branchId={branch.id} onSaved={() => qc.invalidateQueries({ queryKey: ["categories"] })} />
          <ItemDialog branchId={branch.id} categories={catsQ.data ?? []} onSaved={() => qc.invalidateQueries({ queryKey: ["items"] })} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Categories</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <button onClick={() => setActiveCat(null)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${!activeCat ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>All items</button>
            {catsQ.data?.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No categories yet.</p>}
            {catsQ.data?.map((c) => (
              <div key={c.id} className="group flex items-center">
                <button onClick={() => setActiveCat(c.id)} className={`flex-1 rounded-md px-3 py-2 text-left text-sm ${activeCat === c.id ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                  {c.name}
                </button>
                <CategoryDialog branchId={branch.id} category={c} onSaved={() => qc.invalidateQueries({ queryKey: ["categories"] })} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{activeCat ? catsQ.data?.find(c => c.id === activeCat)?.name : "All items"}</CardTitle></CardHeader>
          <CardContent>
            {itemsQ.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
              itemsQ.data?.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground"><ChefHat className="mx-auto mb-3 h-8 w-8" />No items yet.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {itemsQ.data?.map((it) => (
                    <div key={it.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{it.name}</div>
                          {it.description && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{it.description}</div>}
                        </div>
                        <div className="font-mono text-sm">{formatMoney(it.base_price, symbol)}</div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${it.is_available ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{it.is_available ? "Available" : "Unavailable"}</span>
                        <div className="flex gap-1">
                          <ItemDialog branchId={branch.id} categories={catsQ.data ?? []} item={it} onSaved={() => qc.invalidateQueries({ queryKey: ["items"] })} />
                          <Button variant="ghost" size="sm" onClick={async () => {
                            const { error } = await supabase.from("menu_items").delete().eq("id", it.id);
                            if (error) toast.error(error.message); else { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["items"] }); }
                          }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const CatSchema = z.object({ name: z.string().min(1).max(60), sort_order: z.number().int(), is_active: z.boolean() });

function CategoryDialog({ branchId, category, onSaved }: { branchId: string; category?: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: category?.name ?? "", sort_order: category?.sort_order ?? 0, is_active: category?.is_active ?? true });
  const [loading, setLoading] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const p = CatSchema.safeParse({ ...f, sort_order: Number(f.sort_order) });
    if (!p.success) { toast.error(p.error.issues[0].message); return; }
    setLoading(true);
    const { error } = category
      ? await supabase.from("menu_categories").update(p.data).eq("id", category.id)
      : await supabase.from("menu_categories").insert({ ...p.data, branch_id: branchId });
    setLoading(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); onSaved(); setOpen(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {category ? <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></Button>
          : <Button variant="outline"><FolderPlus className="mr-2 h-4 w-4" />Category</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Sort order</Label><Input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} /></div>
            <div className="flex items-center gap-2 pt-6"><Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} /><Label>Active</Label></div>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ItemSchema = z.object({
  category_id: z.string().uuid(), name: z.string().min(1).max(80), description: z.string().max(500).optional().nullable(),
  base_price: z.number().min(0), is_available: z.boolean(), is_veg: z.boolean().nullable(), prep_time_min: z.number().int().min(0).max(240),
});

function ItemDialog({ branchId, categories, item, onSaved }: { branchId: string; categories: any[]; item?: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    category_id: item?.category_id ?? categories[0]?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    base_price: String(item?.base_price ?? "0"),
    is_available: item?.is_available ?? true,
    is_veg: item?.is_veg ?? null,
    prep_time_min: String(item?.prep_time_min ?? "15"),
  });
  const [loading, setLoading] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const p = ItemSchema.safeParse({
      ...f, base_price: Number(f.base_price), prep_time_min: Number(f.prep_time_min),
      description: f.description || null, is_veg: f.is_veg,
    });
    if (!p.success) { toast.error(p.error.issues[0].message); return; }
    setLoading(true);
    const { error } = item
      ? await supabase.from("menu_items").update(p.data).eq("id", item.id)
      : await supabase.from("menu_items").insert({ ...p.data, branch_id: branchId });
    setLoading(false);
    if (error) toast.error(error.message); else { toast.success("Saved"); onSaved(); setOpen(false); }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? <Button variant="ghost" size="sm"><Pencil className="h-4 w-4" /></Button>
          : <Button disabled={categories.length === 0}><Plus className="mr-2 h-4 w-4" />Item</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{item ? "Edit item" : "New item"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5"><Label>Category</Label>
            <Select value={f.category_id} onValueChange={(v) => setF({ ...f, category_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Base price</Label><Input type="number" step="0.01" value={f.base_price} onChange={(e) => setF({ ...f, base_price: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label>Prep time (min)</Label><Input type="number" value={f.prep_time_min} onChange={(e) => setF({ ...f, prep_time_min: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={f.is_available} onCheckedChange={(v) => setF({ ...f, is_available: v })} /><Label>Available</Label></div>
            <div className="flex items-center gap-2"><Switch checked={f.is_veg === true} onCheckedChange={(v) => setF({ ...f, is_veg: v ? true : null })} /><Label>Veg</Label></div>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
