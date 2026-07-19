import type { PrintJob, PrinterDriver } from "./types";
import { loadSettings } from "./settings";
import { wrapPrintDocument } from "./browser-driver";

/**
 * QZ Tray driver. For USB/Windows thermal printers we print HTML as pixels
 * through the installed printer driver. Raw ESC/POS is intentionally avoided
 * here because driver-based Bixolon setups can print raw text as garbage.
 */
declare global {
  interface Window {
    qz?: any;
  }
}

const QZ_SCRIPT = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

let scriptLoading: Promise<void> | null = null;

function loadQzScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.qz) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = QZ_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error("Failed to load qz-tray script"));
    };
    document.head.appendChild(script);
  });

  return scriptLoading;
}

export class QZTrayDriver implements PrinterDriver {
  id = "qz";
  label = "QZ Tray (Thermal / Windows Driver)";

  async isAvailable(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      await loadQzScript();
      const qz = window.qz;
      if (!qz) return false;
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect().catch(() => undefined);
      }
      return Boolean(qz.websocket.isActive());
    } catch {
      return false;
    }
  }

  async print(job: PrintJob): Promise<void> {
    const qz = window.qz;
    if (!qz?.websocket?.isActive()) {
      throw new Error("QZ Tray is not connected. Open QZ Tray on this computer, then try again.");
    }

    const settings = loadSettings();
    const printerName = (job.kind === "kot" ? settings.kitchenPrinter : settings.receiptPrinter)
      ?.trim();
    if (!printerName) {
      throw new Error("No printer selected. Pick one in Settings -> Printer.");
    }

    await assertPrinterExists(qz, printerName);

    const config = qz.configs.create(printerName, {
      units: "mm",
      margins: 0,
      scaleContent: true,
    });

    try {
      await qz.print(config, [
        {
          type: "pixel",
          format: "html",
          flavor: "plain",
          data: wrapPrintDocument(job.html, job.paperSize),
        },
      ]);
    } catch (error) {
      throw normalizeQzError(error, printerName);
    }
  }

  static async listPrinters(): Promise<string[]> {
    const qz = window.qz;
    if (!qz?.websocket?.isActive()) return [];
    try {
      return await qz.printers.find();
    } catch {
      return [];
    }
  }
}

async function assertPrinterExists(qz: any, printerName: string) {
  const expected = printerName.trim();
  if (!expected) throw new Error("No printer selected. Pick one in Settings -> Printer.");
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
      `QZ Tray could not send the receipt to "${printerName}". Open QZ Tray, allow the print request, and confirm this exact Windows printer name is visible in QZ Tray.`,
    );
  }
  return error instanceof Error ? error : new Error(message || "QZ Tray print failed.");
}
