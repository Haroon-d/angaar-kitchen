import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { BrowserPrintDriver } from "./browser-driver";
import { QZTrayDriver } from "./qz-driver";
import { loadSettings } from "./settings";
import type { PaperSize, PrintJob, PrinterDriver } from "./types";

const drivers: Record<string, PrinterDriver> = {
  browser: new BrowserPrintDriver(),
  qz: new QZTrayDriver(),
};

/** Simple in-memory queue. Future: persist to IndexedDB + retry. */
class PrintQueue {
  private q: PrintJob[] = [];
  private running = false;

  enqueue(job: PrintJob) {
    this.q.push(job);
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.q.length) {
        const job = this.q.shift()!;
        const driver = await pickDriver();
        try {
          await driver.print(job);
        } catch (err) {
          console.error("[print] job failed", err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

const queue = new PrintQueue();

async function pickDriver(): Promise<PrinterDriver> {
  const s = loadSettings();
  const requested = drivers[s.driver] ?? drivers.browser;
  if (await requested.isAvailable()) return requested;
  return drivers.browser;
}

export const PrintService = {
  /** Render a React element to an HTML string suitable for the print iframe. */
  renderHtml(node: ReactElement): string {
    return renderToStaticMarkup(node);
  },

  /** Print receipt / KOT html. Resolves once the OS print dialog is invoked. */
  async print(opts: { html: string; kind: "receipt" | "kot"; paperSize?: PaperSize; copies?: number }) {
    const s = loadSettings();
    const job: PrintJob = {
      kind: opts.kind,
      paperSize: opts.paperSize ?? s.paperSize,
      html: opts.html,
      copies: opts.copies ?? 1,
    };
    queue.enqueue(job);
  },

  drivers,
};
