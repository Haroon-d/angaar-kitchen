import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  ClipboardCheck,
  ClipboardList,
  Eye,
  LockKeyhole,
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
  businessDateInputValue,
  businessDateRangeUtcBounds,
  formatDate,
  formatMoney,
  formatPakistanDateLabel,
  pakistanDateInputValue,
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
import {
  baseUnitLabel,
  costFromBase as convertCostFromBase,
  costToBase as convertCostToBase,
  defaultOperationalUnit,
  isPackagingUnit,
  quantityFromBase as convertQuantityFromBase,
  quantityToBase as convertQuantityToBase,
  shortUnitLabel,
  unitDefinition,
  unitFactorToBase,
  unitsForBase,
  type InventoryBaseUnit,
  type InventoryUnitCode,
} from "@/lib/inventory-units";

export const Route = createFileRoute("/_authenticated/inventory")({ component: InventoryPage });

type BaseUnit = InventoryBaseUnit;
type EntryUnit = InventoryUnitCode;
type PurchaseUnit = InventoryUnitCode;
type RecipeMode = "per_item" | "batch";
type MovementType = "adjustment" | "waste" | "correction" | "staff_meal" | "damage";
type AdjustmentReason = "waste" | "damage" | "correction" | "staff_meal" | "other";

type InventoryItemRow = {
  id: string;
  name: string;
  branch_id: string;
  base_unit: BaseUnit;
  display_unit?: EntryUnit | null;
  display_unit_factor?: number | string | null;
  current_qty?: number | string | null;
  reorder_level?: number | string | null;
  average_cost?: number | string | null;
  is_active?: boolean | null;
};

const db = supabase as any;

function InventoryPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const manager = isManager(roles);

  if (!branch || !restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;
  }

  const businessDayStart =
    ((branch as { business_day_start_time?: string }).business_day_start_time ?? "10:00").slice(
      0,
      5,
    );

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden p-4 sm:p-8">
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
          <TabsTrigger value="counts">
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Counts
          </TabsTrigger>
          <TabsTrigger value="suppliers">
            <Banknote className="mr-2 h-4 w-4" />
            Suppliers
          </TabsTrigger>
          <TabsTrigger value="control">
            <LockKeyhole className="mr-2 h-4 w-4" />
            Control
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
            businessDayStart={businessDayStart}
          />
        </TabsContent>
        <TabsContent value="recipes" className="mt-6">
          <RecipesTab branchId={branch.id} manager={manager} symbol={restaurant.currency_symbol} />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-6">
          <AdjustmentsTab branchId={branch.id} manager={manager} />
        </TabsContent>
        <TabsContent value="counts" className="mt-6">
          <CountsTab branchId={branch.id} manager={manager} symbol={restaurant.currency_symbol} />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-6">
          <SupplierLedgerTab
            branchId={branch.id}
            restaurantId={restaurant.id}
            manager={manager}
            symbol={restaurant.currency_symbol}
            businessDayStart={businessDayStart}
          />
        </TabsContent>
        <TabsContent value="control" className="mt-6">
          <InventoryControlTab branchId={branch.id} manager={manager} />
        </TabsContent>
        <TabsContent value="reports" className="mt-6">
          <ReportsTab
            branchId={branch.id}
            symbol={restaurant.currency_symbol}
            businessDayStart={businessDayStart}
          />
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
      return (data ?? []) as InventoryItemRow[];
    },
  });
}

function unitLabel(unit: BaseUnit) {
  return baseUnitLabel(unit);
}

function preferredEntryUnit(unit: BaseUnit): EntryUnit {
  return defaultOperationalUnit(unit);
}

function entryUnitsForBase(unit: BaseUnit): EntryUnit[] {
  return unitsForBase(unit).map((entry) => entry.code);
}

function unitOptionLabel(unit: EntryUnit) {
  return unitDefinition(unit)?.label ?? unit;
}

function factorForUnit(baseUnit: BaseUnit, entryUnit: EntryUnit, factor?: number | string | null) {
  return unitFactorToBase(baseUnit, entryUnit, factor);
}

function factorInputValue(
  baseUnit: BaseUnit,
  entryUnit: EntryUnit,
  factor?: number | string | null,
) {
  if (isPackagingUnit(entryUnit)) {
    const n = Number(factor);
    return Number.isFinite(n) && n > 0 ? String(n) : "";
  }
  return String(factorForUnit(baseUnit, entryUnit));
}

function displayUnitForItem(item: any): EntryUnit {
  return (item?.display_unit || preferredEntryUnit(item?.base_unit ?? "g")) as EntryUnit;
}

function displayFactorForItem(item: any, unit = displayUnitForItem(item)) {
  return item?.display_unit_factor ?? factorInputValue(item?.base_unit ?? "g", unit);
}

function quantityFromBase(
  qty: number | string,
  unit: BaseUnit,
  entryUnit: EntryUnit,
  factor?: number | string | null,
) {
  return convertQuantityFromBase(qty, unit, entryUnit, factor);
}

function quantityToBase(
  qty: number,
  unit: BaseUnit,
  entryUnit: EntryUnit,
  factor?: number | string | null,
) {
  return convertQuantityToBase(qty, unit, entryUnit, factor);
}

function costFromBase(
  cost: number | string,
  unit: BaseUnit,
  entryUnit: EntryUnit,
  factor?: number | string | null,
) {
  return convertCostFromBase(cost, unit, entryUnit, factor);
}

function costToBase(
  cost: number,
  unit: BaseUnit,
  entryUnit: EntryUnit,
  factor?: number | string | null,
) {
  return convertCostToBase(cost, unit, entryUnit, factor);
}

function costLabel(
  cost: number | string,
  unit: BaseUnit,
  symbol: string,
  displayUnit?: EntryUnit | null,
  displayFactor?: number | string | null,
) {
  const entryUnit = displayUnit ?? preferredEntryUnit(unit);
  return `${formatMoney(costFromBase(cost, unit, entryUnit, displayFactor), symbol)} / ${shortUnitLabel(entryUnit)}`;
}

function qtyLabel(
  qty: number | string,
  unit: BaseUnit,
  displayUnit?: EntryUnit | null,
  displayFactor?: number | string | null,
) {
  const n = Number(qty || 0);
  if (displayUnit) {
    return `${quantityFromBase(n, unit, displayUnit, displayFactor).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${shortUnitLabel(displayUnit)}`;
  }
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
              <table className="min-w-[760px] w-full text-sm">
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
                          {qtyLabel(
                            item.current_qty,
                            item.base_unit,
                            item.display_unit,
                            item.display_unit_factor,
                          )}
                        </td>
                        <td className="pr-4 font-mono">
                          {qtyLabel(
                            item.reorder_level,
                            item.base_unit,
                            item.display_unit,
                            item.display_unit_factor,
                          )}
                        </td>
                        <td className="pr-4 font-mono">
                          {costLabel(
                            item.average_cost,
                            item.base_unit,
                            symbol,
                            item.display_unit,
                            item.display_unit_factor,
                          )}
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
  display_unit: z.string().min(1).max(30),
  display_unit_factor: z.number().positive(),
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
  const initialEntryUnit = item ? displayUnitForItem(item) : preferredEntryUnit(initialBaseUnit);
  const initialFactor = displayFactorForItem(item, initialEntryUnit);
  const [f, setF] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    base_unit: initialBaseUnit,
    entry_unit: initialEntryUnit,
    conversion_factor: initialFactor,
    current_qty: String(
      quantityFromBase(item?.current_qty ?? "0", initialBaseUnit, initialEntryUnit, initialFactor),
    ),
    reorder_level: String(
      quantityFromBase(
        item?.reorder_level ?? "0",
        initialBaseUnit,
        initialEntryUnit,
        initialFactor,
      ),
    ),
    average_cost: String(
      costFromBase(item?.average_cost ?? "0", initialBaseUnit, initialEntryUnit, initialFactor),
    ),
    is_active: item?.is_active ?? true,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = IngredientSchema.safeParse({
      ...f,
      category: f.category || null,
      display_unit: f.entry_unit,
      display_unit_factor: factorForUnit(f.base_unit, f.entry_unit, f.conversion_factor),
      current_qty: quantityToBase(
        Number(f.current_qty),
        f.base_unit,
        f.entry_unit,
        f.conversion_factor,
      ),
      reorder_level: quantityToBase(
        Number(f.reorder_level),
        f.base_unit,
        f.entry_unit,
        f.conversion_factor,
      ),
      average_cost: costToBase(
        Number(f.average_cost),
        f.base_unit,
        f.entry_unit,
        f.conversion_factor,
      ),
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
                  const conversionFactor = factorInputValue(v, entryUnit);
                  setF({
                    ...f,
                    base_unit: v,
                    entry_unit: entryUnit,
                    conversion_factor: conversionFactor,
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
                  const oldFactor = f.conversion_factor;
                  const newFactor = factorInputValue(f.base_unit, v, oldFactor);
                  setF({
                    ...f,
                    entry_unit: v,
                    conversion_factor: newFactor,
                    current_qty: String(
                      quantityFromBase(
                        quantityToBase(Number(f.current_qty), f.base_unit, oldUnit, oldFactor),
                        f.base_unit,
                        v,
                        newFactor,
                      ),
                    ),
                    reorder_level: String(
                      quantityFromBase(
                        quantityToBase(Number(f.reorder_level), f.base_unit, oldUnit, oldFactor),
                        f.base_unit,
                        v,
                        newFactor,
                      ),
                    ),
                    average_cost: String(
                      costFromBase(
                        costToBase(Number(f.average_cost), f.base_unit, oldUnit, oldFactor),
                        f.base_unit,
                        v,
                        newFactor,
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
                      {unitOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isPackagingUnit(f.entry_unit) && (
              <div className="space-y-1.5">
                <Label>
                  1 {shortUnitLabel(f.entry_unit)} contains ({unitLabel(f.base_unit)})
                </Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={f.conversion_factor}
                  onChange={(e) => setF({ ...f, conversion_factor: e.target.value })}
                  placeholder={`e.g. 5000 ${unitLabel(f.base_unit)}`}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Current qty ({shortUnitLabel(f.entry_unit)})</Label>
              <Input
                type="number"
                step="0.001"
                value={f.current_qty}
                onChange={(e) => setF({ ...f, current_qty: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reorder level ({shortUnitLabel(f.entry_unit)})</Label>
              <Input
                type="number"
                step="0.001"
                value={f.reorder_level}
                onChange={(e) => setF({ ...f, reorder_level: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Avg cost / {shortUnitLabel(f.entry_unit)}</Label>
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
  businessDayStart,
}: {
  branchId: string;
  restaurantId: string;
  manager: boolean;
  symbol: string;
  businessDayStart: string;
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
  const financeAccountsQ = useQuery({
    queryKey: ["finance-accounts", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_accounts")
        .select("*")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  const purchasesQ = useQuery({
    queryKey: ["inventory-purchases", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_purchases")
        .select("*, suppliers(name), finance_accounts(name)")
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
    qc.invalidateQueries({ queryKey: ["finance-movements"] });
    qc.invalidateQueries({ queryKey: ["finance-day-closure"] });
  }

  async function deletePurchase(id: string) {
    void id;
    toast.error(
      "Purchases are ledger history. Use Adjustments or Physical Counts to correct stock.",
    );
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Purchase history</CardTitle>
          <CardDescription>Received stock updates weighted average cost.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
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
                    financeAccounts={financeAccountsQ.data ?? []}
                    onSaved={refreshPurchases}
                    onDelete={() => deletePurchase(p.id)}
                    trigger={
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{p.invoice_no || "Purchase"}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {p.suppliers?.name || "No supplier"} - {formatDate(p.purchase_date)}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            Paid from{" "}
                            {financeAccountsQ.data?.find(
                              (account: any) => account.id === p.finance_account_id,
                            )?.name || "Unpaid / supplier credit"}
                          </div>
                        </div>
                        <div className="shrink-0 whitespace-nowrap font-mono text-primary">
                          {formatMoney(p.total, symbol)}
                        </div>
                      </button>
                    }
                  />
                  {manager && (
                    <div className="flex shrink-0 gap-1">
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
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Record purchase</CardTitle>
          <CardDescription>Add received ingredients to stock.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          {manager ? (
            <PurchaseForm
              branchId={branchId}
              items={itemsQ.data ?? []}
              suppliers={suppliersQ.data ?? []}
              financeAccounts={financeAccountsQ.data ?? []}
              onAddSupplier={addSupplier}
              onSaved={refreshPurchases}
              businessDayStart={businessDayStart}
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
        .select(
          "*, suppliers(name), finance_accounts(name), inventory_purchase_lines(*, inventory_items(name, base_unit, display_unit, display_unit_factor))",
        )
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
  financeAccounts: any[];
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
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
              <div>
                <div className="text-xs text-muted-foreground">Payment source</div>
                <div className="font-medium">
                  {props.financeAccounts.find(
                    (account: any) => account.id === purchase.finance_account_id,
                  )?.name || "Unpaid / supplier credit"}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[720px] w-full text-sm">
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
                        {Number(line.quantity).toLocaleString()} {shortUnitLabel(line.unit)}
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
  const explainLockedPurchase = () =>
    toast.error(
      "Purchases are locked ledger history. Correct stock through Counts or Adjustments.",
    );
  if (props.trigger) {
    return (
      <span className="inline-flex" onClick={explainLockedPurchase}>
        {props.trigger}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={explainLockedPurchase}
      aria-label="Purchase editing is locked"
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}

function PurchaseForm(props: {
  branchId: string;
  items: any[];
  suppliers: any[];
  financeAccounts: any[];
  onAddSupplier: (name: string) => Promise<void>;
  onSaved: () => void;
  businessDayStart: string;
  purchase?: any;
}) {
  const purchaseLines = props.purchase?.inventory_purchase_lines ?? [];
  const [supplier, setSupplier] = useState(props.purchase?.supplier_id ?? "none");
  const [newSupplier, setNewSupplier] = useState("");
  const [invoice, setInvoice] = useState(props.purchase?.invoice_no ?? "");
  const [date, setDate] = useState(
    props.purchase?.purchase_date ?? businessDateInputValue(props.businessDayStart),
  );
  const [financeAccount, setFinanceAccount] = useState(
    props.purchase?.finance_account_id ??
      props.financeAccounts.find((account) => account.account_type === "counter_cash")?.id ??
      "none",
  );
  const [notes, setNotes] = useState(props.purchase?.notes ?? "");
  const [lines, setLines] = useState<PurchaseLine[]>(
    purchaseLines.length
      ? purchaseLines.map((line: any) => ({
          inventory_item_id: line.inventory_item_id,
          quantity: String(line.quantity ?? "1"),
          unit: (line.unit || "kg") as PurchaseUnit,
          pack_size: String(line.conversion_factor ?? line.pack_size ?? ""),
          unit_cost: String(line.unit_cost ?? "0"),
        }))
      : [{ inventory_item_id: "", quantity: "1", unit: "kg", pack_size: "", unit_cost: "0" }],
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (props.purchase || financeAccount !== "none") return;
    const counterAccount = props.financeAccounts.find(
      (account) => account.account_type === "counter_cash",
    );
    if (counterAccount) setFinanceAccount(counterAccount.id);
  }, [financeAccount, props.financeAccounts, props.purchase]);

  const itemMap = new Map(props.items.map((i) => [i.id, i]));
  function purchaseUnitForItem(item: any): PurchaseUnit {
    return displayUnitForItem(item) as PurchaseUnit;
  }
  function purchaseFactorForItem(item: any, unit: PurchaseUnit) {
    return factorInputValue(item.base_unit, unit, item.display_unit_factor);
  }
  function purchaseBaseQty(item: any, line: PurchaseLine) {
    return quantityToBase(Number(line.quantity), item.base_unit, line.unit, line.pack_size);
  }
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
    if (financeAccount === "none") {
      toast.error("Select where this purchase was paid from.");
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
          finance_account_id: financeAccount,
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

          const conversionFactor = factorForUnit(item.base_unit, line.unit, line.pack_size);
          const baseQty = purchaseBaseQty(item, line);

          const lineTotal = Number(line.quantity) * Number(line.unit_cost);
          runningTotal += lineTotal;

          await db.from("inventory_purchase_lines").insert({
            purchase_id: props.purchase.id,
            inventory_item_id: line.inventory_item_id,
            quantity: Number(line.quantity),
            unit: line.unit,
            pack_size: isPackagingUnit(line.unit) ? Number(line.pack_size) : null,
            conversion_factor: conversionFactor,
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
              entered_quantity: Number(line.quantity),
              entered_unit: line.unit,
              conversion_factor: conversionFactor,
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
          _finance_account: financeAccount,
          _invoice_no: invoice,
          _purchase_date: date,
          _notes: notes,
          _lines: clean.map((l) => {
            const item = itemMap.get(l.inventory_item_id);
            if (!item) throw new Error("Purchase line ingredient was not found.");
            return {
              inventory_item_id: l.inventory_item_id,
              quantity: Number(l.quantity),
              unit: l.unit,
              pack_size: isPackagingUnit(l.unit) ? Number(l.pack_size) : null,
              conversion_factor: factorForUnit(item.base_unit, l.unit, l.pack_size),
              unit_cost: Number(l.unit_cost) || 0,
            };
          }),
        };
        const { error } = await db.rpc("record_inventory_purchase", {
          _branch: props.branchId,
          ...payload,
        });
        if (error) throw error;
        toast.success("Purchase recorded");
        setInvoice("");
        setFinanceAccount(
          props.financeAccounts.find((account) => account.account_type === "counter_cash")?.id ??
            "none",
        );
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
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Invoice no.</Label>
          <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Paid from</Label>
          <Select value={financeAccount} onValueChange={setFinanceAccount}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unpaid / supplier credit</SelectItem>
              {props.financeAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Lines</Label>
        <div className="max-w-full overflow-x-auto">
          <div className="grid min-w-[600px] grid-cols-[minmax(0,2.2fr)_72px_82px_82px_86px_36px] gap-2 rounded-lg border border-border bg-surface p-3 text-xs uppercase tracking-wide text-muted-foreground">
            <div>Ingredient</div>
            <div>Qty</div>
            <div>Unit</div>
            <div>Contains</div>
            <div>Unit cost</div>
            <div className="text-right">Action</div>
          </div>
        </div>
        {lines.map((line, idx) => {
          const item = itemMap.get(line.inventory_item_id);
          return (
            <div
              key={idx}
              className="max-w-full overflow-x-auto rounded-lg border border-border p-0"
            >
              <div className="grid min-w-[600px] grid-cols-[minmax(0,2.2fr)_72px_82px_82px_86px_36px] gap-2 p-3">
                <Select
                  value={line.inventory_item_id}
                  onValueChange={(v) => {
                    const nextItem = itemMap.get(v);
                    const nextUnit = nextItem ? purchaseUnitForItem(nextItem) : "kg";
                    patchLine(idx, {
                      inventory_item_id: v,
                      unit: nextUnit,
                      pack_size: nextItem ? purchaseFactorForItem(nextItem, nextUnit) : "",
                    });
                  }}
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
                  onValueChange={(v: PurchaseUnit) =>
                    patchLine(idx, {
                      unit: v,
                      pack_size: item ? factorInputValue(item.base_unit, v, line.pack_size) : "",
                    })
                  }
                >
                  <SelectTrigger className="min-w-0 w-full">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {(item ? entryUnitsForBase(item.base_unit) : ["kg", "g", "pack"]).map((u) => (
                      <SelectItem key={u} value={u}>
                        {shortUnitLabel(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="min-w-0 w-full"
                  type="number"
                  step="0.001"
                  disabled={!isPackagingUnit(line.unit)}
                  placeholder={
                    isPackagingUnit(line.unit) && item ? `per ${unitLabel(item.base_unit)}` : "Auto"
                  }
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
        .select(
          "*, inventory_items(name, base_unit, average_cost, display_unit, display_unit_factor)",
        )
        .eq("menu_item_id", selected)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [ingredient, setIngredient] = useState("");
  const [recipeMode, setRecipeMode] = useState<RecipeMode>("per_item");
  const [entryUnit, setEntryUnit] = useState<EntryUnit>("g");
  const [conversionFactor, setConversionFactor] = useState("");
  const [qty, setQty] = useState("");
  const [batchYield, setBatchYield] = useState("");
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);

  const inventoryItemsById = useMemo(
    () => new Map((itemsQ.data ?? []).map((item: any) => [item.id, item])),
    [itemsQ.data],
  );
  const activeIngredients = useMemo(
    () => (itemsQ.data ?? []).filter((item: any) => item.is_active),
    [itemsQ.data],
  );
  const selectedIngredient = inventoryItemsById.get(ingredient);

  async function addRecipe(e: React.FormEvent) {
    e.preventDefault();
    const rawQty = Number(qty);
    const yieldQty = recipeMode === "batch" ? Number(batchYield) : 1;
    if (
      !selected ||
      !ingredient ||
      !selectedIngredient ||
      !Number.isFinite(rawQty) ||
      rawQty <= 0 ||
      !Number.isFinite(yieldQty) ||
      yieldQty <= 0
    ) {
      toast.error("Select item and enter positive quantity and batch yield");
      return;
    }
    const factor = factorForUnit(selectedIngredient.base_unit, entryUnit, conversionFactor);
    const batchBaseQty = quantityToBase(
      rawQty,
      selectedIngredient.base_unit,
      entryUnit,
      conversionFactor,
    );
    const perItemBaseQty = batchBaseQty / yieldQty;
    const perItemEntryQty = rawQty / yieldQty;
    const { error } = await db.from("inventory_recipes").upsert(
      {
        menu_item_id: selected,
        inventory_item_id: ingredient,
        quantity: perItemBaseQty,
        recipe_mode: recipeMode,
        entry_quantity: perItemEntryQty,
        entry_unit: entryUnit,
        conversion_factor: factor,
        batch_yield: yieldQty,
        batch_entry_quantity: rawQty,
        batch_entry_unit: entryUnit,
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
    setRecipeMode("per_item");
    setEntryUnit("g");
    setConversionFactor("");
    setQty("");
    setBatchYield("");
    setEditingRecipeId(null);
  }

  function editRecipe(row: any) {
    const unit = row.inventory_items?.base_unit as BaseUnit;
    const preferred = (row.entry_unit || preferredEntryUnit(unit)) as EntryUnit;
    const factor = row.conversion_factor ?? factorInputValue(unit, preferred);
    const mode = (row.recipe_mode === "batch" ? "batch" : "per_item") as RecipeMode;
    setEditingRecipeId(row.id);
    setIngredient(row.inventory_item_id);
    setRecipeMode(mode);
    setEntryUnit(preferred);
    setConversionFactor(String(factor));
    setBatchYield(String(row.batch_yield ?? 1));
    setQty(
      String(
        mode === "batch"
          ? (row.batch_entry_quantity ??
              Number(row.entry_quantity ?? 0) * Number(row.batch_yield ?? 1))
          : (row.entry_quantity ?? quantityFromBase(row.quantity, unit, preferred, factor)),
      ),
    );
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
  const recipePreview = useMemo(() => {
    if (!selectedIngredient) return null;
    const rawQty = Number(qty);
    const yieldQty = recipeMode === "batch" ? Number(batchYield) : 1;
    if (!Number.isFinite(rawQty) || rawQty <= 0 || !Number.isFinite(yieldQty) || yieldQty <= 0) {
      return null;
    }
    try {
      const batchBaseQty = quantityToBase(
        rawQty,
        selectedIngredient.base_unit,
        entryUnit,
        conversionFactor,
      );
      const perItemBaseQty = batchBaseQty / yieldQty;
      return {
        batchLabel: `${rawQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${shortUnitLabel(entryUnit)}`,
        perItemLabel: qtyLabel(perItemBaseQty, selectedIngredient.base_unit),
        yieldQty,
      };
    } catch {
      return null;
    }
  }, [batchYield, conversionFactor, entryUnit, qty, recipeMode, selectedIngredient]);

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Menu item</CardTitle>
          <CardDescription>
            Choose one sale item, then add the ingredients it consumes.
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
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Recipe</CardTitle>
          <CardDescription>
            Use batch recipes when you cook once and sell many portions. Example: 2 kg rice makes 16
            plates, so the system deducts 125 g on each sale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {manager && selected && (
            <form
              onSubmit={addRecipe}
              className="grid min-w-0 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="space-y-1.5">
                <Label>Recipe type</Label>
                <Select
                  value={recipeMode}
                  onValueChange={(value) => {
                    const nextMode = value as RecipeMode;
                    setRecipeMode(nextMode);
                    if (nextMode === "per_item") setBatchYield("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_item">Per sale item</SelectItem>
                    <SelectItem value="batch">Batch yield</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label>Ingredient</Label>
                <Select
                  value={ingredient}
                  onValueChange={(value) => {
                    setIngredient(value);
                    const item = inventoryItemsById.get(value);
                    if (item) {
                      const nextUnit = displayUnitForItem(item);
                      setEntryUnit(nextUnit);
                      setConversionFactor(
                        factorInputValue(item.base_unit, nextUnit, item.display_unit_factor),
                      );
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Ingredient" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeIngredients.map((i: any) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({unitLabel(i.base_unit)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  {recipeMode === "batch" ? "Ingredient quantity" : "Qty per sale item"}
                </Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder={recipeMode === "batch" ? "e.g. 2" : "e.g. 0.125"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select
                  value={entryUnit}
                  onValueChange={(value) => {
                    const nextUnit = value as EntryUnit;
                    setEntryUnit(nextUnit);
                    if (selectedIngredient) {
                      setConversionFactor(
                        factorInputValue(
                          selectedIngredient.base_unit,
                          nextUnit,
                          selectedIngredient.display_unit_factor,
                        ),
                      );
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedIngredient ? (
                      entryUnitsForBase(selectedIngredient.base_unit).map((u) => (
                        <SelectItem key={u} value={u}>
                          {shortUnitLabel(u)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value={entryUnit}>{entryUnit}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Pack conversion</Label>
                {selectedIngredient && isPackagingUnit(entryUnit) ? (
                  <Input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={conversionFactor}
                    onChange={(e) => setConversionFactor(e.target.value)}
                    placeholder={`1 ${shortUnitLabel(entryUnit)} = ${unitLabel(selectedIngredient.base_unit)}`}
                  />
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-border bg-muted/25 px-3 text-sm text-muted-foreground">
                    Auto
                  </div>
                )}
              </div>
              <div className={recipeMode === "batch" ? "space-y-1.5" : "hidden"}>
                <Label>How many sale items?</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={batchYield}
                  onChange={(e) => setBatchYield(e.target.value)}
                  placeholder="e.g. 16"
                />
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <Button type="submit" className="w-full sm:w-auto">
                  {editingRecipeId ? <SaveIcon /> : <Plus className="mr-2 h-4 w-4" />}
                  {editingRecipeId ? "Update ingredient" : "Add ingredient"}
                </Button>
              </div>
              {recipePreview && (
                <div className="rounded-md border border-border bg-background/40 p-3 text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                  {recipeMode === "batch"
                    ? `${recipePreview.batchLabel} makes ${recipePreview.yieldQty.toLocaleString()} sale items. Stock will reduce ${recipePreview.perItemLabel} for each sale.`
                    : `Each sold item uses ${recipePreview.perItemLabel}.`}
                </div>
              )}
              {editingRecipeId && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetRecipeForm}
                  className="sm:col-span-2 lg:col-span-3"
                >
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
              {recipesQ.data?.map((r: any) => {
                const fallbackItem = inventoryItemsById.get(r.inventory_item_id);
                const rowBase = (r.inventory_items?.base_unit ??
                  fallbackItem?.base_unit ??
                  "g") as BaseUnit;
                const rowUnit = (r.entry_unit || preferredEntryUnit(rowBase)) as EntryUnit;
                const rowFactor = r.conversion_factor ?? factorInputValue(rowBase, rowUnit);
                const rowMode = r.recipe_mode === "batch" ? "batch" : "per_item";
                const batchQty = Number(r.batch_entry_quantity ?? r.entry_quantity ?? 0);
                const batchYieldValue = Number(r.batch_yield ?? 1);
                const batchUnit = (r.batch_entry_unit || rowUnit) as EntryUnit;
                const ingredientName =
                  r.inventory_items?.name ?? fallbackItem?.name ?? "Deleted ingredient";
                const averageCost = Number(
                  r.inventory_items?.average_cost ?? fallbackItem?.average_cost ?? 0,
                );
                return (
                  <div
                    key={r.id}
                    className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-base font-semibold">{ingredientName}</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          Cost {formatMoney(Number(r.quantity) * averageCost, symbol)} per sale item
                        </span>
                        <span>Stock reduces {qtyLabel(r.quantity, rowBase)} per sale</span>
                        {rowMode === "batch" && (
                          <span>
                            Batch:{" "}
                            {batchQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}{" "}
                            {shortUnitLabel(batchUnit)} makes{" "}
                            {batchYieldValue.toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}{" "}
                            sale items
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="text-right">
                        <div className="font-mono text-lg font-semibold">
                          {rowMode === "batch"
                            ? `${Number(r.entry_quantity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${shortUnitLabel(rowUnit)}`
                            : r.entry_quantity
                              ? `${Number(r.entry_quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${shortUnitLabel(rowUnit)}`
                              : qtyLabel(
                                  r.quantity,
                                  r.inventory_items?.base_unit,
                                  rowUnit,
                                  rowFactor,
                                )}
                        </div>
                        {rowMode === "batch" && (
                          <div className="text-xs text-muted-foreground">per item</div>
                        )}
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
                  </div>
                );
              })}
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
  const itemsQ = useInventoryItems(branchId, false);
  const [item, setItem] = useState("");
  const [type, setType] = useState<MovementType>("waste");
  const [entryUnit, setEntryUnit] = useState<EntryUnit>("kg");
  const [conversionFactor, setConversionFactor] = useState("");
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
    const enteredQty = negativeTypes.has(type) ? -Math.abs(raw) : raw;
    const factor = selected ? factorForUnit(selected.base_unit, entryUnit, conversionFactor) : 1;
    const reason: AdjustmentReason =
      type === "adjustment" ? "other" : type === "correction" ? "correction" : type;
    setLoading(true);
    try {
      const { error } = await db.rpc("record_inventory_adjustment", {
        _item: item,
        _movement_type: type,
        _reason: reason,
        _entered_quantity: enteredQty,
        _unit: entryUnit,
        _conversion_factor: factor,
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
            className="grid gap-4 xl:grid-cols-[1fr_170px_130px_160px_1fr_auto] xl:items-end"
          >
            <div className="space-y-1.5">
              <Label>Ingredient</Label>
              <Select
                value={item}
                onValueChange={(value) => {
                  setItem(value);
                  const nextItem = itemsQ.data?.find((i: any) => i.id === value);
                  if (nextItem) {
                    const nextUnit = displayUnitForItem(nextItem);
                    setEntryUnit(nextUnit);
                    setConversionFactor(
                      factorInputValue(nextItem.base_unit, nextUnit, nextItem.display_unit_factor),
                    );
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select ingredient" />
                </SelectTrigger>
                <SelectContent>
                  {itemsQ.data?.map((i: any) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name} -{" "}
                      {qtyLabel(i.current_qty, i.base_unit, i.display_unit, i.display_unit_factor)}
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
              <Label>Qty</Label>
              <Input
                type="number"
                step="0.001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Select
                value={entryUnit}
                onValueChange={(value) => {
                  const nextUnit = value as EntryUnit;
                  setEntryUnit(nextUnit);
                  if (selected) {
                    setConversionFactor(
                      factorInputValue(selected.base_unit, nextUnit, selected.display_unit_factor),
                    );
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(selected ? entryUnitsForBase(selected.base_unit) : (["kg", "g", "pack"] as EntryUnit[])).map(
                    (u) => (
                      <SelectItem key={u} value={u}>
                        {unitOptionLabel(u)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {selected && isPackagingUnit(entryUnit) && (
              <div className="space-y-1.5">
                <Label>Contains ({unitLabel(selected.base_unit)})</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={conversionFactor}
                  onChange={(e) => setConversionFactor(e.target.value)}
                />
              </div>
            )}
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

type CountLine = {
  inventory_item_id: string;
  counted_quantity: string;
  counted_unit: EntryUnit;
  conversion_factor: string;
};

function CountsTab({
  branchId,
  manager,
  symbol,
}: {
  branchId: string;
  manager: boolean;
  symbol: string;
}) {
  const qc = useQueryClient();
  const itemsQ = useInventoryItems(branchId, true);
  const countsQ = useQuery({
    queryKey: ["inventory-counts", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("inventory_counts")
        .select("*")
        .eq("branch_id", branchId)
        .order("count_date", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
  const [countDate, setCountDate] = useState(pakistanDateInputValue());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [loading, setLoading] = useState(false);

  const itemMap = new Map((itemsQ.data ?? []).map((item: any) => [item.id, item]));
  const totalVarianceValue = lines.reduce((sum, line) => {
    const item = itemMap.get(line.inventory_item_id);
    if (!item) return sum;
    try {
      const countedBase = quantityToBase(
        Number(line.counted_quantity || 0),
        item.base_unit,
        line.counted_unit,
        line.conversion_factor,
      );
      return (
        sum + Math.abs(countedBase - Number(item.current_qty || 0)) * Number(item.average_cost || 0)
      );
    } catch {
      return sum;
    }
  }, 0);

  function addLine(item?: any) {
    const target =
      item ??
      itemsQ.data?.find((entry: any) => !lines.some((line) => line.inventory_item_id === entry.id));
    const unit = target ? displayUnitForItem(target) : "kg";
    setLines((current) => [
      ...current,
      {
        inventory_item_id: target?.id ?? "",
        counted_quantity: target
          ? String(
              quantityFromBase(
                target.current_qty,
                target.base_unit,
                unit,
                target.display_unit_factor,
              ),
            )
          : "0",
        counted_unit: unit,
        conversion_factor: target
          ? factorInputValue(target.base_unit, unit, target.display_unit_factor)
          : "",
      },
    ]);
  }

  function loadAllCurrentStock() {
    setLines(
      (itemsQ.data ?? []).map((item: any) => {
        const unit = displayUnitForItem(item);
        return {
          inventory_item_id: item.id,
          counted_quantity: String(
            quantityFromBase(item.current_qty, item.base_unit, unit, item.display_unit_factor),
          ),
          counted_unit: unit,
          conversion_factor: factorInputValue(item.base_unit, unit, item.display_unit_factor),
        };
      }),
    );
  }

  function patchLine(index: number, patch: Partial<CountLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function applyCount(e: React.FormEvent) {
    e.preventDefault();
    if (!manager) return;
    const clean = lines.filter(
      (line) => line.inventory_item_id && Number(line.counted_quantity) >= 0,
    );
    if (!clean.length) {
      toast.error("Add at least one counted ingredient");
      return;
    }
    setLoading(true);
    try {
      const { error } = await db.rpc("apply_inventory_count", {
        _branch: branchId,
        _count_date: countDate,
        _notes: notes,
        _lines: clean.map((line) => {
          const item = itemMap.get(line.inventory_item_id);
          if (!item) throw new Error("Counted ingredient was not found.");
          return {
            inventory_item_id: line.inventory_item_id,
            counted_quantity: Number(line.counted_quantity),
            counted_unit: line.counted_unit,
            conversion_factor: factorForUnit(
              item.base_unit,
              line.counted_unit,
              line.conversion_factor,
            ),
          };
        }),
      });
      if (error) throw error;
      toast.success("Physical count applied");
      setLines([]);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["inventory-items"] });
      qc.invalidateQueries({ queryKey: ["inventory-counts"] });
      qc.invalidateQueries({ queryKey: ["inventory-movements"] });
      qc.invalidateQueries({ queryKey: ["inventory-reports"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to apply count");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Physical stock count</CardTitle>
          <CardDescription>
            Enter actual stock. Variance is posted as correction movements and stays auditable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {manager ? (
            <form onSubmit={applyCount} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label>Count date</Label>
                  <Input
                    type="date"
                    value={countDate}
                    onChange={(e) => setCountDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <Button type="button" variant="outline" onClick={loadAllCurrentStock}>
                  Load stock
                </Button>
                <Button type="button" variant="outline" onClick={() => addLine()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Line
                </Button>
              </div>

              <div className="space-y-2">
                {lines.map((line, index) => {
                  const item = itemMap.get(line.inventory_item_id);
                  const countedBase = item
                    ? (() => {
                        try {
                          return quantityToBase(
                            Number(line.counted_quantity || 0),
                            item.base_unit,
                            line.counted_unit,
                            line.conversion_factor,
                          );
                        } catch {
                          return Number.NaN;
                        }
                      })()
                    : 0;
                  const variance =
                    item && Number.isFinite(countedBase)
                      ? countedBase - Number(item.current_qty || 0)
                      : 0;
                  return (
                    <div key={index} className="rounded-lg border border-border p-3">
                      <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,2fr)_120px_120px_120px_42px]">
                        <Select
                          value={line.inventory_item_id}
                          onValueChange={(value) => {
                            const nextItem = itemMap.get(value);
                            const unit = nextItem
                              ? displayUnitForItem(nextItem)
                              : line.counted_unit;
                            patchLine(index, {
                              inventory_item_id: value,
                              counted_unit: unit,
                              counted_quantity: nextItem
                                ? String(
                                    quantityFromBase(
                                      nextItem.current_qty,
                                      nextItem.base_unit,
                                      unit,
                                      nextItem.display_unit_factor,
                                    ),
                                  )
                                : line.counted_quantity,
                              conversion_factor: nextItem
                                ? factorInputValue(
                                    nextItem.base_unit,
                                    unit,
                                    nextItem.display_unit_factor,
                                  )
                                : line.conversion_factor,
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Ingredient" />
                          </SelectTrigger>
                          <SelectContent>
                            {(itemsQ.data ?? []).map((entry: any) => (
                              <SelectItem key={entry.id} value={entry.id}>
                                {entry.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={line.counted_quantity}
                          onChange={(e) => patchLine(index, { counted_quantity: e.target.value })}
                        />
                        <Select
                          value={line.counted_unit}
                          onValueChange={(value: EntryUnit) => {
                            patchLine(index, {
                              counted_unit: value,
                              conversion_factor: item
                                ? factorInputValue(item.base_unit, value, item.display_unit_factor)
                                : "",
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(item ? entryUnitsForBase(item.base_unit) : ["kg", "g", "pack"]).map(
                              (unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {shortUnitLabel(unit)}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          step="0.001"
                          disabled={!isPackagingUnit(line.counted_unit)}
                          placeholder={
                            isPackagingUnit(line.counted_unit) && item
                              ? `per ${unitLabel(item.base_unit)}`
                              : "Auto"
                          }
                          value={line.conversion_factor}
                          onChange={(e) => patchLine(index, { conversion_factor: e.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setLines((current) => current.filter((_, i) => i !== index))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {item && (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>
                            System:{" "}
                            {qtyLabel(
                              item.current_qty,
                              item.base_unit,
                              item.display_unit,
                              item.display_unit_factor,
                            )}
                          </span>
                          <span
                            className={
                              variance < 0 ? "text-destructive" : variance > 0 ? "text-success" : ""
                            }
                          >
                            Variance: {qtyLabel(variance, item.base_unit)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {lines.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
                    Load stock or add counted lines.
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Estimated variance value:{" "}
                  <span className="font-mono text-foreground">
                    {formatMoney(totalVarianceValue, symbol)}
                  </span>
                </div>
                <Button type="submit" disabled={loading || lines.length === 0}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Apply count
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only managers and owners can apply stock counts.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Recent counts</CardTitle>
          <CardDescription>Applied physical audits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {countsQ.data?.map((count: any) => (
            <div key={count.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{formatDate(count.count_date)}</div>
                <Badge variant="outline" className="capitalize">
                  {count.status}
                </Badge>
              </div>
              {count.notes && <div className="mt-1 text-muted-foreground">{count.notes}</div>}
            </div>
          ))}
          {countsQ.data?.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">No counts yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupplierLedgerTab({
  branchId,
  restaurantId,
  manager,
  symbol,
  businessDayStart,
}: {
  branchId: string;
  restaurantId: string;
  manager: boolean;
  symbol: string;
  businessDayStart: string;
}) {
  const qc = useQueryClient();
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
  const ledgerQ = useQuery({
    queryKey: ["supplier-ledger", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_ledger_entries")
        .select("*")
        .eq("branch_id", branchId)
        .order("occurred_on", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const financeAccountsQ = useQuery({
    queryKey: ["finance-accounts", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_accounts")
        .select("*")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(businessDateInputValue(businessDayStart));
  const [financeAccount, setFinanceAccount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const supplierById = new Map<string, any>((suppliersQ.data ?? []).map((entry: any) => [entry.id, entry]));
  const financeAccountById = new Map<string, any>(
    (financeAccountsQ.data ?? []).map((entry: any) => [entry.id, entry]),
  );
  useEffect(() => {
    if (financeAccount || !financeAccountsQ.data?.length) return;
    const defaultSource =
      financeAccountsQ.data.find((account: any) => account.account_type === "counter_cash") ??
      financeAccountsQ.data[0];
    setFinanceAccount(defaultSource.id);
  }, [financeAccount, financeAccountsQ.data]);
  const balances = new Map<string, number>();
  for (const entry of ledgerQ.data ?? []) {
    balances.set(
      entry.supplier_id,
      (balances.get(entry.supplier_id) ?? 0) + Number(entry.amount || 0),
    );
  }
  const selectedEntries = supplier
    ? (ledgerQ.data ?? []).filter((entry: any) => entry.supplier_id === supplier)
    : (ledgerQ.data ?? []);

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!manager) return;
    setLoading(true);
    try {
      const { error } = await db.rpc("record_supplier_payment", {
        _branch: branchId,
        _supplier: supplier,
        _finance_account: financeAccount,
        _amount: Number(amount),
        _date: date,
        _reference: reference,
        _notes: notes,
      });
      if (error) throw error;
      toast.success("Supplier payment recorded");
      setAmount("");
      setReference("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["supplier-ledger"] });
      qc.invalidateQueries({ queryKey: ["finance-movements"] });
      qc.invalidateQueries({ queryKey: ["finance-day-closure"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to record supplier payment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Supplier balances</CardTitle>
          <CardDescription>Purchases add payable balance; payments reduce it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger>
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {(suppliersQ.data ?? []).map((entry: any) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="space-y-2">
            {(suppliersQ.data ?? []).map((entry: any) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSupplier(entry.id)}
                className={`flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm ${
                  supplier === entry.id ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="font-medium">{entry.name}</span>
                <span className="font-mono">
                  {formatMoney(balances.get(entry.id) ?? 0, symbol)}
                </span>
              </button>
            ))}
            {suppliersQ.data?.length === 0 && (
              <div className="py-10 text-center text-muted-foreground">No suppliers yet.</div>
            )}
          </div>
          {manager && (
            <form
              onSubmit={recordPayment}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div className="font-medium">Record payment</div>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount paid"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Select value={financeAccount} onValueChange={setFinanceAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Paid from" />
                </SelectTrigger>
                <SelectContent>
                  {(financeAccountsQ.data ?? []).map((account: any) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <Textarea
                rows={2}
                placeholder="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                type="submit"
                disabled={loading || !supplier || !financeAccount || Number(amount) <= 0}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save payment
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Supplier ledger</CardTitle>
          <CardDescription>Immutable payable movement history.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="pr-4">Supplier</th>
                  <th className="pr-4">Type</th>
                  <th className="pr-4">Paid from</th>
                  <th className="pr-4">Reference</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedEntries.map((entry: any) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="py-2 pr-4">{formatDate(entry.occurred_on)}</td>
                    <td className="pr-4">
                      {supplierById.get(entry.supplier_id)?.name ?? "Supplier"}
                    </td>
                    <td className="pr-4 capitalize">{entry.entry_type}</td>
                    <td className="pr-4 text-muted-foreground">
                      {entry.finance_account_id
                        ? (financeAccountById.get(entry.finance_account_id)?.name ??
                          "Payment source")
                        : "-"}
                    </td>
                    <td className="pr-4 text-muted-foreground">{entry.reference_no || "-"}</td>
                    <td
                      className={`text-right font-mono ${Number(entry.amount) < 0 ? "text-success" : "text-primary"}`}
                    >
                      {formatMoney(entry.amount, symbol)}
                    </td>
                  </tr>
                ))}
                {selectedEntries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-muted-foreground">
                      No supplier ledger entries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryControlTab({ branchId, manager }: { branchId: string; manager: boolean }) {
  const qc = useQueryClient();
  const branchQ = useQuery({
    queryKey: ["inventory-control-branch", branchId],
    queryFn: async () => {
      const { data, error } = await db
        .from("branches")
        .select("id, inventory_locked_before")
        .eq("id", branchId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const existing = branchQ.data?.inventory_locked_before
    ? String(branchQ.data.inventory_locked_before).slice(0, 10)
    : "";
  const [lockDate, setLockDate] = useState(existing);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLockDate(existing);
  }, [existing]);

  async function saveLock(e: React.FormEvent) {
    e.preventDefault();
    if (!manager) return;
    setLoading(true);
    try {
      const lockedBefore = lockDate ? `${lockDate}T00:00:00+05:00` : null;
      const { error } = await db.rpc("set_inventory_lock", {
        _branch: branchId,
        _locked_before: lockedBefore,
      });
      if (error) throw error;
      toast.success(lockDate ? "Inventory lock updated" : "Inventory lock cleared");
      qc.invalidateQueries({ queryKey: ["inventory-control-branch"] });
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update inventory lock");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inventory controls</CardTitle>
        <CardDescription>
          Lock old periods after audit so staff cannot backdate purchases, waste, or order inventory
          reversals.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {manager ? (
          <form onSubmit={saveLock} className="max-w-xl space-y-4">
            <div className="space-y-1.5">
              <Label>Lock inventory before</Label>
              <Input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} />
              <p className="text-sm text-muted-foreground">
                Example: choose today after closing yesterday. Any inventory transaction before this
                date must be corrected in the current period.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save lock
              </Button>
              <Button type="button" variant="outline" onClick={() => setLockDate("")}>
                Clear
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only managers and owners can change inventory locks.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsTab({
  branchId,
  symbol,
  businessDayStart,
}: {
  branchId: string;
  symbol: string;
  businessDayStart: string;
}) {
  const todayValue = businessDateInputValue(businessDayStart);
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
    queryKey: ["inventory-movements", branchId, startDate, endDate, businessDayStart],
    queryFn: async () => {
      const bounds = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
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
  const performanceQ = useQuery({
    queryKey: ["inventory-reports", "performance", branchId, startDate, endDate, businessDayStart],
    queryFn: async () => {
      const bounds = businessDateRangeUtcBounds(startDate, endDate, businessDayStart);
      const { data, error } = await db
        .from("inventory_menu_performance")
        .select("*")
        .eq("branch_id", branchId)
        .gte("created_at", bounds.start)
        .lt("created_at", bounds.end)
        .order("gross_profit", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const movements = movementsQ.data ?? [];
  const movementCost = (movement: any) =>
    Math.abs(Number(movement.quantity_delta || 0)) * Number(movement.unit_cost || 0);
  const purchasedValue = movements
    .filter((movement: any) => movement.movement_type === "purchase")
    .reduce((sum: number, movement: any) => sum + movementCost(movement), 0);
  const salesRecipeCost = movements
    .filter((movement: any) => movement.movement_type === "sale")
    .reduce((sum: number, movement: any) => sum + movementCost(movement), 0);
  const wasteValue = movements
    .filter((movement: any) => ["waste", "damage", "staff_meal"].includes(movement.movement_type))
    .reduce((sum: number, movement: any) => sum + movementCost(movement), 0);
  const missingRecipeCount = (costsQ.data ?? []).filter(
    (item: any) => Number(item.recipe_cost || 0) <= 0,
  ).length;
  const periodLabel =
    startDate === endDate
      ? formatPakistanDateLabel(startDate)
      : `${formatPakistanDateLabel(startDate)} to ${formatPakistanDateLabel(endDate)}`;

  return (
    <div className="min-w-0 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Food control period</CardTitle>
          <CardDescription>
            Reports below use the selected period for stock movement, waste, and dish performance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Label
                htmlFor="inventory-report-start-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                From
              </Label>
              <Input
                id="inventory-report-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label
                htmlFor="inventory-report-end-date"
                className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                To
              </Label>
              <Input
                id="inventory-report-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                const dateStr = businessDateInputValue(businessDayStart);
                setStartDate(dateStr);
                setEndDate(dateStr);
              }}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Today
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Purchased" value={formatMoney(purchasedValue, symbol)} icon={ReceiptText} />
        <Stat label="Recipe usage" value={formatMoney(salesRecipeCost, symbol)} icon={Utensils} />
        <Stat
          label="Waste / damage"
          value={formatMoney(wasteValue, symbol)}
          icon={AlertTriangle}
          highlight={wasteValue > 0}
        />
        <Stat
          label="Missing recipes"
          value={String(missingRecipeCount)}
          icon={ClipboardList}
          highlight={missingRecipeCount > 0}
        />
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
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
                  {qtyLabel(i.current_qty, i.base_unit, i.display_unit, i.display_unit_factor)}
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
            <CardTitle>Dish performance</CardTitle>
            <CardDescription>
              Sales, estimated recipe cost, and gross profit by dish for {periodLabel}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {performanceQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[820px] w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4">Dish</th>
                      <th className="pr-4 text-right">Sold</th>
                      <th className="pr-4 text-right">Revenue</th>
                      <th className="pr-4 text-right">Food cost</th>
                      <th className="pr-4 text-right">Profit</th>
                      <th className="text-right">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performanceQ.data?.map((dish: any) => (
                      <tr key={dish.menu_item_id} className="border-t border-border">
                        <td className="py-2 pr-4 font-medium">{dish.name}</td>
                        <td className="pr-4 text-right font-mono">
                          {Number(dish.qty_sold || 0).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="pr-4 text-right font-mono">
                          {formatMoney(dish.revenue, symbol)}
                        </td>
                        <td className="pr-4 text-right font-mono">
                          {formatMoney(dish.theoretical_food_cost, symbol)}
                        </td>
                        <td className="pr-4 text-right font-mono text-primary">
                          {formatMoney(dish.gross_profit, symbol)}
                        </td>
                        <td className="text-right font-mono">
                          {Number(dish.gross_margin_percent || 0).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                    {performanceQ.data?.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-muted-foreground">
                          No sales performance yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
          <CardContent>
            {movementsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-sm">
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
                          {m.entered_quantity && m.entered_unit
                            ? `${Number(m.entered_quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${shortUnitLabel(m.entered_unit)}`
                            : qtyLabel(m.quantity_delta, m.inventory_items?.base_unit)}
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
                              financeAccounts={[]}
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
