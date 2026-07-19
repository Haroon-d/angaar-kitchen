import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Printer,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Flame,
  ChefHat,
  ReceiptText,
  CreditCard,
  AlertCircle,
  Ban,
  Pencil,
  Percent,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin, isManager } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReceiptTemplate } from "@/components/receipt/ReceiptTemplate";
import { KotTemplate } from "@/components/receipt/KotTemplate";
import { PrintService } from "@/lib/print/print-service";
import { renderReceiptText, renderKotText } from "@/lib/print/text-render";
import { usePrinterSettings } from "@/lib/print/settings";
import { formatMoney } from "@/lib/format";
import type { ReceiptData } from "@/lib/print/types";
import type { Database } from "@/integrations/supabase/types";

const SearchSchema = z.object({ placed: z.coerce.boolean().optional() });

export const Route = createFileRoute("/_authenticated/receipt/$orderId")({
  validateSearch: (s) => SearchSchema.parse(s),
  component: OrderTicketPage,
});

type PaymentMethod = "cash" | "card" | "upi" | "wallet" | "other";
type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];
type OrderRow = Tables["orders"]["Row"];
type OrderItemRow = Tables["order_items"]["Row"];
type OrderTaxRow = Tables["order_taxes"]["Row"];
type PaymentRow = Tables["payments"]["Row"];
type OrderStatus = Enums["order_status"];
type PaymentStatus = Enums["payment_status_t"];
type RpcError = { message?: string };
type RpcResult = { error: RpcError | null };
type DynamicRpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

async function runRpc(fn: string, args: Record<string, unknown>) {
  const { error } = (await supabase.rpc(fn, args)) as RpcResult;
  if (error) throw error;
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function OrderTicketPage() {
  const { orderId } = Route.useParams();
  const search = useSearch({ from: Route.id });
  const justPlaced = !!search.placed;
  const { restaurant, branch } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const { settings } = usePrinterSettings(branch?.id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [printingKind, setPrintingKind] = useState<null | "kot" | "bill" | "receipt">(null);

  const q = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data: order, error } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();
      if (error) throw error;
      const [{ data: items }, { data: taxes }, { data: payments }, { data: profile }] =
        await Promise.all([
          supabase.from("order_items").select("*").eq("order_id", orderId),
          supabase.from("order_taxes").select("*").eq("order_id", orderId),
          supabase.from("payments").select("*").eq("order_id", orderId).order("paid_at"),
          order.created_by
            ? supabase.from("profiles").select("full_name").eq("id", order.created_by).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
      return {
        order: order as OrderRow,
        items: (items ?? []) as OrderItemRow[],
        taxes: (taxes ?? []) as OrderTaxRow[],
        payments: (payments ?? []) as PaymentRow[],
        cashier: profile?.full_name ?? null,
      };
    },
  });

  const data: ReceiptData | null = useMemo(() => {
    if (!q.data || !restaurant) return null;
    const { order, items, taxes, payments, cashier } = q.data;
    const orderWithDelivery = order as OrderRow & { delivery_fee?: number | string | null };
    const parsedNotes = parseOrderNotes(order.notes);
    return {
      brandName: restaurant.name,
      legalName: restaurant.legal_name,
      address: branch?.address ?? restaurant.address,
      phone: branch?.phone ?? restaurant.phone,
      taxId: settings.taxId || null,
      logoUrl: restaurant.logo_url ?? null,
      orderNo: order.order_no,
      orderId: order.id,
      diningType: order.dining_type,
      tableLabel: order.table_label,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerAddress: parsedNotes.address || null,
      orderNotes: parsedNotes.notes || null,
      cashierName: cashier,
      createdAt: order.created_at,
      currencySymbol: restaurant.currency_symbol ?? "₨",
      items: items.map((i) => ({
        id: i.id,
        name: i.name_snapshot,
        qty: i.qty,
        unit_price: Number(i.unit_price),
        line_total: Number(i.line_subtotal),
        notes: i.notes,
      })),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount_total),
      deliveryFee: Number(orderWithDelivery.delivery_fee ?? 0),
      taxes: taxes.map((t) => ({
        name: t.name_snapshot,
        rate: Number(t.rate_snapshot),
        amount: Number(t.amount),
      })),
      grandTotal: Number(order.grand_total),
      paymentStatus: (order.payment_status ?? "pending") as ReceiptData["paymentStatus"],
      payments: payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        kind: p.kind ?? null,
        reference: p.reference,
      })),
      amountReceived: Number(order.amount_paid),
      changeReturned: Math.max(0, Number(order.amount_paid) - Number(order.grand_total)),
      footerNote: settings.footerNote,
    };
  }, [q.data, restaurant, branch, settings.footerNote, settings.taxId]);

  if (q.error) return <div className="p-8 text-center text-destructive">Order not found.</div>;

  if (q.isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  const order = q.data!.order;
  const paymentStatus = (order.payment_status ?? "pending") as PaymentStatus;
  const orderStatus = (order.status ?? "open") as OrderStatus;
  const remaining = Math.max(0, Number(order.grand_total) - Number(order.amount_paid));
  const cancelled = ["cancelled", "voided", "refunded"].includes(orderStatus);
  const manager = isManager(roles);
  const admin = isAdmin(roles);
  const canCancel =
    manager &&
    !cancelled &&
    orderStatus !== "completed" &&
    paymentStatus === "pending" &&
    Number(order.amount_paid) <= 0;
  const canEdit = canCancel && !q.data!.payments.length;
  const canVoid = manager && !cancelled;
  const canRefund = manager && !cancelled && Number(order.amount_paid) > 0;
  const canReopen = manager && orderStatus === "completed";
  const canDelete = admin && cancelled;
  const canUpdateFulfillment =
    manager && !cancelled && paymentStatus !== "refunded" && orderStatus !== "completed";

  async function refreshOrderState() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["order", orderId] }),
      qc.invalidateQueries({ queryKey: ["orders-list"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-today"] }),
      qc.invalidateQueries({ queryKey: ["item-usage-report"] }),
      qc.invalidateQueries({ queryKey: ["menu-stock-status"] }),
      qc.invalidateQueries({ queryKey: ["inventory-items"] }),
      qc.invalidateQueries({ queryKey: ["inventory-movements"] }),
      qc.invalidateQueries({ queryKey: ["inventory-reports"] }),
      qc.invalidateQueries({ queryKey: ["inventory-menu-performance"] }),
      qc.invalidateQueries({ queryKey: ["inventory-control-branch"] }),
    ]);
  }

  async function doPrint(kind: "kot" | "bill" | "receipt") {
    if (!data) return;
    if (printingKind) return;
    if (settings.driver === "network") {
      toast.error(
        "Network TCP printing is not supported on Vercel deployments. Switch to QZ Tray in Settings.",
      );
      return;
    }
    setPrintingKind(kind);
    try {
      const driverId = await PrintService.activeDriverId();
      let body: string;
      if (driverId === "network") {
        const textWidth = settings.paperSize === "58mm" ? 32 : 42;
        body = kind === "kot" ? renderKotText(data, textWidth) : renderReceiptText(data, textWidth);
      } else if (kind === "kot") {
        body = PrintService.renderHtml(<KotTemplate data={data} paperSize={settings.paperSize} />);
      } else {
        body = PrintService.renderHtml(
          <ReceiptTemplate data={data} paperSize={settings.paperSize} />,
        );
      }
      await PrintService.print({
        html: body,
        kind,
        paperSize: settings.paperSize,
        copies: kind === "kot" ? settings.printKotCopies : 1,
      });
      await runRpc("record_print", { _order_id: orderId, _kind: kind });
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      toast.success(`${labelForKind(kind)} sent to printer`);
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Print failed"));
    } finally {
      setPrintingKind(null);
    }
  }

  return (
    <div className="min-h-screen bg-coal-gradient">
      {justPlaced && (
        <SuccessRibbon
          orderNo={data.orderNo}
          total={data.grandTotal}
          symbol={data.currencySymbol}
        />
      )}

      <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8 lg:grid-cols-[1fr_380px]">
        {/* Receipt preview */}
        <div className="flex justify-center">
          <div className="w-full max-w-[420px]">
            <ReceiptTemplate data={data} paperSize={settings.paperSize} preview />
          </div>
        </div>

        {/* Action panel */}
        <aside className="space-y-4 rounded-xl border border-border bg-card/60 p-5 shadow-card backdrop-blur lg:sticky lg:top-6 lg:self-start">
          <header className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground">Order</div>
              <div className="font-display text-2xl">{data.orderNo}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <StatusBadge status={orderStatus} />
              <PaymentBadge status={paymentStatus} />
            </div>
          </header>

          {cancelled && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              This order is {orderStatus}. New payments and prints are blocked.
            </div>
          )}

          {!cancelled && paymentStatus !== "paid" && paymentStatus !== "refunded" && (
            <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding</span>
                <span className="font-mono text-base text-primary">
                  {formatMoney(remaining, data.currencySymbol)}
                </span>
              </div>
            </div>
          )}

          {/* Print actions */}
          <div className="space-y-2">
            <SectionLabel>Print</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => doPrint("kot")}
                disabled={cancelled || printingKind !== null}
              >
                {printingKind === "kot" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ChefHat className="mr-2 h-4 w-4" />
                )}{" "}
                KOT
                <PrintCount n={order.kot_print_count} />
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => doPrint("bill")}
                disabled={cancelled || paymentStatus === "paid" || printingKind !== null}
                title={
                  cancelled
                    ? "Order cancelled"
                    : paymentStatus === "paid"
                      ? "Order already paid"
                      : "Print unpaid bill"
                }
              >
                {printingKind === "bill" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ReceiptText className="mr-2 h-4 w-4" />
                )}{" "}
                Bill
                <PrintCount n={order.bill_print_count} />
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => doPrint("receipt")}
                disabled={cancelled || paymentStatus !== "paid" || printingKind !== null}
                title={
                  cancelled
                    ? "Order cancelled"
                    : paymentStatus !== "paid"
                      ? "Take payment first"
                      : "Print final receipt"
                }
              >
                {printingKind === "receipt" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-2 h-4 w-4" />
                )}{" "}
                Receipt
                <PrintCount n={order.receipt_print_count} />
              </Button>
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => doPrint(paymentStatus === "paid" ? "receipt" : "bill")}
                disabled={cancelled || printingKind !== null}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reprint
              </Button>
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2">
            <SectionLabel>Payment</SectionLabel>
            {cancelled ? (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <Ban className="h-4 w-4" />
                Payment disabled for cancelled orders
              </div>
            ) : paymentStatus === "paid" ? (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Fully paid · {data.payments.length} payment{data.payments.length === 1 ? "" : "s"}
              </div>
            ) : (
              <TakePaymentDialog
                orderId={orderId}
                grandTotal={data.grandTotal}
                remaining={remaining}
                currencySymbol={data.currencySymbol}
                onPaid={() => {
                  void refreshOrderState();
                }}
              />
            )}
          </div>

          {manager && (
            <div className="space-y-2">
              <SectionLabel>Order control</SectionLabel>
              {canUpdateFulfillment && (
                <FulfillmentStatusControls
                  orderStatus={orderStatus}
                  orderNo={data.orderNo}
                  onChange={async (nextStatus) => {
                    await runRpc("update_order_status", {
                      _order_id: orderId,
                      _status: nextStatus,
                    });
                    toast.success(`Order marked ${statusLabel(nextStatus).toLowerCase()}`);
                    await refreshOrderState();
                  }}
                />
              )}
              {!cancelled && paymentStatus !== "refunded" && (
                <AdjustDiscountDialog
                  orderId={orderId}
                  subtotal={Number(order.subtotal)}
                  currentDiscount={Number(order.discount_total)}
                  currentTotal={Number(order.grand_total)}
                  amountPaid={Number(order.amount_paid)}
                  currencySymbol={data.currencySymbol}
                  onAdjusted={refreshOrderState}
                />
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => nav({ to: "/pos", search: { editOrderId: orderId } })}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Order
                </Button>
              )}
              {canCancel && (
                <OrderReasonActionDialog
                  title={`Cancel ${data.orderNo}`}
                  description="Marks this unpaid order as cancelled and restores any stock deducted for it."
                  buttonLabel="Cancel Order"
                  confirmLabel="Cancel order"
                  icon={<Ban className="mr-2 h-4 w-4" />}
                  variant="destructive"
                  reasonPlaceholder="e.g. customer left before payment"
                  onSubmit={async (reason) => {
                    await runRpc("cancel_order", {
                      _order_id: orderId,
                      _reason: reason,
                    });
                  }}
                  onDone={refreshOrderState}
                  successMessage="Order cancelled and inventory restored"
                />
              )}
              {canVoid && (
                <VoidOrderDialog
                  orderId={orderId}
                  orderNo={data.orderNo}
                  amountPaid={Number(order.amount_paid)}
                  currencySymbol={data.currencySymbol}
                  onDone={refreshOrderState}
                />
              )}
              {canRefund && (
                <RefundOrderDialog
                  orderId={orderId}
                  orderNo={data.orderNo}
                  amountPaid={Number(order.amount_paid)}
                  currencySymbol={data.currencySymbol}
                  onDone={refreshOrderState}
                />
              )}
              {canReopen && (
                <OrderReasonActionDialog
                  title={`Reopen ${data.orderNo}`}
                  description="Moves this completed order back to served so staff can continue operational handling. Payments remain recorded."
                  buttonLabel="Reopen Order"
                  confirmLabel="Reopen order"
                  icon={<RotateCcw className="mr-2 h-4 w-4" />}
                  reasonPlaceholder="e.g. completed by mistake"
                  onSubmit={async (reason) => {
                    await runRpc("reopen_order", {
                      _order_id: orderId,
                      _reason: reason,
                    });
                  }}
                  onDone={refreshOrderState}
                  successMessage="Order reopened"
                />
              )}
              {canDelete && (
                <OrderReasonActionDialog
                  title={`Permanently delete ${data.orderNo}`}
                  description="Owner/admin only. This removes the terminal order and cascades its line items and payments after ensuring inventory has no remaining net impact."
                  buttonLabel="Delete Order"
                  confirmLabel="Delete permanently"
                  icon={<Trash2 className="mr-2 h-4 w-4" />}
                  variant="destructive"
                  reasonPlaceholder="e.g. test order created during setup"
                  onSubmit={async (reason) => {
                    await runRpc("delete_order_admin", {
                      _order_id: orderId,
                      _reason: reason,
                    });
                  }}
                  onDone={async () => {
                    await refreshOrderState();
                    nav({ to: "/orders" });
                  }}
                  successMessage="Order permanently deleted"
                />
              )}
            </div>
          )}

          <Button variant="ghost" onClick={() => nav({ to: "/pos" })} className="w-full">
            <ArrowLeft className="mr-2 h-4 w-4" /> New Order
          </Button>

          <Link
            to="/pos"
            className="block text-center text-xs text-muted-foreground hover:text-primary"
          >
            ← Back to POS
          </Link>
        </aside>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-muted-foreground">{children}</div>;
}

function PrintCount({ n }: { n?: number }) {
  if (!n || n <= 0) return null;
  return <span className="ml-auto text-[10px] font-mono text-muted-foreground">×{n}</span>;
}

function labelForKind(k: "kot" | "bill" | "receipt") {
  return k === "kot" ? "Kitchen ticket" : k === "bill" ? "Bill" : "Receipt";
}

function parseOrderNotes(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { address: "", notes: "" };

  const lines = raw.split(/\r?\n/);
  const addressLine = lines.find((line) => /^(delivery\s+address|address):/i.test(line));
  const notesLine = lines.find((line) => /^notes:/i.test(line));
  if (addressLine || notesLine) {
    return {
      address: addressLine?.replace(/^(delivery\s+address|address):\s*/i, "").trim() ?? "",
      notes: notesLine?.replace(/^notes:\s*/i, "").trim() ?? "",
    };
  }

  return { address: "", notes: raw };
}

const FULFILLMENT_STATUSES: OrderStatus[] = [
  "placed",
  "preparing",
  "ready",
  "served",
  "completed",
];

function FulfillmentStatusControls(props: {
  orderStatus: OrderStatus;
  orderNo: string;
  onChange: (status: OrderStatus) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState<OrderStatus | null>(null);

  async function setStatus(status: OrderStatus) {
    if (status === props.orderStatus || submitting) return;
    setSubmitting(status);
    try {
      await props.onChange(status);
    } catch (err: unknown) {
      toast.error(errorMessage(err, `Failed to update ${props.orderNo}`));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {FULFILLMENT_STATUSES.map((status) => {
        const active = status === props.orderStatus;
        return (
          <Button
            key={status}
            type="button"
            variant={active ? "default" : "outline"}
            className="justify-start"
            disabled={active || submitting !== null}
            onClick={() => void setStatus(status)}
          >
            {submitting === status ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : status === "completed" ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <ChefHat className="mr-2 h-4 w-4" />
            )}
            {statusLabel(status)}
          </Button>
        );
      })}
    </div>
  );
}

function statusLabel(status: OrderStatus) {
  const map: Record<OrderStatus, string> = {
    open: "Open",
    placed: "Placed",
    preparing: "Preparing",
    ready: "Ready",
    served: "Served",
    completed: "Completed",
    cancelled: "Cancelled",
    voided: "Voided",
    refunded: "Refunded",
  };
  return map[status] ?? "Open";
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { cls: string; label: string }> = {
    open: { cls: "bg-muted text-muted-foreground border-border", label: "Open" },
    placed: { cls: "bg-primary/15 text-primary border-primary/30", label: "Placed" },
    preparing: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "Preparing" },
    ready: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Ready" },
    served: { cls: "bg-success/15 text-success border-success/30", label: "Served" },
    completed: { cls: "bg-success/15 text-success border-success/30", label: "Completed" },
    cancelled: {
      cls: "bg-destructive/15 text-destructive border-destructive/30",
      label: "Cancelled",
    },
    voided: { cls: "bg-destructive/15 text-destructive border-destructive/30", label: "Voided" },
    refunded: { cls: "bg-muted text-muted-foreground border-border", label: "Refunded" },
  };
  const m = map[status] ?? map.open;
  return (
    <Badge variant="outline" className={`${m.cls} font-medium`}>
      {m.label}
    </Badge>
  );
}

function PaymentBadge({ status }: { status: "pending" | "partial" | "paid" | "refunded" }) {
  const map: Record<typeof status, { cls: string; label: string }> = {
    pending: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Unpaid" },
    partial: { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30", label: "Partial" },
    paid: { cls: "bg-success/15 text-success border-success/30", label: "Paid" },
    refunded: { cls: "bg-muted text-muted-foreground border-border", label: "Refunded" },
  };
  const m = map[status];
  return (
    <Badge variant="outline" className={`${m.cls} font-medium`}>
      {m.label}
    </Badge>
  );
}

function AdjustDiscountDialog(props: {
  orderId: string;
  subtotal: number;
  currentDiscount: number;
  currentTotal: number;
  amountPaid: number;
  currencySymbol: string;
  onAdjusted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [discount, setDiscount] = useState(props.currentDiscount.toFixed(2));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nextDiscount = Math.max(0, Math.min(props.subtotal, Number(discount) || 0));
  const estimatedTotal = Math.max(0, props.currentTotal - (nextDiscount - props.currentDiscount));

  async function submit() {
    if (!reason.trim()) {
      toast.error("Enter a reason for the discount correction");
      return;
    }
    setSubmitting(true);
    try {
      await runRpc("adjust_order_discount", {
        _order_id: props.orderId,
        _discount: nextDiscount,
        _reason: reason.trim(),
      });
      toast.success("Discount adjusted");
      setOpen(false);
      props.onAdjusted();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to adjust discount"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDiscount(props.currentDiscount.toFixed(2));
          setReason("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <Percent className="mr-2 h-4 w-4" />
          Adjust Discount
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust discount</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono">{formatMoney(props.subtotal, props.currencySymbol)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current total</span>
              <span className="font-mono">
                {formatMoney(props.currentTotal, props.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount paid</span>
              <span className="font-mono">
                {formatMoney(props.amountPaid, props.currencySymbol)}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Estimated total</span>
              <span className="font-mono text-primary">
                {formatMoney(estimatedTotal, props.currencySymbol)}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Final tax and payment status are recalculated by the database.
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>New discount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. discount missed before payment"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderReasonActionDialog(props: {
  title: string;
  description: string;
  buttonLabel: string;
  confirmLabel: string;
  icon: ReactNode;
  reasonPlaceholder: string;
  successMessage: string;
  onSubmit: (reason: string) => Promise<void>;
  onDone: () => Promise<void> | void;
  variant?: "default" | "destructive" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const reasonClean = reason.trim();
    if (!reasonClean) {
      toast.error("Enter a reason");
      return;
    }
    setSubmitting(true);
    try {
      await props.onSubmit(reasonClean);
      toast.success(props.successMessage);
      setOpen(false);
      setReason("");
      await props.onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Order operation failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant={props.variant ?? "outline"} className="w-full justify-start">
          {props.icon}
          {props.buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
            {props.description}
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={props.reasonPlaceholder}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Back
          </Button>
          <Button
            variant={props.variant === "destructive" ? "destructive" : "default"}
            onClick={submit}
            disabled={submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidOrderDialog(props: {
  orderId: string;
  orderNo: string;
  amountPaid: number;
  currencySymbol: string;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hasPayment = props.amountPaid > 0;

  async function submit() {
    const reasonClean = reason.trim();
    if (!reasonClean) {
      toast.error("Enter a reason");
      return;
    }
    setSubmitting(true);
    try {
      await runRpc("void_order", {
        _order_id: props.orderId,
        _reason: reasonClean,
        _refund_paid: true,
        _method: method,
        _reference: reference || null,
      });
      toast.success(hasPayment ? "Order voided and payment reversed" : "Order voided");
      setOpen(false);
      setReason("");
      setReference("");
      await props.onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to void order"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="w-full justify-start">
          <Ban className="mr-2 h-4 w-4" />
          Void Order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {props.orderNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Voiding marks the order as a mistake, restores inventory, and records an audit entry.
            {hasPayment
              ? ` A payment reversal of ${formatMoney(props.amountPaid, props.currencySymbol)} will be added.`
              : ""}
          </div>
          {hasPayment && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Reversal method</Label>
                <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reference</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. wrong order paid by mistake"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Back
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Void order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundOrderDialog(props: {
  orderId: string;
  orderNo: string;
  amountPaid: number;
  currencySymbol: string;
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(props.amountPaid.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [restoreInventory, setRestoreInventory] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const refundAmount = Number(amount);
    const reasonClean = reason.trim();
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      toast.error("Enter a valid refund amount");
      return;
    }
    if (refundAmount > props.amountPaid) {
      toast.error("Refund cannot exceed amount paid");
      return;
    }
    if (!reasonClean) {
      toast.error("Enter a reason");
      return;
    }
    setSubmitting(true);
    try {
      await runRpc("refund_order", {
        _order_id: props.orderId,
        _amount: refundAmount,
        _method: method,
        _reason: reasonClean,
        _restore_inventory: restoreInventory,
        _reference: reference || null,
      });
      toast.success("Refund recorded");
      setOpen(false);
      setReason("");
      setReference("");
      await props.onDone();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to refund order"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setAmount(props.amountPaid.toFixed(2));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-start">
          <CreditCard className="mr-2 h-4 w-4" />
          Refund Order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {props.orderNo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Refundable</span>
              <span className="font-mono">
                {formatMoney(props.amountPaid, props.currencySymbol)}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="wallet">Wallet</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm">
            <Checkbox
              checked={restoreInventory}
              onCheckedChange={(checked) => setRestoreInventory(checked === true)}
            />
            <span>
              Restore inventory on full refund
              <span className="block text-xs text-muted-foreground">
                Keep enabled when the order was cancelled before fulfilment. Turn off for goodwill
                refunds after food was served.
              </span>
            </span>
          </label>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. customer refund after wrong charge"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Back
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TakePaymentDialog(props: {
  orderId: string;
  grandTotal: number;
  remaining: number;
  currencySymbol: string;
  onPaid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(props.remaining.toFixed(2));
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      await runRpc("record_payment", {
        _order_id: props.orderId,
        _method: method,
        _amount: amt,
        _reference: reference || null,
      });
      toast.success(`Payment of ${props.currencySymbol}${amt.toFixed(2)} recorded`);
      setOpen(false);
      props.onPaid();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Failed to record payment"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setAmount(props.remaining.toFixed(2));
      }}
    >
      <DialogTrigger asChild>
        <Button size="lg" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
          <CreditCard className="mr-2 h-4 w-4" /> Take Payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Grand total</span>
              <span className="font-mono">
                {props.currencySymbol}
                {props.grandTotal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Outstanding</span>
              <span className="font-mono text-primary">
                {props.currencySymbol}
                {props.remaining.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="wallet">Wallet</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono text-lg"
            />
            {Number(amount) > props.remaining && (
              <p className="flex items-center gap-1 text-xs text-amber-400">
                <AlertCircle className="h-3 w-3" /> Change due: {props.currencySymbol}
                {(Number(amount) - props.remaining).toFixed(2)}
              </p>
            )}
          </div>
          {(method === "card" || method === "upi" || method === "wallet" || method === "other") && (
            <div className="space-y-1.5">
              <Label>Reference (optional)</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Txn ID / approval code"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuccessRibbon({
  orderNo,
  total,
  symbol,
}: {
  orderNo: string;
  total: number;
  symbol: string;
}) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 3500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center transition-all duration-500 ${show ? "translate-y-4 opacity-100" : "-translate-y-6 opacity-0"}`}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-success/30 bg-success/15 px-5 py-2.5 text-success-foreground shadow-ember backdrop-blur">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <span className="text-sm">
          Order <span className="font-mono font-semibold">{orderNo}</span> placed · sent to kitchen
          ·{" "}
          <span className="font-mono">
            {symbol}
            {total.toFixed(2)}
          </span>
        </span>
        <Flame className="h-4 w-4 text-primary" />
      </div>
    </div>
  );
}
