import type { ReceiptData } from "./types";

const DEFAULT_ADDRESS = "Grand Trunk Rd, near Punjab College, Pak Town, Kamoke, 52470";
const DEFAULT_PHONE = "0335 7200955";

/**
 * Render a ReceiptData object to a plain monospace text body that any
 * 80mm/58mm ESC/POS thermal printer can render via `printToNetworkPrinter`.
 */
export function renderReceiptText(data: ReceiptData, width = 42): string {
  const sym = data.currencySymbol;
  const lines: string[] = [];
  const rule = "-".repeat(width);
  const dbl = "=".repeat(width);

  const center = (s: string) => {
    const t = s.slice(0, width);
    const pad = Math.max(0, Math.floor((width - t.length) / 2));
    return " ".repeat(pad) + t;
  };
  const row = (l: string, r: string) => {
    const left = l.length > width - r.length - 1 ? l.slice(0, width - r.length - 1) : l;
    const space = Math.max(1, width - left.length - r.length);
    return left + " ".repeat(space) + r;
  };
  const fmt = (n: number) => `${sym}${n.toFixed(2)}`;
  const itemCount = data.items.reduce((n, item) => n + item.qty, 0);
  const brandLines = splitBrandName(data.brandName);
  const legalName = isSameText(data.legalName, data.brandName) ? null : data.legalName;
  const receiptAddress = receiptLocation(data.address);
  const receiptPhone = cleanText(data.phone) || DEFAULT_PHONE;

  lines.push(center(brandLines.top.toUpperCase()));
  lines.push(center(brandLines.bottom.toUpperCase()));
  if (legalName) lines.push(center(legalName));
  lines.push(center(receiptAddress));
  lines.push(center(`Tel: ${receiptPhone}`));
  if (data.taxId) lines.push(center(`Tax ID: ${data.taxId}`));
  lines.push(dbl);
  lines.push(center(data.diningType.replace("_", " ").toUpperCase()));
  lines.push(row("Order No.", data.orderNo));
  lines.push(row("Date", new Date(data.createdAt).toLocaleString()));
  if (data.tableLabel) lines.push(row("Table", data.tableLabel));
  if (data.cashierName) lines.push(row("Cashier", data.cashierName));
  if (data.customerName) lines.push(row("Customer", data.customerName));
  if (data.customerPhone) lines.push(row("Phone", data.customerPhone));
  if (data.customerAddress) lines.push(row("Address", data.customerAddress));
  if (data.orderNotes) lines.push(row("Notes", data.orderNotes));
  lines.push(rule);
  lines.push(center(`${itemCount} ITEM${itemCount === 1 ? "" : "S"}`));
  lines.push(rule);

  for (const it of data.items) {
    lines.push(row(`${it.qty}x ${it.name}`, fmt(it.line_total)));
    lines.push(row(`   @ ${fmt(it.unit_price)}`, ""));
    for (const a of it.addons ?? []) lines.push(row(`   + ${a.name}`, fmt(a.price)));
    if (it.notes) lines.push(`   Note: ${it.notes}`);
  }

  lines.push(rule);
  lines.push(row("Subtotal", fmt(data.subtotal)));
  if (data.discount > 0) lines.push(row("Discount", "-" + fmt(data.discount)));
  for (const t of data.taxes.filter((tax) => tax.amount > 0)) {
    lines.push(row(`${t.name} (${t.rate}%)`, fmt(t.amount)));
  }
  if (data.deliveryFee && data.deliveryFee > 0)
    lines.push(row("Delivery fee", fmt(data.deliveryFee)));
  if (data.serviceCharge && data.serviceCharge > 0)
    lines.push(row("Service", fmt(data.serviceCharge)));
  lines.push(dbl);
  lines.push(row("TOTAL", fmt(data.grandTotal)));
  lines.push(dbl);

  for (const p of data.payments) {
    const label =
      p.amount < 0 || p.kind === "refund" || p.kind === "void_adjustment" ? "Refund" : "Paid";
    lines.push(row(`${label} - ${p.method.toUpperCase()}`, fmt(p.amount)));
  }
  if (data.amountReceived !== undefined && data.amountReceived > 0)
    lines.push(row("Received", fmt(data.amountReceived)));
  if (data.changeReturned !== undefined && data.changeReturned > 0)
    lines.push(row("Change", fmt(data.changeReturned)));

  lines.push(rule);
  lines.push(center(data.footerNote ?? "Thank you for dining with us."));
  lines.push(center("Please keep this receipt"));

  return lines.join("\n") + "\n";
}

export function renderKotText(data: ReceiptData, width = 42): string {
  const lines: string[] = [];
  const rule = "=".repeat(width);
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((width - s.length) / 2));
    return " ".repeat(pad) + s;
  };

  lines.push(center("** KITCHEN TICKET **"));
  lines.push(rule);
  lines.push(
    `${data.diningType.replace("_", " ").toUpperCase()}   ${data.tableLabel ? "T:" + data.tableLabel : ""}`,
  );
  lines.push(`#${data.orderNo}   ${new Date(data.createdAt).toLocaleTimeString()}`);
  if (data.customerName) lines.push(`Cust: ${data.customerName}`);
  if (data.orderNotes) lines.push(`Note: ${data.orderNotes}`);
  lines.push("-".repeat(width));
  for (const it of data.items) {
    lines.push(`${it.qty}x  ${it.name.toUpperCase()}`);
    for (const a of it.addons ?? []) lines.push(`     + ${a.name}`);
    if (it.notes) lines.push(`     >> ${it.notes}`);
  }
  lines.push(rule);
  lines.push(center(`${data.items.reduce((n, i) => n + i.qty, 0)} items`));
  return lines.join("\n") + "\n";
}

function splitBrandName(name: string) {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return {
    top: parts[0] ?? "angaar",
    bottom: parts.slice(1).join(" ") || "kitchen",
  };
}

function cleanText(value: string | null | undefined) {
  return value?.trim() || "";
}

function receiptLocation(value: string | null | undefined) {
  const text = cleanText(value);
  return !text || text.toLowerCase() === "pakistan" ? DEFAULT_ADDRESS : text;
}

function isSameText(left: string | null | undefined, right: string | null | undefined) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}
