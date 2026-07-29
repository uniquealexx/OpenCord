import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerBuildInfo, validateServerBuildInfo } from "../src/build-info";

const rootPackage = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version: string };

describe("server build metadata", () => {
  it("uses the root package version for local development", () => {
    expect(loadServerBuildInfo({})).toEqual({ version: rootPackage.version, releaseChannel: "development", commit: null });
  });

  it("requires immutable commit metadata for published builds", () => {
    expect(() => validateServerBuildInfo({ version: "0.1.0", releaseChannel: "stable", commit: null })).toThrow(/require/i);
    expect(validateServerBuildInfo({ version: "0.1.0", releaseChannel: "stable", commit: "a".repeat(40) })).toEqual({ version: "0.1.0", releaseChannel: "stable", commit: "a".repeat(40) });
    expect(() => validateServerBuildInfo({ version: "0.1.0-beta.1", releaseChannel: "beta", commit: null })).toThrow(/require/i);
    expect(validateServerBuildInfo({ version: "0.1.0-beta.1", releaseChannel: "beta", commit: "b".repeat(40) })).toEqual({ version: "0.1.0-beta.1", releaseChannel: "beta", commit: "b".repeat(40) });
  });

  it("rejects invalid versions and commits", () => {
    expect(() => validateServerBuildInfo({ version: "latest", releaseChannel: "development", commit: null })).toThrow();
    expect(() => validateServerBuildInfo({ version: "0.1.0", releaseChannel: "development", commit: "ABC" })).toThrow();
  });
});
