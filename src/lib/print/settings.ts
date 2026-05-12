import { useEffect, useState } from "react";
import type { PaperSize } from "./types";

export type PrinterSettings = {
  paperSize: PaperSize;
  autoPrint: boolean;
  driver: "browser" | "qz";
  receiptPrinter?: string;
  kitchenPrinter?: string;
  footerNote: string;
  taxId: string;
};

const KEY = "ak.printer.settings.v1";

export const defaultSettings: PrinterSettings = {
  paperSize: "80mm",
  autoPrint: true,
  driver: "browser",
  footerNote: "Thank you for dining with Angaar Kitchen — visit us again!",
  taxId: "",
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
    const handler = (e: Event) => {
      const ce = e as CustomEvent<PrinterSettings>;
      setSettings(ce.detail);
    };
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
