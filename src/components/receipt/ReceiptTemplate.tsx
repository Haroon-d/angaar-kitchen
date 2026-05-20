import type { PaperSize, ReceiptData } from "@/lib/print/types";
import { formatMoney, formatDate } from "@/lib/format";

const DINING_LABEL: Record<ReceiptData["diningType"], string> = {
  dine_in: "DINE IN",
  takeaway: "TAKEAWAY",
  delivery: "DELIVERY",
};

type Props = {
  data: ReceiptData;
  paperSize?: PaperSize;
  /** When true, applies the white-paper card styling for the on-screen preview. */
  preview?: boolean;
};

/**
 * Realistic thermal receipt template. Pure HTML — re-used by:
 *   • on-screen preview (preview=true)
 *   • print iframe (renderToStaticMarkup → BrowserPrintDriver wraps with @page CSS)
 *   • PDF generator references the same data shape
 */
export function ReceiptTemplate({ data, paperSize = "80mm", preview = false }: Props) {
  const widthMm = paperSize === "58mm" ? 58 : 80;
  const sym = data.currencySymbol;

  const wrapStyle: React.CSSProperties = preview
    ? {
        width: `${widthMm}mm`,
        margin: "0 auto",
        background: "#fff",
        color: "#000",
        padding: "6mm 4mm",
        boxShadow: "0 30px 60px -20px rgba(0,0,0,.6), 0 10px 20px -10px rgba(0,0,0,.4)",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        fontSize: paperSize === "58mm" ? 11 : 12,
        lineHeight: 1.45,
      }
    : { padding: 0 };

  return (
    <div style={wrapStyle}>
      {/* HEADER */}
      <div style={{ textAlign: "center" }}>
        {data.logoUrl ? (
          <img
            src={data.logoUrl}
            alt=""
            style={{ width: 36, height: 36, objectFit: "contain", margin: "0 auto 4px" }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "#000",
              color: "#fff",
              margin: "0 auto 4px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            🔥
          </div>
        )}
        <div
          className="ak-r-h1"
          style={{
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontWeight: 700,
            fontSize: paperSize === "58mm" ? 16 : 18,
            letterSpacing: ".5px",
          }}
        >
          {data.brandName}
        </div>
        {data.legalName && <div style={{ fontSize: 10, color: "#444" }}>{data.legalName}</div>}
        {data.address && <div style={{ fontSize: 10, color: "#444" }}>{data.address}</div>}
        {data.phone && <div style={{ fontSize: 10, color: "#444" }}>Tel: {data.phone}</div>}
        {data.taxId && <div style={{ fontSize: 10, color: "#444" }}>Tax ID: {data.taxId}</div>}
      </div>

      <Rule />

      {/* ORDER META */}
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <span
          style={{
            display: "inline-block",
            border: "1px solid #000",
            padding: "2px 8px",
            borderRadius: 3,
            fontWeight: 700,
            letterSpacing: 1,
            fontSize: 10,
          }}
        >
          {DINING_LABEL[data.diningType]}
        </span>
      </div>
      <KV k="Order #" v={data.orderNo} bold />
      <KV k="Date" v={formatDate(data.createdAt)} />
      {data.tableLabel && <KV k="Table" v={data.tableLabel} />}
      {data.cashierName && <KV k="Cashier" v={data.cashierName} />}
      {data.customerName && <KV k="Customer" v={data.customerName} />}
      {data.customerPhone && <KV k="Phone" v={data.customerPhone} />}
      {data.customerAddress && <KV k="Address" v={data.customerAddress} />}

      <Rule />

      {/* ITEMS */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td style={{ verticalAlign: "top", padding: "2px 0" }}>
                <div style={{ fontWeight: 600 }}>
                  <span style={{ display: "inline-block", minWidth: 22 }}>{it.qty}×</span> {it.name}
                </div>
                <div style={{ fontSize: 10, color: "#555", paddingLeft: 26 }}>
                  @ {formatMoney(it.unit_price, sym)}
                </div>
                {it.addons?.map((a, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: 10,
                      color: "#555",
                      paddingLeft: 26,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>+ {a.name}</span>
                    <span>{formatMoney(a.price, sym)}</span>
                  </div>
                ))}
                {it.notes && (
                  <div
                    style={{ fontSize: 10, fontStyle: "italic", color: "#555", paddingLeft: 26 }}
                  >
                    * {it.notes}
                  </div>
                )}
              </td>
              <td
                style={{
                  verticalAlign: "top",
                  padding: "2px 0",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                }}
              >
                {formatMoney(it.line_total, sym)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Rule />

      {/* TOTALS */}
      <KV k="Subtotal" v={formatMoney(data.subtotal, sym)} />
      {data.discount > 0 && <KV k="Discount" v={`-${formatMoney(data.discount, sym)}`} />}
      {data.taxes.map((t, i) => (
        <KV key={i} k={`${t.name} (${t.rate}%)`} v={formatMoney(t.amount, sym)} />
      ))}
      {data.serviceCharge && data.serviceCharge > 0 && (
        <KV k="Service" v={formatMoney(data.serviceCharge, sym)} />
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 0 2px",
          borderTop: "2px solid #000",
          marginTop: 4,
          fontWeight: 700,
          fontSize: paperSize === "58mm" ? 14 : 16,
        }}
      >
        <span>TOTAL</span>
        <span>{formatMoney(data.grandTotal, sym)}</span>
      </div>

      {/* PAYMENTS */}
      {data.payments.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {data.payments.map((p, i) => {
            const isRefund = p.amount < 0 || p.kind === "refund" || p.kind === "void_adjustment";
            return (
              <KV
                key={i}
                k={`${isRefund ? "Refund" : "Paid"} · ${p.method.toUpperCase()}`}
                v={formatMoney(p.amount, sym)}
              />
            );
          })}
          {data.amountReceived !== undefined && data.amountReceived > 0 && (
            <KV k="Received" v={formatMoney(data.amountReceived, sym)} />
          )}
          {data.changeReturned !== undefined && data.changeReturned > 0 && (
            <KV k="Change" v={formatMoney(data.changeReturned, sym)} />
          )}
        </div>
      )}

      <Rule />

      <div style={{ textAlign: "center", fontSize: 10, color: "#444" }}>
        {data.footerNote ?? "Thank you for your visit!"}
      </div>
      <div style={{ textAlign: "center", fontSize: 9, color: "#888", marginTop: 4 }}>
        Powered by Angaar Kitchen POS
      </div>
    </div>
  );
}

function Rule() {
  return <hr style={{ border: "none", borderTop: "1px dashed #555", margin: "6px 0" }} />;
}
function KV({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 6,
        fontWeight: bold ? 700 : 400,
        fontSize: 11,
      }}
    >
      <span>{k}</span>
      <span style={{ whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}
