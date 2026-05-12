import jsPDF from "jspdf";
import type { ReceiptData, PaperSize } from "./types";
import { formatMoney, formatDate } from "@/lib/format";

const DINING_LABEL: Record<ReceiptData["diningType"], string> = {
  dine_in: "DINE IN",
  takeaway: "TAKEAWAY",
  delivery: "DELIVERY",
};

/** Generate a thermal-width PDF that mirrors the on-screen receipt. */
export function generateReceiptPdf(data: ReceiptData, paperSize: PaperSize = "80mm"): jsPDF {
  const widthMm = paperSize === "58mm" ? 58 : 80;
  // Estimate height; jsPDF requires fixed height — pick a generous one and trim later.
  const lineCount = data.items.reduce((n, i) => n + 1 + (i.notes ? 1 : 0) + (i.addons?.length ?? 0), 0);
  const heightMm = 70 + lineCount * 6 + data.taxes.length * 4 + data.payments.length * 4;

  const doc = new jsPDF({ unit: "mm", format: [widthMm, heightMm], orientation: "portrait" });
  const sym = data.currencySymbol;
  const padX = 3;
  const innerW = widthMm - padX * 2;
  let y = 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(data.brandName, widthMm / 2, y, { align: "center" });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (data.address) { doc.text(wrap(doc, data.address, innerW), widthMm / 2, y, { align: "center" }); y += 3.5; }
  if (data.phone) { doc.text(`Tel: ${data.phone}`, widthMm / 2, y, { align: "center" }); y += 3.5; }
  if (data.taxId) { doc.text(`Tax ID: ${data.taxId}`, widthMm / 2, y, { align: "center" }); y += 3.5; }

  y += 1.5; dashed(doc, padX, y, widthMm - padX); y += 3;

  // Order info
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(DINING_LABEL[data.diningType], widthMm / 2, y, { align: "center" });
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  kv(doc, padX, y, innerW, "Order #", data.orderNo); y += 3.5;
  kv(doc, padX, y, innerW, "Date", formatDate(data.createdAt)); y += 3.5;
  if (data.tableLabel) { kv(doc, padX, y, innerW, "Table", data.tableLabel); y += 3.5; }
  if (data.cashierName) { kv(doc, padX, y, innerW, "Cashier", data.cashierName); y += 3.5; }
  if (data.customerName) { kv(doc, padX, y, innerW, "Customer", data.customerName); y += 3.5; }
  if (data.customerPhone) { kv(doc, padX, y, innerW, "Phone", data.customerPhone); y += 3.5; }
  if (data.customerAddress) { kv(doc, padX, y, innerW, "Address", data.customerAddress); y += 3.5; }

  y += 1; dashed(doc, padX, y, widthMm - padX); y += 3;

  // Items
  for (const it of data.items) {
    doc.setFont("helvetica", "bold");
    doc.text(`${it.qty} × ${truncate(it.name, paperSize === "58mm" ? 18 : 24)}`, padX, y);
    doc.text(formatMoney(it.line_total, sym), widthMm - padX, y, { align: "right" });
    y += 3.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(`@ ${formatMoney(it.unit_price, sym)}`, padX + 3, y);
    y += 3;
    if (it.addons?.length) {
      for (const a of it.addons) {
        doc.text(`+ ${a.name}`, padX + 3, y);
        doc.text(formatMoney(a.price, sym), widthMm - padX, y, { align: "right" });
        y += 3;
      }
    }
    if (it.notes) {
      doc.setFont("helvetica", "italic");
      doc.text(`Note: ${it.notes}`, padX + 3, y);
      doc.setFont("helvetica", "normal");
      y += 3;
    }
    doc.setFontSize(8);
  }

  y += 1; dashed(doc, padX, y, widthMm - padX); y += 3;

  // Totals
  kv(doc, padX, y, innerW, "Subtotal", formatMoney(data.subtotal, sym)); y += 3.5;
  if (data.discount > 0) { kv(doc, padX, y, innerW, "Discount", `-${formatMoney(data.discount, sym)}`); y += 3.5; }
  for (const t of data.taxes) {
    kv(doc, padX, y, innerW, `${t.name} (${t.rate}%)`, formatMoney(t.amount, sym)); y += 3.5;
  }
  if (data.serviceCharge && data.serviceCharge > 0) { kv(doc, padX, y, innerW, "Service", formatMoney(data.serviceCharge, sym)); y += 3.5; }

  y += 1.5;
  doc.setLineWidth(0.4);
  doc.line(padX, y, widthMm - padX, y);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL", padX, y);
  doc.text(formatMoney(data.grandTotal, sym), widthMm - padX, y, { align: "right" });
  y += 5;

  // Payments
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const p of data.payments) {
    kv(doc, padX, y, innerW, `Paid · ${p.method}`, formatMoney(p.amount, sym)); y += 3.5;
  }
  if (data.amountReceived !== undefined && data.amountReceived > 0) {
    kv(doc, padX, y, innerW, "Received", formatMoney(data.amountReceived, sym)); y += 3.5;
  }
  if (data.changeReturned !== undefined && data.changeReturned > 0) {
    kv(doc, padX, y, innerW, "Change", formatMoney(data.changeReturned, sym)); y += 3.5;
  }

  y += 2; dashed(doc, padX, y, widthMm - padX); y += 4;
  doc.setFontSize(8);
  doc.text(wrap(doc, data.footerNote ?? "Thank you!", innerW), widthMm / 2, y, { align: "center" });
  y += 6;
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text("Powered by Angaar Kitchen POS", widthMm / 2, y, { align: "center" });

  return doc;
}

function dashed(doc: jsPDF, x1: number, y: number, x2: number) {
  doc.setLineDashPattern([0.6, 0.6], 0);
  doc.setLineWidth(0.2);
  doc.line(x1, y, x2, y);
  doc.setLineDashPattern([], 0);
}
function kv(doc: jsPDF, x: number, y: number, w: number, k: string, v: string) {
  doc.text(k, x, y);
  doc.text(v, x + w, y, { align: "right" });
}
function wrap(doc: jsPDF, text: string, w: number): string[] {
  return doc.splitTextToSize(text, w) as string[];
}
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export function downloadReceiptPdf(data: ReceiptData, paperSize: PaperSize = "80mm") {
  const doc = generateReceiptPdf(data, paperSize);
  doc.save(`receipt-${data.orderNo}.pdf`);
}
