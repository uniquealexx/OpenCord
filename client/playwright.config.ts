import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/electron",
  // The Electron package may download its matching binary on the first smoke run.
  timeout: 120_000,
  workers: 1,
  reporter: "list",
});
