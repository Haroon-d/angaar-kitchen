import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  ClipboardList,
  Eye,
  Loader2,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  Search,
  Trash2,
  Utensils,
} from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isManager } from "@/hooks/use-auth";
import {
  formatDate,
  formatMoney,
  formatPakistanDateLabel,
  pakistanDateInputValue,
  pakistanDateRangeUtcBounds,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/inventory")({ component: InventoryPage });

type BaseUnit = "g" | "ml" | "piece";
type EntryUnit = "g" | "kg" | "ml" | "l" | "piece";
type PurchaseUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack";
type MovementType = "adjustment" | "waste" | "correction" | "staff_meal" | "damage";
type AdjustmentReason = "waste" | "damage" | "correction" | "staff_meal" | "other";

const db = supabase as any;

function InventoryPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const manager = isManager(roles);

  if (!branch || !restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {branch.name} stock, purchases, recipes, and food cost.
          </p>
        </div>
      </div>

      <Tabs defaultValue="stock">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="stock">
            <Package className="mr-2 h-4 w-4" />
            Stock
          </TabsTrigger>
          <TabsTrigger value="purchases">
            <ReceiptText className="mr-2 h-4 w-4" />
            Purchases
          </TabsTrigger>
          <TabsTrigger value="recipes">
            <Utensils className="mr-2 h-4 w-4" />
            Recipes
          </TabsTrigger>
          <TabsTrigger value="adjustments">
            <Scale className="mr-2 h-4 w-4" />
            Adjustments
          </TabsTrigger>
          <TabsTrigger value="reports">
            <ClipboardList className="mr-2 h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="mt-6">
          <StockTab branchId={branch.id} manager={manager} symbol={restaurant.currency_symbol} />
        </TabsContent>
        <TabsContent value="purchases" className="mt-6">
          <PurchasesTab
            branchId={branch.id}
            restaurantId={restaurant.id}
            manager={manager}
            symbol={restaurant.currency_symbol}
          />
        </TabsContent>
        <TabsContent value="recipes" className="mt-6">
          <RecipesTab branchId={branch.id} manager={manager} symbol={restaurant.currency_symbol} />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-6">
          <AdjustmentsTab branchId={branch.id} manager={manager} />
        </TabsContent>
        <TabsContent value="reports" className="mt-6">
          <ReportsTab branchId={branch.id} symbol={restaurant.currency_symbol} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useInventoryItems(branchId: string, activeOnly = false) {
  return useQuery({
    queryKey: ["inventory-items", branchId, activeOnly],
    queryFn: async () => {
      let q = db.from("inventory_items").select("*").eq("branch_id", branchId).order("name");
      if (activeOnly) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

function unitLabel(unit: BaseUnit) {
  if (unit === "g") return "g";
  if (unit === "ml") return "ml";
  return "pc";
}

function preferredEntryUnit(unit: BaseUnit): EntryUnit {
  if (unit === "g") return "kg";
  if (unit === "ml") return "l";
  return "piece";
}

function entryUnitsForBase(unit: BaseUnit): EntryUnit[] {
  if (unit === "g") return ["kg", "g"];
  if (unit === "ml") return ["l", "ml"];
  return ["piece"];
}

function quantityFromBase(qty: number | string, unit: BaseUnit, entryUnit: EntryUnit) {
  const n = Number(qty || 0);
  if (unit === "g" && entryUnit === "kg") return n / 1000;
  if (unit === "ml" && entryUnit === "l") return n / 1000;
  return n;
}

function quantityToBase(qty: number, unit: BaseUnit, entryUnit: EntryUnit) {
  if (unit === "g" && entryUnit === "kg") return qty * 1000;
  if (unit === "ml" && entryUnit === "l") return qty * 1000;
  return qty;
}

function costFromBase(cost: number | string, unit: BaseUnit, entryUnit: EntryUnit) {
  const n = Number(cost || 0);
  if (unit === "g" && entryUnit === "kg") return n * 1000;
  if (unit === "ml" && entryUnit === "l") return n * 1000;
  return n;
}

function costToBase(cost: number, unit: BaseUnit, entryUnit: EntryUnit) {
  if (unit === "g" && entryUnit === "kg") return cost / 1000;
  if (unit === "ml" && entryUnit === "l") return cost / 1000;
  return cost;
}

function costLabel(cost: number | string, unit: BaseUnit, symbol: string) {
  const entryUnit = preferredEntryUnit(unit);
  return `${formatMoney(costFromBase(cost, unit, entryUnit), symbol)} / ${entryUnit === "l" ? "L" : entryUnit}`;
}

function qtyLabel(qty: number | string, unit: BaseUnit) {
  const n = Number(qty || 0);
  if (unit === "g" && Math.abs(n) >= 1000)
    return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`;
  if (unit === "ml" && Math.abs(n) >= 1000)
    return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} L`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unitLabel(unit)}`;
}

function stockState(item: any) {
  const qty = Number(item.current_qty);
  const low = qty <= Number(item.reorder_level);
  if (qty < 0)
    return { label: "Negative", cls: "border-destructive/30 bg-destructive/15 text-destructive" };
  if (low) return { label: "Low", cls: "border-amber-500/30 bg-amber-500/15 text-amber-300" };
  return { label: "OK", cls: "border-success/30 bg-success/15 text-success" };
}

function StockTab({
  branchId,
  manager,
  symbol,
}: {
  branchId: string;
  manager: boolean;
  symbol: string;
}) {
  const qc = useQueryClient();
  const q = useInventoryItems(branchId);
  const [search, setSearch] = useState("");
  const items = useMemo(() => {
    const s = search.toLowerCase().trim();
    return (q.data ?? []).filter(
      (i: any) =>
        i.is_active &&
        (!s || i.name.toLowerCase().includes(s) || (i.category ?? "").toLowerCase().includes(s)),
    );
  }, [q.data, search]);

  const totalValue = (q.data ?? [])
    .filter((i: any) => i.is_active)
    .reduce((sum: number, i: any) => sum + Number(i.current_qty) * Number(i.average_cost), 0);
  const lowCount = (q.data ?? []).filter(
    (i: any) => i.is_active && Number(i.current_qty) <= Number(i.reorder_level),
  ).length;

  async function deleteIngredient(item: any) {
    if (
      !window.confirm(
        `Delete ${item.name}? If it has purchase, recipe, or ledger history it will be archived instead.`,
      )
    )
      return;
    const { error } = await db.from("inventory_items").delete().eq("id", item.id);
    if (error) {
      const { error: archiveError } = await db
        .from("inventory_items")
        .update({ is_active: false })
        .eq("id", item.id);
      if (archiveError) {
        toast.error(archiveError.message);
        return;
      }
      toast.success("Ingredient has history, so it was archived");
    } else {
      toast.success("Ingredient deleted");
    }
    qc.invalidateQueries({ queryKey: ["inventory-items"] });
    qc.invalidateQueries({ queryKey: ["inventory-reports"] });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Stock value" value={formatMoney(totalValue, symbol)} icon={Package} />
        <Stat
          label="Low stock"
          value={String(lowCount)}
          icon={AlertTriangle}
          highlight={lowCount > 0}
        />
        <Stat
          label="Ingredients"
          value={String((q.data ?? []).filter((i: any) => i.is_active).length)}
          icon={Scale}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Ingredients</CardTitle>
            <CardDescription>Raw materials tracked per branch.</CardDescription>
          </div>
          {manager && <IngredientDialog branchId={branchId} />}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search ingredients"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {q.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Ingredient</th>
                    <th className="pr-4">On hand</th>
                    <th className="pr-4">Reorder</th>
                    <th className="pr-4">Avg cost</th>
                    <th className="pr-4">Value</th>
                    <th className="pr-4">Status</th>
                    {manager && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => {
                    const state = stockState(item);
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.category || item.base_unit}
                          </div>
                        </td>
                        <td className="pr-4 font-mono">
                          {qtyLabel(item.current_qty, item.base_unit)}
                        </td>
                        <td className="pr-4 font-mono">
                          {qtyLabel(item.reorder_level, item.base_unit)}
                        </td>
                        <td className="pr-4 font-mono">
                          {costLabel(item.average_cost, item.base_unit, symbol)}
                        </td>
                        <td className="pr-4 font-mono">
                          {formatMoney(
                            Number(item.current_qty) * Number(item.average_cost),
                            symbol,
                          )}
                        </td>
                        <td className="pr-4">
                          <Badge variant="outline" className={state.cls}>
                            {state.label}
                          </Badge>
                        </td>
                        {manager && (
                          <td className="text-right">
                            <div className="flex justify-end gap-1">
                              <IngredientDialog branchId={branchId} item={item} />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteIngredient(item)}
                                aria-label={`Delete ${item.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={manager ? 7 : 6}
                        className="py-10 text-center text-muted-foreground"
                      >
                        No ingredients yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const IngredientSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.string().max(80).optional().nullable(),
  base_unit: z.enum(["g", "ml", "piece"]),
  current_qty: z.number(),
  reorder_level: z.number().min(0),
  average_cost: z.number().min(0),
  is_active: z.boolean(),
});

function IngredientDialog({ branchId, item }: { branchId: string; item?: any }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const initialBaseUnit = (item?.base_unit ?? "g") as BaseUnit;
  const initialEntryUnit = preferredEntryUnit(initialBaseUnit);
  const [f, setF] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    base_unit: initialBaseUnit,
    entry_unit: initialEntryUnit,
    current_qty: String(
      quantityFromBase(item?.current_qty ?? "0", initialBaseUnit, initialEntryUnit),
    ),
    reorder_level: String(
      quantityFromBase(item?.reorder_level ?? "0", initialBaseUnit, initialEntryUnit),
    ),
    average_cost: String(
      costFromBase(item?.average_cost ?? "0", initialBaseUnit, initialEntryUnit),
    ),
    is_active: item?.is_active ?? true,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = IngredientSchema.safeParse({
      ...f,
      category: f.category || null,
      current_qty: quantityToBase(Number(f.current_qty), f.base_unit, f.entry_unit),
      reorder_level: quantityToBase(Number(f.reorder_level), f.base_unit, f.entry_unit),
      average_cost: costToBase(Number(f.average_cost), f.base_unit, f.entry_unit),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const payload = { ...parsed.data, branch_id: branchId };
    const { error } = item
      ? await db.from("inventory_items").update(parsed.data).eq("id", item.id)
      : await db.from("inventory_items").insert(payload);
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Ingredient saved");
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inventory-reports"] });
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? (
          <Button variant="ghost" size="icon" aria-label={`Edit ${item.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Ingredient
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit ingredient" : "New ingredient"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input
                value={f.category}
                onChange={(e) => setF({ ...f, category: e.target.value })}
                placeholder="Meat, Dairy, Dry goods"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Base unit</Label>
              <Select
                value={f.base_unit}
                onValueChange={(v: BaseUnit) => {
                  const entryUnit = preferredEntryUnit(v);
                  setF({
                    ...f,
                    base_unit: v,
                    entry_unit: entryUnit,
                    current_qty: "0",
                    reorder_level: "0",
                    average_cost: "0",
                  });
                }}
                disabled={!!item}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">Grams (g)</SelectItem>
                  <SelectItem value="ml">Milliliters (ml)</SelectItem>
                  <SelectItem value="piece">Pieces</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Entry unit</Label>
              <Select
                value={f.entry_unit}
                onValueChange={(v: EntryUnit) => {
                  const oldUnit = f.entry_unit;
                  setF({
                    ...f,
                    entry_unit: v,
                    current_qty: String(
                      quantityFromBase(
                        quantityToBase(Number(f.current_qty), f.base_unit, oldUnit),
                        f.base_unit,
                        v,
                      ),
                    ),
                    reorder_level: String(
                      quantityFromBase(
                        quantityToBase(Number(f.reorder_level), f.base_unit, oldUnit),
                        f.base_unit,
                        v,
                      ),
                    ),
                    average_cost: String(
                      costFromBase(
                        costToBase(Number(f.average_cost), f.base_unit, oldUnit),
                        f.base_unit,
                        v,
                      ),
                    ),
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entryUnitsForBase(f.base_unit).map((u) => (
                    <SelectItem key={u} value={u}>
                      {u === "l"
                        ? "Liters (L)"
                        : u === "kg"
                          ? "Kilograms (kg)"
                          : u === "g"
                            ? "Grams (g)"
                            : u === "ml"
                              ? "Milliliters (ml)"
                              : "Pieces"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Current qty ({f.entry_unit === "l" ? "L" : f.entry_unit})</Label>
              <Input
                type="number"
                step="0.001"
                value={f.current_qty}
                onChange={(e) => setF({ ...f, current_qty: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reorder level ({f.entry_unit === "l" ? "L" : f.entry_unit})</Label>
              <Input
                type="number"
                step="0.001"
                value={f.reorder_level}
                onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Avg cost / {f.entry_unit === "l" ? "L" : f.entry_unit}</Label>
              <Input
                type="number"
                step="0.000001"
                value={f.average_cost}
                onChange={(e) => setF({ ...f, average_cost: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PurchasesTab({
  branchId,
  restaurantId,
  manager,
  symbol,
}: {
  branchId: string;
  restaurantId: string;
  manager: boolean;
  symbol: string;
}) {
  const qc = useQueryClient();
  const itemsQ = useInventoryItems(branchId, true);
  const suppliersQ = useQuery({
    queryKey: ["inventory-suppliers", restaurantId],
    queryFn: async () => {
      const { data, error } = await db
        .from("suppliers")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const purchasesQ = useQuery({
    queryKey: ["inventory-purchases", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_purchases")
        .select("*, suppliers(name)")
        .eq("branch_id", branchId)
        .order("purchase_date", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  async function addSupplier(name: string) {
    const { error } = await db.from("suppliers").insert({ restaurant_id: restaurantId, name });
    if (error) toast.error(error.message);
    else {
      toast.success("Supplier added");
      qc.invalidateQueries({ queryKey: ["inventory-suppliers"] });
    }
  }

  function refreshPurchases() {
    qc.invalidateQueries({ queryKey: ["inventory-items"] });
    qc.invalidateQueries({ queryKey: ["inventory-purchases"] });
    qc.invalidateQueries({ queryKey: ["inventory-movements"] });
    qc.invalidateQueries({ queryKey: ["inventory-reports"] });
  }

  async function deletePurchase(id: string) {
    if (
      !window.confirm(
        "Delete this purchase? Stock will be reversed and the ledger will keep a correction entry.",
      )
    )
      return;

    try {
      // Fetch the purchase and its lines
      const { data: purchase, error: purchaseError } = await db
        .from("inventory_purchases")
        .select("*")
        .eq("id", id)
        .single();

      if (purchaseError || !purchase) {
        toast.error("Purchase not found");
        return;
      }

      const { data: lines, error: linesError } = await db
        .from("inventory_purchase_lines")
        .select("*")
        .eq("purchase_id", id);

      if (linesError) throw linesError;

      // Reverse stock for each line
      for (const line of lines || []) {
        const { data: item } = await db
          .from("inventory_items")
          .select("current_qty")
          .eq("id", line.inventory_item_id)
          .single();

        if (item) {
          const newQty = Number(item.current_qty) - Number(line.base_quantity);

          // Update inventory
          await db
            .from("inventory_items")
            .update({ current_qty: newQty })
            .eq("id", line.inventory_item_id);

          // Create correction movement
          await db.from("inventory_movements").insert({
            branch_id: purchase.branch_id,
            inventory_item_id: line.inventory_item_id,
            movement_type: "correction",
            reason: "correction",
            quantity_delta: -line.base_quantity,
            before_qty: item.current_qty,
            after_qty: newQty,
            unit_cost: line.unit_cost,
            related_purchase_id: id,
            note: `Purchase deleted: ${purchase.invoice_no || ""}`,
          });
        }
      }

      // Delete the purchase lines and purchase
      await db.from("inventory_purchase_lines").delete().eq("purchase_id", id);
      await db.from("inventory_purchases").delete().eq("id", id);

      toast.success("Purchase deleted and stock reversed");
      refreshPurchases();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete purchase");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Purchase history</CardTitle>
          <CardDescription>Received stock updates weighted average cost.</CardDescription>
        </CardHeader>
        <CardContent>
          {purchasesQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <div className="space-y-2">
              {purchasesQ.data?.map((p: any) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
                >
                  <PurchaseDetailsDialog
                    purchaseId={p.id}
                    manager={manager}
                    symbol={symbol}
                    items={itemsQ.data ?? []}
                    suppliers={suppliersQ.data ?? []}
                    onSaved={refreshPurchases}
                    onDelete={() => deletePurchase(p.id)}
                    trigger={
                      <button
                        type="button"
                        className="flex min-w-[220px] flex-1 items-center gap-3 text-left"
                      >
                        <div className="flex-1">
                          <div className="font-medium">{p.invoice_no || "Purchase"}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.suppliers?.name || "No supplier"} - {formatDate(p.purchase_date)}
                          </div>
                        </div>
                        <div className="font-mono text-primary">{formatMoney(p.total, symbol)}</div>
                      </button>
                    }
                  />
                  {manager && (
                    <div className="flex gap-1">
                      <PurchaseEditDialog
                        purchaseId={p.id}
                        items={itemsQ.data ?? []}
                        suppliers={suppliersQ.data ?? []}
                        onSaved={refreshPurchases}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => deletePurchase(p.id)}
                        aria-label="Delete purchase"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {purchasesQ.data?.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  No purchases recorded.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Record purchase</CardTitle>
          <CardDescription>Add received ingredients to stock.</CardDescription>
        </CardHeader>
        <CardContent>
          {manager ? (
            <PurchaseForm
              branchId={branchId}
              items={itemsQ.data ?? []}
              suppliers={suppliersQ.data ?? []}
              onAddSupplier={addSupplier}
              onSaved={refreshPurchases}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Only managers and owners can record purchases.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type PurchaseLine = {
  inventory_item_id: string;
  quantity: string;
  unit: PurchaseUnit;
  pack_size: string;
  unit_cost: string;
};

function usePurchaseDetails(purchaseId: string, enabled = true) {
  return useQuery({
    queryKey: ["inventory-purchase", purchaseId],
    enabled: enabled && !!purchaseId,
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_purchases")
        .select("*, suppliers(name), inventory_purchase_lines(*, inventory_items(name, base_unit))")
        .eq("id", purchaseId)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

function PurchaseDetailsDialog(props: {
  purchaseId: string;
  manager: boolean;
  symbol: string;
  items: any[];
  suppliers: any[];
  trigger: React.ReactNode;
  onSaved: () => void;
  onDelete: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const q = usePurchaseDetails(props.purchaseId, open);
  const purchase = q.data;
  const lines = purchase?.inventory_purchase_lines ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{purchase?.invoice_no || "Purchase details"}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : purchase ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Supplier</div>
                <div className="font-medium">{purchase.suppliers?.name || "No supplier"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Date</div>
                <div className="font-medium">{formatDate(purchase.purchase_date)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Invoice</div>
                <div className="font-medium">{purchase.invoice_no || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-mono text-primary">
                  {formatMoney(purchase.total, props.symbol)}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Ingredient</th>
                    <th className="pr-4">Qty</th>
                    <th className="pr-4">Base qty</th>
                    <th className="pr-4">Unit cost</th>
                    <th className="text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line: any) => (
                    <tr key={line.id} className="border-t border-border">
                      <td className="py-2 pr-4">{line.inventory_items?.name}</td>
                      <td className="pr-4 font-mono">
                        {Number(line.quantity).toLocaleString()} {line.unit}
                      </td>
                      <td className="pr-4 font-mono">
                        {qtyLabel(line.base_quantity, line.inventory_items?.base_unit)}
                      </td>
                      <td className="pr-4 font-mono">
                        {formatMoney(line.unit_cost, props.symbol)}
                      </td>
                      <td className="text-right font-mono">
                        {formatMoney(line.line_total, props.symbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {purchase.notes && (
              <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                {purchase.notes}
              </div>
            )}
            {props.manager && (
              <DialogFooter>
                <PurchaseEditDialog
                  purchaseId={props.purchaseId}
                  items={props.items}
                  suppliers={props.suppliers}
                  onSaved={() => {
                    props.onSaved();
                    q.refetch();
                  }}
                  trigger={
                    <Button type="button" variant="outline">
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  }
                />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={async () => {
                    await props.onDelete();
                    setOpen(false);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </DialogFooter>
            )}
          </div>
        ) : (
          <div className="py-10 text-center text-muted-foreground">Purchase not found.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PurchaseEditDialog(props: {
  purchaseId: string;
  items: any[];
  suppliers: any[];
  onSaved: () => void;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const q = usePurchaseDetails(props.purchaseId, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {props.trigger ?? (
          <Button type="button" variant="ghost" size="icon" aria-label="Edit purchase">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit purchase</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : q.data ? (
          <PurchaseForm
            key={q.data.id}
            branchId={q.data.branch_id}
            items={props.items}
            suppliers={props.suppliers}
            purchase={q.data}
            onAddSupplier={async () =>
              toast.error("Add new suppliers from the record purchase form")
            }
            onSaved={() => {
              props.onSaved();
              q.refetch();
              setOpen(false);
            }}
          />
        ) : (
          <div className="py-10 text-center text-muted-foreground">Purchase not found.</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PurchaseForm(props: {
  branchId: string;
  items: any[];
  suppliers: any[];
  onAddSupplier: (name: string) => Promise<void>;
  onSaved: () => void;
  purchase?: any;
}) {
  const purchaseLines = props.purchase?.inventory_purchase_lines ?? [];
  const [supplier, setSupplier] = useState(props.purchase?.supplier_id ?? "none");
  const [newSupplier, setNewSupplier] = useState("");
  const [invoice, setInvoice] = useState(props.purchase?.invoice_no ?? "");
  const [date, setDate] = useState(props.purchase?.purchase_date ?? pakistanDateInputValue());
  const [notes, setNotes] = useState(props.purchase?.notes ?? "");
  const [lines, setLines] = useState<PurchaseLine[]>(
    purchaseLines.length
      ? purchaseLines.map((line: any) => ({
          inventory_item_id: line.inventory_item_id,
          quantity: String(line.quantity ?? "1"),
          unit: line.unit,
          pack_size: String(line.pack_size ?? ""),
          unit_cost: String(line.unit_cost ?? "0"),
        }))
      : [{ inventory_item_id: "", quantity: "1", unit: "kg", pack_size: "", unit_cost: "0" }],
  );
  const [loading, setLoading] = useState(false);

  const itemMap = new Map(props.items.map((i) => [i.id, i]));
  function addLine() {
    setLines((ls) => [
      ...ls,
      { inventory_item_id: "", quantity: "1", unit: "kg", pack_size: "", unit_cost: "0" },
    ]);
  }
  function patchLine(idx: number, patch: Partial<PurchaseLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const clean = lines.filter((l) => l.inventory_item_id && Number(l.quantity) > 0);
    if (clean.length === 0) {
      toast.error("Add at least one purchase line");
      return;
    }
    setLoading(true);
    try {
      if (props.purchase) {
        // For edits: reverse old stock, then record new purchase with same ID
        const oldLines = props.purchase.inventory_purchase_lines ?? [];
        for (const line of oldLines) {
          const { data: item } = await db
            .from("inventory_items")
            .select("current_qty")
            .eq("id", line.inventory_item_id)
            .single();

          if (item) {
            const newQty = Number(item.current_qty) - Number(line.base_quantity);
            await db
              .from("inventory_items")
              .update({ current_qty: newQty })
              .eq("id", line.inventory_item_id);

            await db.from("inventory_movements").insert({
              branch_id: props.purchase.branch_id,
              inventory_item_id: line.inventory_item_id,
              movement_type: "correction",
              reason: "correction",
              quantity_delta: -line.base_quantity,
              before_qty: item.current_qty,
              after_qty: newQty,
              unit_cost: line.unit_cost,
              related_purchase_id: props.purchase.id,
              note: `Purchase edited reversal: ${props.purchase.invoice_no || ""}`,
            });
          }
        }

        // Delete old lines
        await db.from("inventory_purchase_lines").delete().eq("purchase_id", props.purchase.id);

        // Update purchase header
        const payload = {
          supplier_id: supplier === "none" ? null : supplier,
          invoice_no: invoice || null,
          purchase_date: date,
          notes: notes || null,
          total: clean.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_cost), 0),
        };
        await db.from("inventory_purchases").update(payload).eq("id", props.purchase.id);

        // Insert new lines
        let runningTotal = 0;
        for (const line of clean) {
          const item = props.items.find((i: any) => i.id === line.inventory_item_id);
          if (!item) continue;

          const baseQty = (() => {
            const qty = Number(line.quantity);
            if (line.unit === "kg" && item.base_unit === "g") return qty * 1000;
            if (line.unit === "l" && item.base_unit === "ml") return qty * 1000;
            if (line.unit === "pack") return qty * (Number(line.pack_size) || 1);
            return qty;
          })();

          const lineTotal = Number(line.quantity) * Number(line.unit_cost);
          runningTotal += lineTotal;

          await db.from("inventory_purchase_lines").insert({
            purchase_id: props.purchase.id,
            inventory_item_id: line.inventory_item_id,
            quantity: Number(line.quantity),
            unit: line.unit,
            pack_size: line.pack_size ? Number(line.pack_size) : null,
            base_quantity: baseQty,
            unit_cost: Number(line.unit_cost),
            line_total: lineTotal,
          });

          // Update inventory with new quantities
          const { data: currentItem } = await db
            .from("inventory_items")
            .select("current_qty, average_cost")
            .eq("id", line.inventory_item_id)
            .single();

          if (currentItem) {
            const newQty = Number(currentItem.current_qty) + baseQty;
            const newAvg =
              newQty > 0
                ? (Number(currentItem.current_qty) * Number(currentItem.average_cost) + lineTotal) /
                  newQty
                : Number(currentItem.average_cost);

            await db
              .from("inventory_items")
              .update({ current_qty: newQty, average_cost: newAvg })
              .eq("id", line.inventory_item_id);

            await db.from("inventory_movements").insert({
              branch_id: props.purchase.branch_id,
              inventory_item_id: line.inventory_item_id,
              movement_type: "purchase",
              reason: "purchase",
              quantity_delta: baseQty,
              before_qty: currentItem.current_qty,
              after_qty: newQty,
              unit_cost: Number(line.unit_cost),
              related_purchase_id: props.purchase.id,
              note: notes || null,
            });
          }
        }

        // Update total
        await db
          .from("inventory_purchases")
          .update({ total: runningTotal })
          .eq("id", props.purchase.id);
        toast.success("Purchase updated");
      } else {
        const payload = {
          _supplier: supplier === "none" ? null : supplier,
          _invoice_no: invoice,
          _purchase_date: date,
          _notes: notes,
          _lines: clean.map((l) => ({
            inventory_item_id: l.inventory_item_id,
            quantity: Number(l.quantity),
            unit: l.unit,
            pack_size: l.pack_size ? Number(l.pack_size) : null,
            unit_cost: Number(l.unit_cost) || 0,
          })),
        };
        const { error } = await db.rpc("record_inventory_purchase", {
          _branch: props.branchId,
          ...payload,
        });
        if (error) throw error;
        toast.success("Purchase recorded");
        setInvoice("");
        setNotes("");
        setLines([
          { inventory_item_id: "", quantity: "1", unit: "kg", pack_size: "", unit_cost: "0" },
        ]);
      }
      props.onSaved();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save purchase");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Supplier</Label>
        <div className="flex gap-2">
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No supplier</SelectItem>
              {props.suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="New supplier name"
            value={newSupplier}
            onChange={(e) => setNewSupplier(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              if (newSupplier.trim()) {
                await props.onAddSupplier(newSupplier.trim());
                setNewSupplier("");
              }
            }}
          >
            Add
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Invoice no.</Label>
          <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Lines</Label>
        <div className="overflow-x-auto">
          <div className="min-w-[680px] grid gap-2 rounded-lg border border-border bg-surface p-3 text-xs uppercase tracking-wide text-muted-foreground grid-cols-[minmax(0,2.6fr)_80px_90px_90px_90px_36px]">
            <div>Ingredient</div>
            <div>Qty</div>
            <div>Unit</div>
            <div>Pack size</div>
            <div>Unit cost</div>
            <div className="text-right">Action</div>
          </div>
        </div>
        {lines.map((line, idx) => {
          const item = itemMap.get(line.inventory_item_id);
          return (
            <div key={idx} className="overflow-x-auto rounded-lg border border-border p-0">
              <div className="min-w-[680px] grid gap-2 p-3 min-w-0 grid-cols-[minmax(0,2.6fr)_80px_90px_90px_90px_36px]">
                <Select
                  value={line.inventory_item_id}
                  onValueChange={(v) =>
                    patchLine(idx, {
                      inventory_item_id: v,
                      unit:
                        itemMap.get(v)?.base_unit === "ml"
                          ? "l"
                          : itemMap.get(v)?.base_unit === "piece"
                            ? "piece"
                            : "kg",
                    })
                  }
                >
                  <SelectTrigger className="min-w-0 w-full">
                    <SelectValue placeholder="Ingredient" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="min-w-0 w-full"
                  type="number"
                  step="0.001"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => patchLine(idx, { quantity: e.target.value })}
                />
                <Select
                  value={line.unit}
                  onValueChange={(v: PurchaseUnit) => patchLine(idx, { unit: v })}
                >
                  <SelectTrigger className="min-w-0 w-full">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {(item?.base_unit === "g"
                      ? ["kg", "g", "pack"]
                      : item?.base_unit === "ml"
                        ? ["l", "ml", "pack"]
                        : ["piece", "pack"]
                    ).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="min-w-0 w-full"
                  type="number"
                  step="0.001"
                  disabled={line.unit !== "pack"}
                  placeholder="Pack size"
                  value={line.pack_size}
                  onChange={(e) => patchLine(idx, { pack_size: e.target.value })}
                />
                <Input
                  className="min-w-0 w-full"
                  type="number"
                  step="0.01"
                  placeholder="Unit cost"
                  value={line.unit_cost}
                  onChange={(e) => patchLine(idx, { unit_cost: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={addLine}>
          <Plus className="mr-2 h-4 w-4" />
          Line
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button type="submit" disabled={loading || props.items.length === 0}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {props.purchase ? "Save changes" : "Record purchase"}
      </Button>
    </form>
  );
}

function RecipesTab({
  branchId,
  manager,
  symbol,
}: {
  branchId: string;
  manager: boolean;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const itemsQ = useInventoryItems(branchId, true);
  const menuQ = useQuery({
    queryKey: ["inventory-menu-items", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("menu_items")
        .select("id, name, base_price")
        .eq("branch_id", branchId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const recipesQ = useQuery({
    queryKey: ["inventory-recipes", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_recipes")
        .select("*, inventory_items(name, base_unit, average_cost)")
        .eq("menu_item_id", selected)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [ingredient, setIngredient] = useState("");
  const [entryUnit, setEntryUnit] = useState<EntryUnit>("g");
  const [qty, setQty] = useState("0");
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);

  const selectedIngredient = itemsQ.data?.find((i: any) => i.id === ingredient);

  async function addRecipe(e: React.FormEvent) {
    e.preventDefault();
    const rawQty = Number(qty);
    if (
      !selected ||
      !ingredient ||
      !selectedIngredient ||
      !Number.isFinite(rawQty) ||
      rawQty <= 0
    ) {
      toast.error("Select item and enter a positive quantity");
      return;
    }
    const baseQty = quantityToBase(rawQty, selectedIngredient.base_unit, entryUnit);
    const { error } = await db.from("inventory_recipes").upsert(
      {
        menu_item_id: selected,
        inventory_item_id: ingredient,
        quantity: baseQty,
        standard_source: "manual",
        learning_enabled: false,
      },
      { onConflict: "menu_item_id,inventory_item_id" },
    );
    if (error) toast.error(error.message);
    else {
      toast.success(editingRecipeId ? "Recipe row updated" : "Recipe row saved");
      resetRecipeForm();
      qc.invalidateQueries({ queryKey: ["inventory-recipes"] });
      qc.invalidateQueries({ queryKey: ["inventory-reports"] });
    }
  }

  async function removeRecipe(id: string) {
    if (
      !window.confirm(
        "Remove this ingredient from the recipe? Future orders will stop deducting it.",
      )
    ) {
      return;
    }
    const { error } = await db.from("inventory_recipes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Recipe row removed");
      if (editingRecipeId === id) resetRecipeForm();
      qc.invalidateQueries({ queryKey: ["inventory-recipes"] });
      qc.invalidateQueries({ queryKey: ["inventory-reports"] });
    }
  }

  function resetRecipeForm() {
    setIngredient("");
    setEntryUnit("g");
    setQty("0");
    setEditingRecipeId(null);
  }

  function editRecipe(row: any) {
    const unit = row.inventory_items?.base_unit as BaseUnit;
    const preferred = preferredEntryUnit(unit);
    setEditingRecipeId(row.id);
    setIngredient(row.inventory_item_id);
    setEntryUnit(preferred);
    setQty(String(quantityFromBase(row.quantity, unit, preferred)));
  }

  const selectedMenu = menuQ.data?.find((i: any) => i.id === selected);
  const recipeCost = (recipesQ.data ?? []).reduce(
    (sum: number, r: any) =>
      sum + Number(r.quantity) * Number(r.inventory_items?.average_cost ?? 0),
    0,
  );
  const foodCostPercent = selectedMenu?.base_price
    ? (recipeCost / Number(selectedMenu.base_price)) * 100
    : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Menu item</CardTitle>
          <CardDescription>
            Choose a menu item and maintain its ingredient standards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            value={selected}
            onValueChange={(value) => {
              setSelected(value);
              resetRecipeForm();
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select menu item" />
            </SelectTrigger>
            <SelectContent>
              {menuQ.data?.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedMenu && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-mono">{formatMoney(selectedMenu.base_price, symbol)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Food cost</span>
                <span className="font-mono">{formatMoney(recipeCost, symbol)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Food cost %</span>
                <span className="font-mono">{foodCostPercent.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Margin</span>
                <span className="font-mono text-primary">
                  {formatMoney(Number(selectedMenu.base_price) - recipeCost, symbol)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recipe</CardTitle>
          <CardDescription>Standard ingredient usage per one sold item.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {manager && selected && (
            <form
              onSubmit={addRecipe}
              className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_120px_110px_auto]"
            >
              <Select
                value={ingredient}
                onValueChange={(value) => {
                  setIngredient(value);
                  const item = itemsQ.data?.find((i: any) => i.id === value);
                  if (item) setEntryUnit(preferredEntryUnit(item.base_unit));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ingredient" />
                </SelectTrigger>
                <SelectContent>
                  {itemsQ.data?.map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} ({unitLabel(i.base_unit)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Quantity"
              />
              <Select value={entryUnit} onValueChange={(value) => setEntryUnit(value as EntryUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {selectedIngredient ? (
                    entryUnitsForBase(selectedIngredient.base_unit).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u === "l" ? "L" : u === "piece" ? "pc" : u}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value={entryUnit}>{entryUnit}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Button type="submit">
                {editingRecipeId ? <SaveIcon /> : <Plus className="mr-2 h-4 w-4" />}
                {editingRecipeId ? "Update" : "Add"}
              </Button>
              {editingRecipeId && (
                <Button type="button" variant="ghost" onClick={resetRecipeForm}>
                  Cancel
                </Button>
              )}
            </form>
          )}
          {!selected ? (
            <div className="py-12 text-center text-muted-foreground">Select a menu item.</div>
          ) : recipesQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <div className="space-y-2">
              {recipesQ.data?.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{r.inventory_items?.name}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Cost{" "}
                      {formatMoney(
                        Number(r.quantity) * Number(r.inventory_items?.average_cost ?? 0),
                        symbol,
                      )}
                    </div>
                  </div>
                  <div className="font-mono">
                    {qtyLabel(r.quantity, r.inventory_items?.base_unit)}
                  </div>
                  {manager && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => editRecipe(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeRecipe(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {recipesQ.data?.length === 0 && (
                <div className="py-12 text-center text-muted-foreground">
                  No recipe yet. POS will warn but still allow sale.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SaveIcon() {
  return <Pencil className="mr-2 h-4 w-4" />;
}

function AdjustmentsTab({ branchId, manager }: { branchId: string; manager: boolean }) {
  const qc = useQueryClient();
  const itemsQ = useInventoryItems(branchId, true);
  const [item, setItem] = useState("");
  const [type, setType] = useState<MovementType>("waste");
  const [qty, setQty] = useState("0");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = itemsQ.data?.find((i: any) => i.id === item);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!manager) return;
    const raw = Number(qty);
    if (!item || !Number.isFinite(raw) || raw === 0) {
      toast.error("Select item and enter quantity");
      return;
    }
    const negativeTypes = new Set(["waste", "damage", "staff_meal"]);
    const delta = negativeTypes.has(type) ? -Math.abs(raw) : raw;
    const reason: AdjustmentReason =
      type === "adjustment" ? "other" : type === "correction" ? "correction" : type;
    setLoading(true);
    try {
      const { error } = await db.rpc("record_inventory_adjustment", {
        _item: item,
        _movement_type: type,
        _reason: reason,
        _quantity_delta: delta,
        _note: note,
      });
      if (error) throw error;
      toast.success("Adjustment recorded");
      setQty("0");
      setNote("");
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inventory-movements"] });
      qc.invalidateQueries({ queryKey: ["inventory-reports"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to record adjustment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual stock adjustment</CardTitle>
        <CardDescription>Record waste, damage, staff meal, or corrections.</CardDescription>
      </CardHeader>
      <CardContent>
        {manager ? (
          <form
            onSubmit={save}
            className="grid gap-4 lg:grid-cols-[1fr_180px_160px_1fr_auto] lg:items-end"
          >
            <div className="space-y-1.5">
              <Label>Ingredient</Label>
              <Select value={item} onValueChange={setItem}>
                <SelectTrigger>
                  <SelectValue placeholder="Select ingredient" />
                </SelectTrigger>
                <SelectContent>
                  {itemsQ.data?.map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} · {qtyLabel(i.current_qty, i.base_unit)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: MovementType) => setType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waste">Waste</SelectItem>
                  <SelectItem value="damage">Damage</SelectItem>
                  <SelectItem value="staff_meal">Staff meal</SelectItem>
                  <SelectItem value="correction">Correction</SelectItem>
                  <SelectItem value="adjustment">Other adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Qty {selected ? `(${unitLabel(selected.base_unit)})` : ""}</Label>
              <Input
                type="number"
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only managers and owners can adjust stock.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsTab({ branchId, symbol }: { branchId: string; symbol: string }) {
  const todayValue = pakistanDateInputValue();
  const [startDate, setStartDate] = useState(todayValue);
  const [endDate, setEndDate] = useState(todayValue);

  const lowQ = useQuery({
    queryKey: ["inventory-reports", "low", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_low_stock")
        .select("*")
        .eq("branch_id", branchId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const movementsQ = useQuery({
    queryKey: ["inventory-movements", branchId, startDate, endDate],
    queryFn: async () => {
      const bounds = pakistanDateRangeUtcBounds(startDate, endDate);
      const { data, error } = await db
        .from("inventory_movements")
        .select("*, inventory_items(name, base_unit)")
        .eq("branch_id", branchId)
        .gte("created_at", bounds.start)
        .lt("created_at", bounds.end)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return data ?? [];
    },
  });
  const costsQ = useQuery({
    queryKey: ["inventory-reports", "costs", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_food_cost_by_menu_item")
        .select("*")
        .eq("branch_id", branchId)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Low stock</CardTitle>
          <CardDescription>Ingredients at or below reorder level.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {lowQ.data?.map((i: any) => (
            <div
              key={i.id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div>
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-muted-foreground">{i.category || i.base_unit}</div>
              </div>
              <div className="text-right font-mono text-amber-300">
                {qtyLabel(i.current_qty, i.base_unit)}
              </div>
            </div>
          ))}
          {lowQ.data?.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">No low stock items.</div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Food cost</CardTitle>
          <CardDescription>Recipe cost against menu price.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {costsQ.data?.map((m: any) => (
            <div
              key={m.menu_item_id}
              className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <div className="font-medium">{m.name}</div>
              <div className="font-mono">{formatMoney(m.recipe_cost, symbol)}</div>
              <div className="font-mono text-muted-foreground">
                {Number(m.food_cost_percent).toFixed(1)}%
              </div>
            </div>
          ))}
          {costsQ.data?.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">No food-cost data yet.</div>
          )}
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Movement ledger</CardTitle>
          <CardDescription>
            Stock changes from purchases, POS sales, and adjustments in the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface/50 p-3">
            <div className="flex-1 min-w-[200px]">
              <Label
                htmlFor="movement-start-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                From
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="movement-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label
                htmlFor="movement-end-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                To
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="movement-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="flex-1"
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const dateStr = pakistanDateInputValue();
                setStartDate(dateStr);
                setEndDate(dateStr);
              }}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Today
            </Button>
          </div>
          {movementsQ.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Time</th>
                    <th className="pr-4">Ingredient</th>
                    <th className="pr-4">Type</th>
                    <th className="pr-4">Delta</th>
                    <th className="pr-4">After</th>
                    <th className="pr-4">Purchase</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {movementsQ.data?.map((m: any) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-2 pr-4 text-muted-foreground">
                        {formatDate(m.created_at)}
                      </td>
                      <td className="pr-4">{m.inventory_items?.name}</td>
                      <td className="pr-4 capitalize">
                        {String(m.movement_type).replace("_", " ")}
                      </td>
                      <td
                        className={`pr-4 font-mono ${Number(m.quantity_delta) < 0 ? "text-destructive" : "text-success"}`}
                      >
                        {qtyLabel(m.quantity_delta, m.inventory_items?.base_unit)}
                      </td>
                      <td className="pr-4 font-mono">
                        {qtyLabel(m.after_qty, m.inventory_items?.base_unit)}
                      </td>
                      <td className="pr-4">
                        {m.related_purchase_id ? (
                          <PurchaseDetailsDialog
                            purchaseId={m.related_purchase_id}
                            manager={false}
                            symbol={symbol}
                            items={[]}
                            suppliers={[]}
                            onSaved={() => {}}
                            onDelete={() => {}}
                            trigger={
                              <Button type="button" variant="ghost" size="sm">
                                <Eye className="mr-2 h-4 w-4" />
                                View
                              </Button>
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="text-muted-foreground">{m.note}</td>
                    </tr>
                  ))}
                  {movementsQ.data?.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-muted-foreground">
                        No stock movements in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: any;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40" : ""}>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-3xl">{value}</p>
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${highlight ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
