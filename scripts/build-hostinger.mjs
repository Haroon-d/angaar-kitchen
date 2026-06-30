import { spawnSync } from "node:child_process";

const viteBin = process.platform === "win32" ? "vite.cmd" : "vite";

const result = spawnSync(viteBin, ["build"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NITRO_PRESET: "node_server",
  },
});

process.exit(result.status ?? 1);
