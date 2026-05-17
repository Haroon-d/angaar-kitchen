import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { z } from "zod";
import {
  Printer, ArrowLeft, Loader2, CheckCircle2, RotateCcw, Flame, ChefHat,
  ReceiptText, CreditCard, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ReceiptTemplate } from "@/components/receipt/ReceiptTemplate";
import { KotTemplate } from "@/components/receipt/KotTemplate";
import { PrintService } from "@/lib/print/print-service";
import { renderReceiptText, renderKotText } from "@/lib/print/text-render";
import { usePrinterSettings } from "@/lib/print/settings";
import { formatMoney } from "@/lib/format";
import type { ReceiptData } from "@/lib/print/types";

const SearchSchema = z.object({ placed: z.coerce.boolean().optional() });

export const Route = createFileRoute("/_authenticated/receipt/$orderId")({
  validateSearch: (s) => SearchSchema.parse(s),
  component: OrderTicketPage,
});

type PaymentMethod = "cash" | "card" | "upi" | "wallet" | "other";

function OrderTicketPage() {
  const { orderId } = Route.useParams();
  const search = useSearch({ from: Route.id });
  const justPlaced = !!search.placed;
  const { restaurant, branch } = useActiveBranch();
  const { settings } = usePrinterSettings(branch?.id);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [printingKind, setPrintingKind] = useState<null | "kot" | "bill" | "receipt">(null);

  const q = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data: order, error } = await supabase
        .from("orders").select("*").eq("id", orderId).single();
      if (error) throw error;
      const [{ data: items }, { data: taxes }, { data: payments }, { data: profile }] = await Promise.all([
        supabase.from("order_items").select("*").eq("order_id", orderId),
        supabase.from("order_taxes").select("*").eq("order_id", orderId),
        supabase.from("payments").select("*").eq("order_id", orderId).order("paid_at"),
        order.created_by
          ? supabase.from("profiles").select("full_name").eq("id", order.created_by).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return { order, items: items ?? [], taxes: taxes ?? [], payments: payments ?? [], cashier: profile?.full_name ?? null };
    },
  });

  const data: ReceiptData | null = useMemo(() => {
    if (!q.data || !restaurant) return null;
    const { order, items, taxes, payments, cashier } = q.data;
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
      customerAddress: null,
      cashierName: cashier,
      createdAt: order.created_at,
      currencySymbol: restaurant.currency_symbol ?? "₨",
      items: items.map((i: any) => ({
        id: i.id, name: i.name_snapshot, qty: i.qty,
        unit_price: Number(i.unit_price), line_total: Number(i.line_subtotal),
        notes: i.notes,
      })),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount_total),
      taxes: taxes.map((t: any) => ({ name: t.name_snapshot, rate: Number(t.rate_snapshot), amount: Number(t.amount) })),
      grandTotal: Number(order.grand_total),
      payments: payments.map((p: any) => ({ method: p.method, amount: Number(p.amount), reference: p.reference })),
      amountReceived: Number(order.amount_paid),
      changeReturned: Math.max(0, Number(order.amount_paid) - Number(order.grand_total)),
      footerNote: settings.footerNote,
    };
  }, [q.data, restaurant, branch, settings.footerNote, settings.taxId]);

  if (q.isLoading || !data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (q.error) return <div className="p-8 text-center text-destructive">Order not found.</div>;

  const order = q.data!.order as any;
  const paymentStatus = (order.payment_status ?? "pending") as "pending" | "partial" | "paid" | "refunded";
  const remaining = Math.max(0, Number(order.grand_total) - Number(order.amount_paid));

  async function doPrint(kind: "kot" | "bill" | "receipt") {
    if (!data) return;
    if (printingKind) return;
    if (settings.driver === "network") {
      toast.error("Network TCP printing is not supported on Vercel deployments. Switch to QZ Tray in Settings.");
      return;
    }
    setPrintingKind(kind);
    try {
      const driverId = await PrintService.activeDriverId();
      let body: string;
      if (driverId === "network") {
        body = kind === "kot" ? renderKotText(data) : renderReceiptText(data);
      } else if (kind === "kot") {
        body = await renderTicketImageHtml({
          node: <KotTemplate data={data} paperSize={settings.paperSize} />,
          paperSize: settings.paperSize,
          alt: "Kitchen ticket",
          sourceFontSizePx: settings.paperSize === "58mm" ? 13 : 14,
        });
      } else {
        body = await renderTicketImageHtml({
          node: <ReceiptTemplate data={data} paperSize={settings.paperSize} />,
          paperSize: settings.paperSize,
          alt: "Receipt",
          sourceFontSizePx: settings.paperSize === "58mm" ? 11 : 12,
        });
      }
      await PrintService.print({
        html: body,
        kind,
        paperSize: settings.paperSize,
        copies: kind === "kot" ? settings.printKotCopies : 1,
      });
      await (supabase.rpc as any)("record_print", { _order_id: orderId, _kind: kind });
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      toast.success(`${labelForKind(kind)} sent to printer`);
    } catch (err: any) {
      toast.error(err?.message ?? "Print failed");
    } finally {
      setPrintingKind(null);
    }
  }

  return (
    <div className="min-h-screen bg-coal-gradient">
      {justPlaced && (
        <SuccessRibbon orderNo={data.orderNo} total={data.grandTotal} symbol={data.currencySymbol} />
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
            <PaymentBadge status={paymentStatus} />
          </header>

          {paymentStatus !== "paid" && paymentStatus !== "refunded" && (
            <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Outstanding</span>
                <span className="font-mono text-base text-primary">{formatMoney(remaining, data.currencySymbol)}</span>
              </div>
            </div>
          )}

          {/* Print actions */}
          <div className="space-y-2">
            <SectionLabel>Print</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="justify-start" onClick={() => doPrint("kot")}>
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
                disabled={paymentStatus === "paid" || printingKind !== null}
                title={paymentStatus === "paid" ? "Order already paid" : "Print unpaid bill"}
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
                disabled={paymentStatus !== "paid" || printingKind !== null}
                title={paymentStatus !== "paid" ? "Take payment first" : "Print final receipt"}
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
                disabled={printingKind !== null}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Reprint
              </Button>
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2">
            <SectionLabel>Payment</SectionLabel>
            {paymentStatus === "paid" ? (
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
                onPaid={() => qc.invalidateQueries({ queryKey: ["order", orderId] })}
              />
            )}
          </div>

          <Button variant="ghost" onClick={() => nav({ to: "/pos" })} className="w-full">
            <ArrowLeft className="mr-2 h-4 w-4" /> New Order
          </Button>

          <Link to="/pos" className="block text-center text-xs text-muted-foreground hover:text-primary">
            ← Back to POS
          </Link>
        </aside>
      </div>
    </div>
  );
}

async function renderTicketImageHtml({
  node,
  paperSize,
  alt,
  sourceFontSizePx,
}: {
  node: ReactElement;
  paperSize: "58mm" | "80mm";
  alt: string;
  sourceFontSizePx: number;
}) {
  const widthMm = paperSize === "58mm" ? 58 : 80;
  const printableHeightMm = 145;
  const cutterSafeBottomFeedMm = 8;
  const sheetTailFeedMm = 297 - printableHeightMm;
  const source = document.createElement("div");

  source.setAttribute("aria-hidden", "true");
  Object.assign(source.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${widthMm}mm`,
    boxSizing: "border-box",
    background: "#fff",
    color: "#000",
    padding: `4mm 3mm ${cutterSafeBottomFeedMm}mm`,
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    fontSize: `${sourceFontSizePx}px`,
    lineHeight: "1.4",
    pointerEvents: "none",
    zIndex: "2147483647",
  } satisfies Partial<CSSStyleDeclaration>);

  source.innerHTML = PrintService.renderHtml(node);
  document.body.appendChild(source);

  try {
    await document.fonts?.ready;
    await waitForElementImages(source);
    const png = await toPng(source, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      pixelRatio: 1.5,
      skipFonts: true,
    });
    return `<div class="ak-print-sheet" style="display:block;width:${widthMm}mm;height:297mm;overflow:hidden;padding:0 0 ${sheetTailFeedMm}mm;margin:0;text-align:center;"><img class="ak-print-image" src="${png}" alt="${alt}" style="display:block;max-width:${widthMm}mm;max-height:${printableHeightMm}mm;width:auto;height:auto;margin:0 auto;padding:0;object-fit:contain;object-position:top center;" /></div>`;
  } finally {
    source.remove();
  }
}

async function waitForElementImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  }));
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-widest text-muted-foreground">{children}</div>;
}

function PrintCount({ n }: { n?: number }) {
  if (!n || n <= 0) return null;
  return <span className="ml-auto text-[10px] font-mono text-muted-foreground">×{n}</span>;
}

function labelForKind(k: "kot" | "bill" | "receipt") {
  return k === "kot" ? "Kitchen ticket" : k === "bill" ? "Bill" : "Receipt";
}

function PaymentBadge({ status }: { status: "pending" | "partial" | "paid" | "refunded" }) {
  const map: Record<typeof status, { cls: string; label: string }> = {
    pending:  { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Unpaid" },
    partial:  { cls: "bg-blue-500/15 text-blue-300 border-blue-500/30",   label: "Partial" },
    paid:     { cls: "bg-success/15 text-success border-success/30",       label: "Paid" },
    refunded: { cls: "bg-muted text-muted-foreground border-border",       label: "Refunded" },
  };
  const m = map[status];
  return <Badge variant="outline" className={`${m.cls} font-medium`}>{m.label}</Badge>;
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
      const { error } = await (supabase.rpc as any)("record_payment", {
        _order_id: props.orderId,
        _method: method,
        _amount: amt,
        _reference: reference || null,
      });
      if (error) throw error;
      toast.success(`Payment of ${props.currencySymbol}${amt.toFixed(2)} recorded`);
      setOpen(false);
      props.onPaid();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setAmount(props.remaining.toFixed(2)); }}>
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
            <div className="flex justify-between"><span className="text-muted-foreground">Grand total</span><span className="font-mono">{props.currencySymbol}{props.grandTotal.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-mono text-primary">{props.currencySymbol}{props.remaining.toFixed(2)}</span></div>
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v: PaymentMethod) => setMethod(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono text-lg" />
            {Number(amount) > props.remaining && (
              <p className="flex items-center gap-1 text-xs text-amber-400">
                <AlertCircle className="h-3 w-3" /> Change due: {props.currencySymbol}{(Number(amount) - props.remaining).toFixed(2)}
              </p>
            )}
          </div>
          {(method === "card" || method === "upi" || method === "wallet" || method === "other") && (
            <div className="space-y-1.5">
              <Label>Reference (optional)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Txn ID / approval code" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuccessRibbon({ orderNo, total, symbol }: { orderNo: string; total: number; symbol: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 3500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={`pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center transition-all duration-500 ${show ? "translate-y-4 opacity-100" : "-translate-y-6 opacity-0"}`}>
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-success/30 bg-success/15 px-5 py-2.5 text-success-foreground shadow-ember backdrop-blur">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <span className="text-sm">
          Order <span className="font-mono font-semibold">{orderNo}</span> placed · sent to kitchen · <span className="font-mono">{symbol}{total.toFixed(2)}</span>
        </span>
        <Flame className="h-4 w-4 text-primary" />
      </div>
    </div>
  );
}
