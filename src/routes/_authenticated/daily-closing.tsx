import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Lock,
  Package,
  RotateCcw,
  Save,
  Scale,
  Trash2,
  Unlock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin, isManager } from "@/hooks/use-auth";
import { formatMoney, pakistanDateInputValue } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/daily-closing")({
  component: DailyClosingPage,
});

type BaseUnit = "g" | "ml" | "piece";
type EntryUnit = "g" | "kg" | "ml" | "l" | "piece";

type InventoryItem = {
  id: string;
  name: string;
  category: string | null;
  base_unit: BaseUnit;
  current_qty: number;
  average_cost: number;
  is_active: boolean;
};

type CountSession = {
  id: string;
  business_date: string;
  status: "open" | "closed";
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
};

type CountLine = {
  inventory_item_id: string;
  opening_qty: number | null;
  closing_qty: number | null;
  opening_note: string | null;
  closing_note: string | null;
};

type ReportRow = {
  inventory_item_id: string;
  item_name: string;
  category: string | null;
  unit: BaseUnit;
  opening_qty: number | null;
  purchased_qty: number;
  adjustment_qty: number;
  waste_qty: number;
  closing_qty: number | null;
  actual_usage_qty: number | null;
  theoretical_usage_qty: number;
  variance_qty: number | null;
  variance_cost: number | null;
  average_cost: number;
  status: "needs_opening" | "needs_closing" | "balanced" | "over_used" | "under_used";
  missing_recipe: boolean;
};

type DraftCount = {
  opening: string;
  closing: string;
  openingNote: string;
  closingNote: string;
  unit: EntryUnit;
};

type CountPayloadLine = {
  inventory_item_id: string;
  qty: number;
  note: string;
};

type RpcResult<T> = { data: T | null; error: { message?: string } | null };
type DynamicRpc = <T>(fn: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;

const rpcCall = supabase.rpc.bind(supabase) as unknown as DynamicRpc;

function DailyClosingPage() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const manager = isManager(roles);
  const admin = isAdmin(roles);
  const qc = useQueryClient();
  const symbol = restaurant?.currency_symbol ?? "Rs";
  const todayValue = pakistanDateInputValue();
  const [businessDate, setBusinessDate] = useState(todayValue);
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftCount>>({});
  const [saving, setSaving] = useState<
    "open" | "opening" | "closing" | "close" | "reopen" | "delete" | null
  >(null);

  const itemsQ = useQuery({
    queryKey: ["daily-closing-items", branch?.id],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, category, base_unit, current_qty, average_cost, is_active")
        .eq("branch_id", branch!.id)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((item) => ({
        ...item,
        current_qty: Number(item.current_qty || 0),
        average_cost: Number(item.average_cost || 0),
      })) as InventoryItem[];
    },
  });

  const sessionQ = useQuery({
    queryKey: ["stock-count-session", branch?.id, businessDate],
    enabled: !!branch,
    queryFn: async () => {
      const { data, error } = await rpcCall<unknown[]>("get_stock_count_session", {
        _branch_id: branch!.id,
        _business_date: businessDate,
      });
      if (error) throw error;
      return toCountSession(data?.[0] ?? null);
    },
  });

  const linesQ = useQuery({
    queryKey: ["stock-count-lines", sessionQ.data?.id],
    enabled: !!sessionQ.data?.id,
    queryFn: async () => {
      const { data, error } = await rpcCall<unknown[]>("get_stock_count_lines", {
        _session_id: sessionQ.data!.id,
      });
      if (error) throw error;
      return toCountLines(data);
    },
  });

  const reportQ = useQuery({
    queryKey: ["stock-reconciliation-report", sessionQ.data?.id],
    enabled: !!sessionQ.data?.id,
    queryFn: async () => {
      const { data, error } = await rpcCall<unknown[]>("get_stock_reconciliation_report", {
        _session_id: sessionQ.data!.id,
      });
      if (error) throw error;
      return toReportRows(data);
    },
  });

  const items = itemsQ.data ?? [];
  const lineByItem = useMemo(() => {
    const map = new Map<string, CountLine>();
    for (const line of linesQ.data ?? []) map.set(line.inventory_item_id, line);
    return map;
  }, [linesQ.data]);
  const reportRows = useMemo(() => reportQ.data ?? [], [reportQ.data]);
  const totals = useMemo(() => {
    return reportRows.reduce(
      (acc, row) => {
        acc.actualCost += Number(row.actual_usage_qty || 0) * row.average_cost;
        acc.theoreticalCost += row.theoretical_usage_qty * row.average_cost;
        acc.varianceCost += Math.abs(Number(row.variance_cost || 0));
        if (row.status === "over_used") acc.overUsed += 1;
        if (row.status === "under_used") acc.underUsed += 1;
        if (row.status === "needs_opening" || row.status === "needs_closing")
          acc.missingCounts += 1;
        return acc;
      },
      {
        actualCost: 0,
        theoreticalCost: 0,
        varianceCost: 0,
        overUsed: 0,
        underUsed: 0,
        missingCounts: 0,
      },
    );
  }, [reportRows]);

  const session = sessionQ.data;

  function draftFor(item: InventoryItem) {
    const existing = lineByItem.get(item.id);
    const current = drafts[item.id];
    const unit = current?.unit ?? preferredEntryUnit(item.base_unit);
    return {
      unit,
      opening:
        current?.opening ??
        (existing?.opening_qty == null
          ? ""
          : String(quantityFromBase(existing.opening_qty, item.base_unit, unit))),
      closing:
        current?.closing ??
        (existing?.closing_qty == null
          ? ""
          : String(quantityFromBase(existing.closing_qty, item.base_unit, unit))),
      openingNote: current?.openingNote ?? existing?.opening_note ?? "",
      closingNote: current?.closingNote ?? existing?.closing_note ?? "",
    };
  }

  function updateDraft(item: InventoryItem, patch: Partial<DraftCount>) {
    setDrafts((current) => ({
      ...current,
      [item.id]: { ...draftFor(item), ...patch },
    }));
  }

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["stock-count-session"] }),
      qc.invalidateQueries({ queryKey: ["stock-count-lines"] }),
      qc.invalidateQueries({ queryKey: ["stock-reconciliation-report"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-today"] }),
      qc.invalidateQueries({ queryKey: ["item-usage-report"] }),
      qc.invalidateQueries({ queryKey: ["stock-count-sessions"] }),
      qc.invalidateQueries({ queryKey: ["recipe-usage-calibration"] }),
      qc.invalidateQueries({ queryKey: ["inventory-recipes"] }),
    ]);
  }

  async function openSession() {
    if (!branch) return;
    setSaving("open");
    try {
      const { error } = await rpcCall<string>("open_stock_count_session", {
        _branch_id: branch.id,
        _business_date: businessDate,
        _notes: notes || null,
      });
      if (error) throw error;
      toast.success("Daily closing session opened");
      setDrafts({});
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to open session"));
    } finally {
      setSaving(null);
    }
  }

  async function saveCounts(phase: "opening" | "closing") {
    if (!session) return;
    const payload = items
      .map((item) => {
        const draft = draftFor(item);
        const value = phase === "opening" ? draft.opening : draft.closing;
        if (value.trim() === "") return null;
        const qty = Number(value);
        if (!Number.isFinite(qty) || qty < 0) throw new Error(`Invalid count for ${item.name}`);
        return {
          inventory_item_id: item.id,
          qty: quantityToBase(qty, item.base_unit, draft.unit),
          note: phase === "opening" ? draft.openingNote : draft.closingNote,
        };
      })
      .filter(isCountPayloadLine);

    if (payload.length === 0) {
      toast.error("Enter at least one count");
      return;
    }

    setSaving(phase);
    try {
      const { error } = await rpcCall<null>("save_stock_count_lines", {
        _session_id: session.id,
        _phase: phase,
        _lines: payload,
      });
      if (error) throw error;
      toast.success(`${phase === "opening" ? "Opening" : "Closing"} counts saved`);
      setDrafts({});
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save counts"));
    } finally {
      setSaving(null);
    }
  }

  async function closeSession() {
    if (!session) return;
    setSaving("close");
    try {
      const { error } = await rpcCall<null>("close_stock_count_session", {
        _session_id: session.id,
        _notes: notes || null,
      });
      if (error) throw error;
      toast.success("Daily closing completed");
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to close session"));
    } finally {
      setSaving(null);
    }
  }

  async function reopenSession() {
    if (!session) return;
    const reason = window.prompt("Why are you reopening this daily closing?");
    if (!reason?.trim()) return;

    setSaving("reopen");
    try {
      const { error } = await rpcCall<null>("reopen_stock_count_session", {
        _session_id: session.id,
        _reason: reason,
      });
      if (error) throw error;
      toast.success("Daily closing reopened");
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to reopen closing"));
    } finally {
      setSaving(null);
    }
  }

  async function deleteSession() {
    if (!session) return;
    const reason = window.prompt("Why are you deleting this test closing?");
    if (!reason?.trim()) return;
    const ok = window.confirm(
      "Delete this daily closing and all its count lines? Use this only for test or bad data.",
    );
    if (!ok) return;

    setSaving("delete");
    try {
      const { error } = await rpcCall<null>("delete_stock_count_session_admin", {
        _session_id: session.id,
        _reason: reason,
      });
      if (error) throw error;
      toast.success("Test closing deleted");
      setDrafts({});
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to delete closing"));
    } finally {
      setSaving(null);
    }
  }

  if (!branch) {
    return <div className="p-8 text-center text-muted-foreground">Select a branch first.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
            {branch.name}
          </p>
          <h1 className="font-display text-3xl leading-tight">Daily Closing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Opening stock, closing count, and variance against recipe usage.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[170px]">
            <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Business date
            </Label>
            <Input
              type="date"
              value={businessDate}
              onChange={(event) => {
                setBusinessDate(event.target.value || todayValue);
                setDrafts({});
              }}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setBusinessDate(todayValue);
              setDrafts({});
            }}
            aria-label="Today"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!manager && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            Manager access is required to enter or close stock counts.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={ClipboardCheck}
          label="Session"
          value={session ? session.status : "Not opened"}
          tone={session?.status === "closed" ? "success" : session ? "primary" : "muted"}
        />
        <SummaryCard
          icon={Scale}
          label="Variance exposure"
          value={formatMoney(totals.varianceCost, symbol)}
          tone={totals.varianceCost > 0 ? "warning" : "success"}
        />
        <SummaryCard
          icon={Package}
          label="Actual food cost"
          value={formatMoney(totals.actualCost, symbol)}
          tone="muted"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Attention items"
          value={String(totals.overUsed + totals.underUsed + totals.missingCounts)}
          tone={
            totals.overUsed + totals.underUsed + totals.missingCounts > 0 ? "warning" : "success"
          }
        />
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">Stock count session</CardTitle>
            {session && <StatusBadge status={session.status} />}
          </div>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Shift notes, unusual events, large party, staff meal, supplier issue..."
            rows={2}
            disabled={!manager || session?.status === "closed"}
          />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!session ? (
            <Button onClick={openSession} disabled={!manager || saving === "open"}>
              {saving === "open" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Open daily session
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => saveCounts("opening")}
                disabled={!manager || saving === "opening" || session.status === "closed"}
              >
                {saving === "opening" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save opening
              </Button>
              <Button
                variant="outline"
                onClick={() => saveCounts("closing")}
                disabled={!manager || saving === "closing" || session.status === "closed"}
              >
                {saving === "closing" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save closing
              </Button>
              <Button
                onClick={closeSession}
                disabled={!manager || saving === "close" || session.status === "closed"}
              >
                {saving === "close" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lock className="mr-2 h-4 w-4" />
                )}
                Close day
              </Button>
              {session.status === "closed" && (
                <>
                  <Button
                    variant="outline"
                    onClick={reopenSession}
                    disabled={!manager || saving === "reopen"}
                  >
                    {saving === "reopen" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Unlock className="mr-2 h-4 w-4" />
                    )}
                    Reopen closing
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={deleteSession}
                    disabled={!admin || saving === "delete"}
                  >
                    {saving === "delete" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete test closing
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Opening and closing counts</CardTitle>
          </CardHeader>
          <CardContent>
            {itemsQ.isLoading || linesQ.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/70">
                <table className="w-full text-sm">
                  <thead className="bg-muted/25 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Opening</th>
                      <th className="px-3 py-2">Closing</th>
                      <th className="px-3 py-2">System stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const draft = draftFor(item);
                      return (
                        <tr key={item.id} className="border-t border-border/50">
                          <td className="min-w-[220px] px-3 py-2">
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.category ?? "Uncategorized"}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={draft.unit}
                              onChange={(event) =>
                                updateDraft(item, { unit: event.target.value as EntryUnit })
                              }
                              disabled={session.status === "closed"}
                              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                              {entryUnitsForBase(item.base_unit).map((unit) => (
                                <option key={unit} value={unit}>
                                  {unitLabel(unit)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="min-w-[150px] px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={draft.opening}
                              onChange={(event) =>
                                updateDraft(item, { opening: event.target.value })
                              }
                              disabled={session.status === "closed"}
                              className="font-mono"
                            />
                          </td>
                          <td className="min-w-[150px] px-3 py-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={draft.closing}
                              onChange={(event) =>
                                updateDraft(item, { closing: event.target.value })
                              }
                              disabled={session.status === "closed"}
                              className="font-mono"
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {qtyLabel(item.current_qty, item.base_unit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Variance report</CardTitle>
          </CardHeader>
          <CardContent>
            {reportQ.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : reportRows.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Enter opening and closing counts to see reconciliation.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/70">
                <table className="w-full text-sm">
                  <thead className="bg-muted/25 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Actual</th>
                      <th className="px-3 py-2 text-right">Expected</th>
                      <th className="px-3 py-2 text-right">Variance</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRows.map((row) => (
                      <tr key={row.inventory_item_id} className="border-t border-border/50">
                        <td className="min-w-[220px] px-3 py-2">
                          <div className="font-medium">{row.item_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.category ?? "Uncategorized"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.actual_usage_qty == null
                            ? "-"
                            : qtyLabel(row.actual_usage_qty, row.unit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {qtyLabel(row.theoretical_usage_qty, row.unit)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${
                            Number(row.variance_qty || 0) > 0
                              ? "text-destructive"
                              : Number(row.variance_qty || 0) < 0
                                ? "text-amber-300"
                                : "text-success"
                          }`}
                        >
                          {row.variance_qty == null ? "-" : qtyLabel(row.variance_qty, row.unit)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatMoney(Math.abs(Number(row.variance_cost || 0)), symbol)}
                        </td>
                        <td className="px-3 py-2">
                          <VarianceBadge status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "primary" | "success" | "warning" | "muted";
}) {
  const toneClass = {
    primary: "border-primary/40 bg-primary/10 text-primary",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    muted: "border-border bg-card text-muted-foreground",
  }[tone];

  return (
    <Card className={toneClass}>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
          <p className="mt-2 font-display text-lg capitalize leading-none">{value}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0" />
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: CountSession["status"] }) {
  return status === "closed" ? (
    <Badge variant="outline" className="border-success/30 bg-success/15 text-success">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Closed
    </Badge>
  ) : (
    <Badge variant="outline" className="border-primary/30 bg-primary/15 text-primary">
      Open
    </Badge>
  );
}

function VarianceBadge({ status }: { status: ReportRow["status"] }) {
  const map: Record<ReportRow["status"], { label: string; cls: string }> = {
    needs_opening: {
      label: "Needs opening",
      cls: "border-muted bg-muted/30 text-muted-foreground",
    },
    needs_closing: {
      label: "Needs closing",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    },
    balanced: { label: "Balanced", cls: "border-success/30 bg-success/15 text-success" },
    over_used: {
      label: "Over used",
      cls: "border-destructive/30 bg-destructive/15 text-destructive",
    },
    under_used: { label: "Under used", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  };
  const item = map[status];
  return (
    <Badge variant="outline" className={item.cls}>
      {item.label}
    </Badge>
  );
}

function isCountPayloadLine(line: CountPayloadLine | null): line is CountPayloadLine {
  return line !== null;
}

function toCountSession(data: unknown): CountSession | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Partial<Record<keyof CountSession, unknown>>;
  const status = row.status === "closed" ? "closed" : "open";
  return {
    id: String(row.id ?? ""),
    business_date: String(row.business_date ?? ""),
    status,
    notes: typeof row.notes === "string" ? row.notes : null,
    opened_at: String(row.opened_at ?? ""),
    closed_at: typeof row.closed_at === "string" ? row.closed_at : null,
  };
}

function toCountLines(data: unknown[] | null): CountLine[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const line = raw as Partial<Record<keyof CountLine, unknown>>;
    return {
      inventory_item_id: String(line.inventory_item_id ?? ""),
      opening_qty: line.opening_qty == null ? null : Number(line.opening_qty),
      closing_qty: line.closing_qty == null ? null : Number(line.closing_qty),
      opening_note: typeof line.opening_note === "string" ? line.opening_note : null,
      closing_note: typeof line.closing_note === "string" ? line.closing_note : null,
    };
  });
}

function toReportRows(data: unknown[] | null): ReportRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const row = raw as Partial<Record<keyof ReportRow, unknown>>;
    return {
      inventory_item_id: String(row.inventory_item_id ?? ""),
      item_name: String(row.item_name ?? "Unknown item"),
      category: typeof row.category === "string" ? row.category : null,
      unit: row.unit === "ml" || row.unit === "piece" ? row.unit : "g",
      opening_qty: row.opening_qty == null ? null : Number(row.opening_qty),
      purchased_qty: Number(row.purchased_qty || 0),
      adjustment_qty: Number(row.adjustment_qty || 0),
      waste_qty: Number(row.waste_qty || 0),
      closing_qty: row.closing_qty == null ? null : Number(row.closing_qty),
      actual_usage_qty: row.actual_usage_qty == null ? null : Number(row.actual_usage_qty),
      theoretical_usage_qty: Number(row.theoretical_usage_qty || 0),
      variance_qty: row.variance_qty == null ? null : Number(row.variance_qty),
      variance_cost: row.variance_cost == null ? null : Number(row.variance_cost),
      average_cost: Number(row.average_cost || 0),
      status: isReportStatus(row.status) ? row.status : "balanced",
      missing_recipe: row.missing_recipe === true,
    };
  });
}

function isReportStatus(value: unknown): value is ReportRow["status"] {
  return (
    value === "needs_opening" ||
    value === "needs_closing" ||
    value === "balanced" ||
    value === "over_used" ||
    value === "under_used"
  );
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

function quantityFromBase(qty: number, unit: BaseUnit, entryUnit: EntryUnit) {
  if (unit === "g" && entryUnit === "kg") return qty / 1000;
  if (unit === "ml" && entryUnit === "l") return qty / 1000;
  return qty;
}

function quantityToBase(qty: number, unit: BaseUnit, entryUnit: EntryUnit) {
  if (unit === "g" && entryUnit === "kg") return qty * 1000;
  if (unit === "ml" && entryUnit === "l") return qty * 1000;
  return qty;
}

function unitLabel(unit: EntryUnit) {
  if (unit === "piece") return "pc";
  if (unit === "l") return "L";
  return unit;
}

function qtyLabel(qty: number, unit: BaseUnit) {
  const n = Number(qty || 0);
  if (unit === "g" && Math.abs(n) >= 1000) return `${trimNumber(n / 1000)} kg`;
  if (unit === "ml" && Math.abs(n) >= 1000) return `${trimNumber(n / 1000)} L`;
  return `${trimNumber(n)} ${unit === "piece" ? "pc" : unit}`;
}

function trimNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
