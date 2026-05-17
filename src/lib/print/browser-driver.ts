import type { PaperSize, PrintJob, PrinterDriver } from "./types";

/**
 * Browser print driver — renders the print HTML inside a hidden iframe and
 * triggers the OS print dialog. Compatible with any thermal printer that has
 * a desktop driver installed.
 */
export class BrowserPrintDriver implements PrinterDriver {
  id = "browser";
  label = "Browser / OS Printer";

  async isAvailable() {
    return typeof window !== "undefined" && typeof window.print === "function";
  }

  async print(job: PrintJob): Promise<void> {
    if (typeof window === "undefined") throw new Error("Print unavailable");
    const html = wrapPrintDocument(job.html, job.paperSize);

    return new Promise<void>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.setAttribute("aria-hidden", "true");
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch { /* noop */ }
        }, 1000);
      };

      try {
        const doc = iframe.contentDocument!;
        doc.open();
        doc.write(html);
        doc.close();

        const trigger = () => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            cleanup();
          }
        };

        // Wait for images/fonts to settle.
        if (iframe.contentDocument?.readyState === "complete") {
          setTimeout(trigger, 80);
        } else {
          iframe.onload = () => setTimeout(trigger, 80);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}

function wrapPrintDocument(bodyHtml: string, size: PaperSize) {
  const widthMm = size === "58mm" ? 58 : 80;
  const imagePrint = bodyHtml.includes("ak-print-image");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: ${size === "58mm" ? "11px" : "12px"};
    line-height: 1.4;
    width: ${widthMm}mm;
    padding: ${imagePrint ? "0" : "4mm 3mm"};
  }
  img { display: block; max-width: 100%; height: auto; break-inside: avoid; page-break-inside: avoid; }
  .ak-r-h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; font-size: ${size === "58mm" ? "16px" : "18px"}; margin: 0; text-align: center; letter-spacing: .5px; }
  .ak-r-meta { text-align: center; font-size: ${size === "58mm" ? "10px" : "11px"}; line-height: 1.35; }
  .ak-r-rule { border: none; border-top: 1px dashed #555; margin: 6px 0; }
  .ak-r-row { display: flex; justify-content: space-between; gap: 6px; }
  .ak-r-row.muted { color: #444; }
  .ak-r-item { margin: 2px 0; }
  .ak-r-item .name { font-weight: 600; }
  .ak-r-item .sub { font-size: 10px; color: #555; padding-left: 8px; }
  .ak-r-total { display: flex; justify-content: space-between; font-weight: 700; font-size: ${size === "58mm" ? "14px" : "16px"}; padding-top: 4px; border-top: 2px solid #000; margin-top: 4px; }
  .ak-r-foot { text-align: center; margin-top: 8px; font-size: 10px; }
  .ak-r-badge { display: inline-block; border: 1px solid #000; padding: 2px 6px; border-radius: 3px; font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
  table.ak-r-items { width: 100%; border-collapse: collapse; }
  table.ak-r-items td { padding: 1px 0; vertical-align: top; }
  table.ak-r-items td.qty { width: 26px; }
  table.ak-r-items td.amt { text-align: right; white-space: nowrap; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
