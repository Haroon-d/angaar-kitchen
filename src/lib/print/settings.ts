import { useEffect, useState } from "react";
import type { PaperSize } from "./types";
import { appDb as supabase } from "@/lib/app-db";

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

async function fetchBranchPrinterSettings(branchId: string): Promise<PrinterSettings | null> {
  const { data, error } = await (supabase.from("branch_printer_settings" as any) as any)
    .select("settings")
    .eq("branch_id", branchId)
    .maybeSingle();
  if (error || !data?.settings) return null;
  return { ...defaultSettings, ...(data.settings as Partial<PrinterSettings>) };
}

async function persistBranchPrinterSettings(branchId: string, settings: PrinterSettings) {
  await (supabase.from("branch_printer_settings" as any) as any).upsert(
    {
      branch_id: branchId,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id" },
  );
}

export function usePrinterSettings(branchId?: string) {
  const [settings, setSettings] = useState<PrinterSettings>(() => loadSettings());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!branchId) {
      setHydrated(true);
      return;
    }
    (async () => {
      const remote = await fetchBranchPrinterSettings(branchId);
      if (cancelled) return;
      if (remote) {
        setSettings(remote);
        saveSettings(remote);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  useEffect(() => {
    const handler = (e: Event) => setSettings((e as CustomEvent<PrinterSettings>).detail);
    window.addEventListener("ak:printer-settings", handler);
    return () => window.removeEventListener("ak:printer-settings", handler);
  }, []);

  const update = (patch: Partial<PrinterSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    if (branchId) {
      void persistBranchPrinterSettings(branchId, next);
    }
  };
  return { settings, update, hydrated };
}
