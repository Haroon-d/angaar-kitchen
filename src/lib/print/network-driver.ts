import type { PrintJob, PrinterDriver } from "./types";
import { loadSettings } from "./settings";
import { printToNetworkPrinter } from "./network-printer.functions";

/**
 * Streams plain-text ESC/POS payloads to a network thermal printer through
 * a TanStack server function. Browsers cannot open raw TCP sockets, so all
 * actual byte writes happen in the server runtime.
 *
 * Each PrintJob in this driver carries the rendered TEXT body in `job.html`
 * (we reuse the same field for transport). The PrintService is responsible
 * for choosing text-render vs html-render based on the active driver.
 */
export class NetworkPrinterDriver implements PrinterDriver {
  id = "network";
  label = "Network thermal printer (ESC/POS)";

  async isAvailable(): Promise<boolean> {
    const s = loadSettings();
    return Boolean(s.networkHost && s.networkHost.trim().length > 0);
  }

  async print(job: PrintJob): Promise<void> {
    const s = loadSettings();
    if (!s.networkHost) throw new Error("Network printer host not configured.");
    await printToNetworkPrinter({
      data: {
        host: s.networkHost,
        port: s.networkPort ?? 9100,
        paperSize: job.paperSize,
        text: job.html, // text body in transport field
        title: job.kind === "kot" ? "KITCHEN TICKET" : undefined,
      },
    });
  }
}
