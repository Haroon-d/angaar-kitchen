// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, componentTagger (dev-only),
//     VITE_* env injection, @ path alias, React/TanStack dedupe, error logger plugins,
//     and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper)
// and build with Nitro so Vercel receives Build Output API artifacts instead of
// Cloudflare Worker/Wrangler output.
export default defineConfig({
  cloudflare: false,
  plugins: [nitro({ preset: "vercel" })],
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    logLevel: process.env.NODE_ENV === "production" ? "error" : "info",
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          const message = warning.message ?? "";
          if (message.includes("Module level directives") && message.includes('"use client"')) {
            return;
          }
          if (message.includes("are imported from external module") && message.includes("never used")) {
            return;
          }
          if (message.includes("Circular chunk: _libs/pg")) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  },
});
