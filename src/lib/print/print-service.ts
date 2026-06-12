import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { BrowserPrintDriver } from "./browser-driver";
import { QZTrayDriver } from "./qz-driver";
import { NetworkPrinterDriver } from "./network-driver";
import { loadSettings } from "./settings";
import type { PaperSize, PrintJob, PrinterDriver } from "./types";

const drivers: Record<string, PrinterDriver> = {
  browser: new BrowserPrintDriver(),
  qz: new QZTrayDriver(),
  network: new NetworkPrinterDriver(),
};

class PrintQueue {
  private q: PrintJob[] = [];
  private running = false;

  enqueue(job: PrintJob, onResult?: (err?: Error) => void) {
    this.q.push(Object.assign(job, { __cb: onResult }));
    void this.drain();
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.q.length) {
        const job = this.q.shift()! as PrintJob & { __cb?: (e?: Error) => void };
        const driver = await pickDriver();
        try {
          await driver.print(job);
          job.__cb?.();
        } catch (err: any) {
          console.error("[print] job failed", err);
          job.__cb?.(err);
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
  if (s.driver === "qz") {
    throw new Error("QZ Tray is not connected. Open QZ Tray on this computer, then try again.");
  }
  return drivers.browser;
}

export const PrintService = {
  renderHtml(node: ReactElement): string {
    return renderToStaticMarkup(node);
  },

  /**
   * Print a job. Resolves when the job is done (success or error).
   * Manual button-triggered flow only — never call automatically.
   */
  print(opts: { html: string; kind: "receipt" | "kot" | "bill"; paperSize?: PaperSize; copies?: number }): Promise<void> {
    const s = loadSettings();
    return new Promise((resolve, reject) => {
      const copies = Math.max(1, Math.floor(opts.copies ?? 1));
      const job: PrintJob = {
        kind: opts.kind === "bill" ? "receipt" : opts.kind,
        paperSize: opts.paperSize ?? s.paperSize,
        html: opts.html,
        copies,
      };
      let pending = copies;
      let failed = false;

      for (let i = 0; i < copies; i += 1) {
        queue.enqueue({ ...job, copies: 1 }, (err) => {
          if (failed) return;
          if (err) {
            failed = true;
            reject(err);
            return;
          }
          pending -= 1;
          if (pending === 0) resolve();
        });
      }
    });
  },

  drivers,

  async activeDriverId(): Promise<string> {
    return (await pickDriver()).id;
  },
};
