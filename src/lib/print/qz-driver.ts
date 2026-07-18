import type { PrintJob, PrinterDriver } from "./types";
import { loadSettings } from "./settings";

/**
 * QZ Tray driver — bridges the browser to USB / Bluetooth / network ESC-POS
 * thermal printers via the QZ Tray desktop app (https://qz.io).
 *
 * Setup the cashier needs:
 *   1. Install QZ Tray on the POS machine.
 *   2. Load https://demo.qz.io/js/qz-tray.js (or self-host) before the app runs,
 *      OR add the script tag at runtime — we attempt that below.
 *   3. In Settings → Printer, choose "QZ Tray" as the driver and pick the
 *      receipt printer name.
 *
 * In dev / when QZ is unreachable, `isAvailable()` returns false and the
 * PrintService falls back to the BrowserPrintDriver automatically.
 */
declare global {
  interface Window { qz?: any }
}

const QZ_SCRIPT = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

let scriptLoading: Promise<void> | null = null;

function loadQzScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).qz) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = QZ_SCRIPT;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { scriptLoading = null; rej(new Error("Failed to load qz-tray script")); };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

export class QZTrayDriver implements PrinterDriver {
  id = "qz";
  label = "QZ Tray (Thermal / ESC-POS)";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      await loadQzScript();
      const qz = (window as any).qz;
      if (!qz) return false;
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect().catch(() => {});
      }
      return Boolean(qz.websocket.isActive());
    } catch {
      return false;
    }
  }

  async print(job: PrintJob): Promise<void> {
    const qz = (window as any).qz;
    if (!qz?.websocket?.isActive()) {
      throw new Error("QZ Tray not connected. Open QZ Tray on this machine and reload.");
    }
    const settings = loadSettings();
    const printerName = (job.kind === "kot" ? settings.kitchenPrinter : settings.receiptPrinter)
      ?.trim();
    if (!printerName) {
      throw new Error("No printer selected. Pick one in Settings → Printer.");
    }
    await assertPrinterExists(qz, printerName);
    const config = qz.configs.create(printerName, {
      encoding: "Cp1252",
    });
    try {
      await qz.print(config, [
        {
          type: "raw",
          format: "command",
          flavor: "plain",
          data: [toPlainThermalText(job.html)],
        },
      ]);
    } catch (error) {
      throw normalizeQzError(error, printerName);
    }
  }

  /** Helper for the settings page to list available printers. */
  static async listPrinters(): Promise<string[]> {
    const qz = (window as any).qz;
    if (!qz?.websocket?.isActive()) return [];
    try { return await qz.printers.find(); } catch { return []; }
  }
}

async function assertPrinterExists(qz: any, printerName: string) {
  const expected = printerName.trim();
  if (!expected) throw new Error("No printer selected. Pick one in Settings → Printer.");
  try {
    const printers = await qz.printers.find();
    if (!Array.isArray(printers) || printers.length === 0) return;
    const exact = printers.some((name) => String(name).trim() === expected);
    if (!exact) {
      throw new Error(
        `Printer "${expected}" was not found by QZ Tray. Use the exact Windows printer name.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("was not found")) throw error;
  }
}

function normalizeQzError(error: unknown, printerName: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("reading '0'") || message.includes('reading "0"')) {
    return new Error(
      `QZ Tray could not send raw data to "${printerName}". Open QZ Tray, allow the print request, and confirm this exact Windows printer name is visible in QZ Tray.`,
    );
  }
  return error instanceof Error ? error : new Error(message || "QZ Tray print failed.");
}

function toPlainThermalText(text: string) {
  const normalized = text
    .replace(/â‚¨|₨|₹/g, "Rs.")
    .replace(/[·×»]/g, (ch) => ({ "·": "-", "×": "x", "»": ">" }[ch] ?? ch))
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("");

  return normalized.replace(/\n/g, "\r\n") + "\r\n\r\n\r\n";
}
