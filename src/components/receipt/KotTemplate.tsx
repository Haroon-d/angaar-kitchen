import type { PaperSize, ReceiptData } from "@/lib/print/types";
import { formatDate } from "@/lib/format";

const DINING_LABEL: Record<ReceiptData["diningType"], string> = {
  dine_in: "DINE IN",
  takeaway: "TAKEAWAY",
  delivery: "DELIVERY",
};

type Props = {
  data: ReceiptData;
  paperSize?: PaperSize;
  preview?: boolean;
  copyLabel?: string;
};

/**
 * Kitchen Order Ticket — no prices, no totals, no payment info.
 * Optimised for cooks: large item names + qty + notes only.
 */
export function KotTemplate({ data, paperSize = "80mm", preview = false, copyLabel }: Props) {
  const widthMm = paperSize === "58mm" ? 58 : 80;
  const wrapStyle: React.CSSProperties = preview
    ? {
        width: `${widthMm}mm`,
        margin: "0 auto",
        background: "#fff",
        color: "#000",
        padding: "6mm 4mm",
        boxShadow: "0 30px 60px -20px rgba(0,0,0,.6)",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        fontSize: paperSize === "58mm" ? 13 : 14,
        lineHeight: 1.4,
      }
    : { padding: 0 };

  return (
    <div style={wrapStyle}>
      <div
        style={{
          textAlign: "center",
          fontWeight: 800,
          fontSize: paperSize === "58mm" ? 18 : 20,
          letterSpacing: 1,
        }}
      >
        KITCHEN TICKET
      </div>
      {copyLabel && (
        <div style={{ textAlign: "center", fontSize: 10, color: "#444" }}>** {copyLabel} **</div>
      )}
      <hr style={{ border: "none", borderTop: "2px solid #000", margin: "6px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>{DINING_LABEL[data.diningType]}</span>
        <span>{data.tableLabel ? `T: ${data.tableLabel}` : ""}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>#{data.orderNo}</span>
        <span>{formatDate(data.createdAt)}</span>
      </div>
      {data.customerName && <div style={{ fontSize: 11 }}>Cust: {data.customerName}</div>}
      {data.orderNotes && <div style={{ fontSize: 11 }}>Note: {data.orderNotes}</div>}

      <hr style={{ border: "none", borderTop: "1px dashed #555", margin: "6px 0" }} />

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td
                style={{
                  verticalAlign: "top",
                  padding: "4px 0",
                  width: 36,
                  fontSize: paperSize === "58mm" ? 18 : 22,
                  fontWeight: 800,
                }}
              >
                {it.qty}×
              </td>
              <td
                style={{
                  verticalAlign: "top",
                  padding: "4px 0",
                  fontSize: paperSize === "58mm" ? 14 : 16,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                {it.name}
                {it.addons?.map((a, j) => (
                  <div key={j} style={{ fontSize: 11, fontWeight: 400, paddingLeft: 4 }}>
                    + {a.name}
                  </div>
                ))}
                {it.notes && (
                  <div
                    style={{
                      fontSize: 11,
                      fontStyle: "italic",
                      color: "#000",
                      paddingLeft: 4,
                      marginTop: 2,
                    }}
                  >
                    » {it.notes}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr style={{ border: "none", borderTop: "2px solid #000", margin: "8px 0 0" }} />
      <div style={{ textAlign: "center", fontSize: 10, color: "#444", paddingTop: 4 }}>
        {data.items.reduce((n, i) => n + i.qty, 0)} items · printed{" "}
        {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
