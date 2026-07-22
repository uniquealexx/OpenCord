import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["electron/main.ts", "electron/preload.ts"],
  format: ["cjs"],
  platform: "node",
  target: "es2022",
  outDir: "dist-electron",
  external: ["electron"],
  noExternal: ["zod"],
  clean: true,
});
