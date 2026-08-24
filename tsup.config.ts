import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node22",
  platform: "node",
  external: ["node:sqlite", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
  esbuildOptions(options) {
    options.banner = { js: 'import { createRequire } from "module"; import path from "path"; import { fileURLToPath } from "url"; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = path.dirname(__filename);' };
  },
});
