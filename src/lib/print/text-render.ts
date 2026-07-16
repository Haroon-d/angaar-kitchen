import { formatDate } from "@/lib/format";
import type { ReceiptData } from "./types";

const DEFAULT_ADDRESS = "GT Road Near Punjab College Kamoke";
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

  const center = (s: string) => centerText(s, width);
  const row = (l: string, r: string) => {
    const right = r.trim();
    const leftMax = Math.max(8, width - right.length - 1);
    const left = l.length > leftMax ? l.slice(0, leftMax) : l;
    const space = Math.max(1, width - left.length - r.length);
    return left + " ".repeat(space) + r;
  };
  const addCentered = (value: string) => wrapText(value, width).forEach((line) => lines.push(center(line)));
  const addMeta = (label: string, value: string | null | undefined) => {
    const clean = cleanText(value);
    if (!clean) return;
    const labelText = `${label}:`;
    const labelWidth = Math.min(10, Math.max(6, labelText.length));
    const valueWidth = width - labelWidth - 1;
    const wrapped = wrapText(clean, valueWidth);
    wrapped.forEach((line, index) => {
      lines.push(`${index === 0 ? labelText.padEnd(labelWidth) : " ".repeat(labelWidth)} ${line}`);
    });
  };
  const fmt = (n: number) => `${sym}${n.toFixed(2)}`;
  const itemCount = data.items.reduce((n, item) => n + item.qty, 0);
  const brandLines = splitBrandName(data.brandName);
  const legalName = isSameText(data.legalName, data.brandName) ? null : data.legalName;
  const receiptAddress = receiptLocation(data.address);
  const receiptPhone = cleanText(data.phone) || DEFAULT_PHONE;

  lines.push(center("ANGAAR"));
  lines.push(center(spacedText(brandLines.bottom.toUpperCase())));
  if (legalName) addCentered(legalName);
  addCentered(receiptAddress);
  addCentered(`Tel: ${receiptPhone}`);
  if (data.taxId) addCentered(`Tax ID: ${data.taxId}`);
  lines.push(dbl);
  lines.push(center(`[ ${data.diningType.replace("_", " ").toUpperCase()} ]`));
  addMeta("Order", data.orderNo);
  addMeta("Date", formatDate(data.createdAt));
  addMeta("Table", data.tableLabel);
  addMeta("Cashier", data.cashierName);
  addMeta("Customer", data.customerName);
  addMeta("Phone", data.customerPhone);
  addMeta("Address", data.customerAddress);
  addMeta("Notes", data.orderNotes);
  lines.push(rule);
  lines.push(center(`${itemCount} ITEM${itemCount === 1 ? "" : "S"}`));
  lines.push(rule);

  for (const it of data.items) {
    addItem(lines, {
      width,
      qty: it.qty,
      name: it.name,
      total: fmt(it.line_total),
      unit: fmt(it.unit_price),
    });
    for (const addon of it.addons ?? []) {
      addWrappedLine(lines, `  + ${addon.name} (${fmt(addon.price)})`, width);
    }
    if (it.notes) addWrappedLine(lines, `  Note: ${it.notes}`, width);
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
  addCentered(data.footerNote ?? "Thank you for dining with Angaar Kitchen");
  addCentered("Please keep this receipt");

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

function centerText(value: string, width: number) {
  const text = value.slice(0, width);
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return " ".repeat(pad) + text;
}

function wrapText(value: string, width: number) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function spacedText(value: string) {
  return value.split("").join(" ");
}

function addWrappedLine(lines: string[], value: string, width: number) {
  wrapText(value, width).forEach((line) => lines.push(line));
}

function addItem(
  lines: string[],
  input: { width: number; qty: number; name: string; total: string; unit: string },
) {
  const prefix = `${input.qty}x `;
  const amount = input.total;
  const nameWidth = Math.max(8, input.width - prefix.length - amount.length - 1);
  const wrappedName = wrapText(input.name, nameWidth);
  const firstName = wrappedName[0] ?? input.name.slice(0, nameWidth);
  const left = `${prefix}${firstName}`;
  lines.push(left + " ".repeat(Math.max(1, input.width - left.length - amount.length)) + amount);
  for (const line of wrappedName.slice(1)) lines.push(" ".repeat(prefix.length) + line);
  lines.push(`   @ ${input.unit}`);
}
