import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Network printer driver — opens a raw TCP socket to a network ESC/POS
 * thermal printer (port 9100 by default) and streams plain-text bytes.
 *
 * Runs entirely server-side because browsers cannot open raw TCP. Caller
 * passes a plain-text receipt body; we wrap it with minimal ESC/POS init +
 * cut commands so any standard 80mm/58mm thermal printer can render it.
 */

// Only allow well-known thermal/line printer ports. Prevents using this
// server function as a generic outbound TCP connector.
const ALLOWED_PORTS = new Set([9100, 9101, 9102, 515, 631]);

const Schema = z.object({
  host: z.string().min(1).max(255).regex(/^[a-zA-Z0-9.\-]+$/, "invalid host"),
  port: z.number().int().refine((p) => ALLOWED_PORTS.has(p), "port not allowed").default(9100),
  paperSize: z.enum(["80mm", "58mm"]).default("80mm"),
  /** Plain UTF-8 text. We add ESC/POS init, encoding, line feeds, and cut. */
  text: z.string().min(1).max(20000),
  /** Optional double-height title to print first. */
  title: z.string().max(120).optional(),
});

/**
 * Block SSRF targets: loopback, link-local (incl. cloud metadata 169.254.169.254),
 * RFC1918 private ranges, IPv6 loopback/link-local/ULA, and unspecified addresses.
 * The host is resolved to an IP first; if any resolved address is blocked, we refuse.
 */
function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("::ffff:")) return isBlockedIp(v.slice(7));
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;       // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                       // multicast/reserved
  return false;
}

// Minimal ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;
const INIT = Buffer.from([ESC, 0x40]);                 // initialize
const CUT  = Buffer.from([GS, 0x56, 0x42, 0x00]);      // partial cut
const FEED = Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]);    // line feeds before cut
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const ALIGN_LEFT   = Buffer.from([ESC, 0x61, 0x00]);
const DBL_ON  = Buffer.from([GS, 0x21, 0x11]);          // 2x width + 2x height
const DBL_OFF = Buffer.from([GS, 0x21, 0x00]);

export const printToNetworkPrinter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Schema.parse(input))
  .handler(async ({ data }) => {
    const net = await import("node:net");
    const dns = await import("node:dns/promises");

    // Resolve and SSRF-check every address the host points to.
    let addrs: { address: string; family: number }[] = [];
    try {
      addrs = await dns.lookup(data.host, { all: true });
    } catch {
      throw new Error(`Cannot resolve printer host: ${data.host}`);
    }
    if (addrs.length === 0) throw new Error(`Cannot resolve printer host: ${data.host}`);
    for (const a of addrs) {
      if (isBlockedIp(a.address)) {
        throw new Error("Printer host is not allowed (private/loopback/metadata address blocked).");
      }
    }
    const targetIp = addrs[0].address;

    const chunks: Buffer[] = [INIT];
    if (data.title) {
      chunks.push(ALIGN_CENTER, DBL_ON, Buffer.from(data.title + "\n", "utf8"), DBL_OFF, ALIGN_LEFT);
    }
    chunks.push(Buffer.from(data.text, "utf8"), FEED, CUT);
    const payload = Buffer.concat(chunks);

    return new Promise<{ ok: true; bytes: number }>((resolve, reject) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Printer ${data.host}:${data.port} timed out`));
      }, 8000);

      socket.once("error", (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`Printer error: ${err.message}`));
      });

      socket.connect(data.port, data.host, () => {
        socket.write(payload, (err) => {
          if (err) {
            clearTimeout(timer);
            socket.destroy();
            return reject(new Error(`Write failed: ${err.message}`));
          }
          socket.end(() => {
            clearTimeout(timer);
            resolve({ ok: true, bytes: payload.length });
          });
        });
      });
    });
  });
