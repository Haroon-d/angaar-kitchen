import { useEffect, useState } from "react";
import type { PaperSize } from "./types";

export type DriverId = "browser" | "qz" | "network";

export type PrinterSettings = {
  paperSize: PaperSize;
  driver: DriverId;
  /** QZ Tray printer names */
  receiptPrinter?: string;
  kitchenPrinter?: string;
  /** Network ESC/POS printer */
  networkHost?: string;
  networkPort?: number;
  /** Receipt content */
  footerNote: string;
  taxId: string;
  /** Operational */
  printKotCopies: number;
};

const KEY = "ak.printer.settings.v2";

export const defaultSettings: PrinterSettings = {
  paperSize: "80mm",
  driver: "browser",
  networkPort: 9100,
  footerNote: "Thank you for dining with Angaar Kitchen — visit us again!",
  taxId: "",
  printKotCopies: 1,
};

export function loadSettings(): PrinterSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: PrinterSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("ak:printer-settings", { detail: s }));
}

export function usePrinterSettings() {
  const [settings, setSettings] = useState<PrinterSettings>(() => loadSettings());
  useEffect(() => {
    const handler = (e: Event) => setSettings((e as CustomEvent<PrinterSettings>).detail);
    window.addEventListener("ak:printer-settings", handler);
    return () => window.removeEventListener("ak:printer-settings", handler);
  }, []);
  const update = (patch: Partial<PrinterSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };
  return { settings, update };
}
