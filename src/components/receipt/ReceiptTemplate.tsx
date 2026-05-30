import type { CSSProperties } from "react";
import type { PaperSize, ReceiptData } from "@/lib/print/types";
import { formatMoney, formatDate } from "@/lib/format";

const DINING_LABEL: Record<ReceiptData["diningType"], string> = {
  dine_in: "DINE IN",
  takeaway: "TAKEAWAY",
  delivery: "DELIVERY",
};

const DEFAULT_ADDRESS = "Grand Trunk Rd, near Punjab College, Pak Town, Kamoke, 52470";
const DEFAULT_PHONE = "0335 7200955";

type Props = {
  data: ReceiptData;
  paperSize?: PaperSize;
  /** When true, applies the white-paper card styling for the on-screen preview. */
  preview?: boolean;
};

/**
 * Simple branded thermal receipt template.
 * Designed to stay readable while keeping ink usage modest.
 */
export function ReceiptTemplate({ data, paperSize = "80mm", preview = false }: Props) {
  const compact = paperSize === "58mm";
  const widthMm = compact ? 58 : 80;
  const sym = data.currencySymbol;
  const itemCount = data.items.reduce((total, item) => total + item.qty, 0);
  const paidAmount = data.payments.reduce((total, payment) => total + payment.amount, 0);
  const balanceDue = Math.max(0, data.grandTotal - Math.max(paidAmount, data.amountReceived ?? 0));
  const brandLines = splitBrandName(data.brandName);
  const legalName = isSameText(data.legalName, data.brandName) ? null : data.legalName;
  const receiptAddress = cleanText(data.address) || DEFAULT_ADDRESS;
  const receiptPhone = cleanText(data.phone) || DEFAULT_PHONE;

  const wrapStyle: CSSProperties = {
    width: preview ? `${widthMm}mm` : "100%",
    margin: preview ? "0 auto" : 0,
    background: "#fff",
    color: "#050505",
    padding: preview ? (compact ? "5mm 3.5mm" : "6mm 4.5mm") : 0,
    boxSizing: "border-box",
    boxShadow: preview
      ? "0 28px 55px -24px rgba(0,0,0,.55), 0 8px 18px -12px rgba(0,0,0,.35)"
      : "none",
    borderRadius: preview ? 6 : 0,
    fontFamily:
      "Arial, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: compact ? 10.25 : 11.25,
    lineHeight: 1.33,
  };

  return (
    <div style={wrapStyle}>
      <header style={{ textAlign: "center" }}>
        <BrandHeader top={brandLines.top} bottom={brandLines.bottom} compact={compact} />
        <div style={{ marginTop: 5 }}>
          {legalName && <FineLine>{legalName}</FineLine>}
          <FineLine>{receiptAddress}</FineLine>
          <FineLine>Tel: {receiptPhone}</FineLine>
          {data.taxId && <FineLine>Tax ID: {data.taxId}</FineLine>}
        </div>
      </header>

      <Rule strong />

      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
            marginBottom: 4,
          }}
        >
          <div>
            <div style={{ fontSize: 8, color: "#555", textTransform: "uppercase" }}>Order</div>
            <div style={{ fontSize: compact ? 15 : 17, fontWeight: 900, lineHeight: 1.05 }}>
              {data.orderNo}
            </div>
          </div>
          <div
            style={{
              border: "1px solid #000",
              borderRadius: 999,
              padding: "2px 7px",
              fontSize: compact ? 8 : 9,
              fontWeight: 800,
              letterSpacing: 0.4,
              whiteSpace: "nowrap",
            }}
          >
            {DINING_LABEL[data.diningType]}
          </div>
        </div>
        <MetaRow label="Date" value={formatDate(data.createdAt)} />
        {data.tableLabel && <MetaRow label="Table" value={data.tableLabel} />}
        {data.cashierName && <MetaRow label="Cashier" value={data.cashierName} />}
        {data.customerName && <MetaRow label="Customer" value={data.customerName} />}
        {data.customerPhone && <MetaRow label="Phone" value={data.customerPhone} />}
        {data.customerAddress && <MetaRow label="Address" value={data.customerAddress} />}
        {data.orderNotes && <MetaRow label="Notes" value={data.orderNotes} />}
      </section>

      <Rule />

      <SectionTitle label={`${itemCount} item${itemCount === 1 ? "" : "s"}`} />
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <tbody>
          {data.items.map((item, index) => (
            <tr key={item.id ?? index}>
              <td style={{ padding: "4px 4px 4px 0", verticalAlign: "top", width: "12%" }}>
                <span style={{ fontWeight: 800 }}>{item.qty}x</span>
              </td>
              <td style={{ padding: "4px 4px 4px 0", verticalAlign: "top", width: "58%" }}>
                <div style={{ fontWeight: 700, wordBreak: "break-word" }}>{item.name}</div>
                <div style={{ marginTop: 1, fontSize: compact ? 8 : 8.5, color: "#555" }}>
                  @ {formatMoney(item.unit_price, sym)}
                </div>
                {item.addons?.map((addon, addonIndex) => (
                  <div
                    key={addonIndex}
                    style={{
                      marginTop: 1,
                      fontSize: compact ? 8 : 8.5,
                      color: "#555",
                      wordBreak: "break-word",
                    }}
                  >
                    + {addon.name} ({formatMoney(addon.price, sym)})
                  </div>
                ))}
                {item.notes && (
                  <div style={{ marginTop: 2, fontSize: compact ? 8 : 8.5, fontStyle: "italic" }}>
                    Note: {item.notes}
                  </div>
                )}
              </td>
              <td
                style={{
                  padding: "4px 0 4px 4px",
                  verticalAlign: "top",
                  textAlign: "right",
                  width: "30%",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {formatMoney(item.line_total, sym)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Rule />

      <section>
        <AmountRow label="Subtotal" value={formatMoney(data.subtotal, sym)} />
        {data.discount > 0 && (
          <AmountRow label="Discount" value={`-${formatMoney(data.discount, sym)}`} />
        )}
        {data.taxes.map((tax, index) => (
          <AmountRow
            key={index}
            label={`${tax.name} (${tax.rate}%)`}
            value={formatMoney(tax.amount, sym)}
          />
        ))}
        {data.serviceCharge && data.serviceCharge > 0 && (
          <AmountRow label="Service" value={formatMoney(data.serviceCharge, sym)} />
        )}
        <div
          style={{
            borderTop: "1.5px solid #000",
            borderBottom: "1.5px solid #000",
            marginTop: 6,
            padding: "5px 0",
          }}
        >
          <AmountRow label="TOTAL" value={formatMoney(data.grandTotal, sym)} strong />
        </div>
      </section>

      {data.payments.length > 0 && (
        <>
          <Rule />
          <SectionTitle label="Payment" />
          {data.payments.map((payment, index) => {
            const isRefund =
              payment.amount < 0 || payment.kind === "refund" || payment.kind === "void_adjustment";
            return (
              <AmountRow
                key={index}
                label={`${isRefund ? "Refund" : "Paid"} - ${payment.method.toUpperCase()}`}
                value={formatMoney(payment.amount, sym)}
              />
            );
          })}
          {data.amountReceived !== undefined && data.amountReceived > 0 && (
            <AmountRow label="Received" value={formatMoney(data.amountReceived, sym)} />
          )}
          {data.changeReturned !== undefined && data.changeReturned > 0 && (
            <AmountRow label="Change" value={formatMoney(data.changeReturned, sym)} strong />
          )}
          {balanceDue > 0 && (
            <AmountRow label="Balance Due" value={formatMoney(balanceDue, sym)} strong />
          )}
        </>
      )}

      <Rule strong />

      <footer style={{ textAlign: "center" }}>
        <div style={{ fontSize: compact ? 9 : 10, fontWeight: 700 }}>
          {data.footerNote ?? "Thank you for dining with us."}
        </div>
        <div style={{ marginTop: 4, fontSize: compact ? 7.5 : 8, color: "#555" }}>
          Keep this receipt for your records.
        </div>
        <div
          style={{
            marginTop: 5,
            fontSize: 7.5,
            color: "#777",
            wordBreak: "break-word",
          }}
        >
          Ref: {data.orderId.slice(0, 12)}
        </div>
      </footer>
    </div>
  );
}

function FineLine({ children }: { children: string }) {
  return (
    <div
      style={{
        fontSize: 8.5,
        color: "#444",
        lineHeight: 1.24,
        wordBreak: "break-word",
      }}
    >
      {children}
    </div>
  );
}

function BrandHeader({ top, bottom, compact }: { top: string; bottom: string; compact: boolean }) {
  return (
    <div>
      <div
        aria-hidden="true"
        style={{
          width: compact ? 18 : 22,
          height: compact ? 18 : 22,
          margin: "0 auto 3px",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: compact ? 5 : 6,
            top: compact ? 1 : 2,
            width: compact ? 8 : 10,
            height: compact ? 13 : 15,
            borderRadius: "80% 20% 75% 25%",
            background: "#000",
            transform: "rotate(28deg)",
          }}
        />
        <span
          style={{
            position: "absolute",
            left: compact ? 2 : 3,
            bottom: compact ? 2 : 3,
            width: compact ? 14 : 16,
            height: 2,
            borderRadius: 999,
            background: "#000",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 800,
          fontSize: compact ? 19 : 22,
          lineHeight: 0.95,
          letterSpacing: 0,
          textTransform: "lowercase",
        }}
      >
        {top}
      </div>
      <div
        style={{
          marginTop: 3,
          fontSize: compact ? 9 : 10,
          fontWeight: 700,
          letterSpacing: compact ? 3.2 : 4,
          textTransform: "lowercase",
        }}
      >
        {bottom}
      </div>
    </div>
  );
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

function isSameText(left: string | null | undefined, right: string | null | undefined) {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function Rule({ strong = false }: { strong?: boolean }) {
  return (
    <div
      style={{
        borderTop: strong ? "1.5px solid #000" : "1px dashed #777",
        margin: strong ? "7px 0" : "6px 0",
      }}
    />
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <div
      style={{
        marginBottom: 3,
        fontSize: 8,
        fontWeight: 800,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        color: "#333",
      }}
    >
      {label}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 2,
        fontSize: 9,
      }}
    >
      <span style={{ color: "#555", textTransform: "uppercase", fontSize: 8 }}>{label}</span>
      <span style={{ textAlign: "right", fontWeight: 700, wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function AmountRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        marginTop: strong ? 0 : 3,
        fontSize: strong ? 13 : 10,
        fontWeight: strong ? 900 : 600,
      }}
    >
      <span style={{ wordBreak: "break-word" }}>{label}</span>
      <span style={{ whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}
