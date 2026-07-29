import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";
import { z } from "zod";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const rootPackage = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")) as { version?: unknown };
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u).parse(rootPackage.version);
const releaseChannel = z.enum(["development", "beta", "stable"]).parse(process.env.OPENCORD_RELEASE_CHANNEL ?? "development");
const commit = process.env.OPENCORD_BUILD_COMMIT || null;

if (commit !== null && !/^[a-f0-9]{40}$/u.test(commit)) throw new Error("OPENCORD_BUILD_COMMIT must be a full lowercase 40-character Git commit");
if (releaseChannel !== "development" && commit === null) throw new Error("Published server builds require OPENCORD_BUILD_COMMIT");
if (process.env.OPENCORD_EXPECTED_VERSION && process.env.OPENCORD_EXPECTED_VERSION !== version) {
  throw new Error(`Docker build version ${process.env.OPENCORD_EXPECTED_VERSION} does not match root package version ${version}`);
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "es2022",
  clean: true,
  define: {
    __OPENCORD_VERSION__: JSON.stringify(version),
    __OPENCORD_RELEASE_CHANNEL__: JSON.stringify(releaseChannel),
    __OPENCORD_BUILD_COMMIT__: JSON.stringify(commit),
  },
});
