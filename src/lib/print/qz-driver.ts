import type { PrintJob, PrinterDriver } from "./types";

/**
 * QZ Tray driver — websocket bridge to USB / network ESC/POS thermal printers.
 *
 * Stub for future activation. To enable:
 *   1. Have the cashier install QZ Tray (https://qz.io)
 *   2. `bun add qz-tray`
 *   3. Replace `print()` body with qz.print(config, [{type:'pixel', format:'html', flavor:'plain', data: html}])
 *
 * Until then this driver reports unavailable so the service falls back to the
 * browser driver. The `PrinterDriver` interface keeps UI/queue code unchanged.
 */
export class QZTrayDriver implements PrinterDriver {
  id = "qz";
  label = "QZ Tray (Thermal / ESC-POS)";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    return Boolean((window as any).qz);
  }

  async print(_job: PrintJob): Promise<void> {
    throw new Error("QZ Tray driver is not configured. Install QZ Tray and enable it in Settings → Printer.");
  }
}
