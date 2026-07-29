import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, SERVER_BUNDLE_FORMAT_VERSION, serverBundleInfoSchema } from "../src";

const validInfo = {
  formatVersion: SERVER_BUNDLE_FORMAT_VERSION,
  product: "opencord-server",
  version: "0.1.0",
  releaseChannel: "development",
  commit: null,
  protocolVersion: PROTOCOL_VERSION,
  target: { os: "linux", arch: "x64" },
  runtime: { fileName: "server-runtime-linux-x64.tar.gz", sha256: "a".repeat(64), sizeBytes: 42 },
} as const;

describe("server bundle metadata", () => {
  it("accepts the source-free Linux x64 contract", () => {
    expect(serverBundleInfoSchema.parse(validInfo)).toEqual(validInfo);
  });

  it("rejects invalid targets, digests, and published bundles without commits", () => {
    expect(() => serverBundleInfoSchema.parse({ ...validInfo, target: { os: "windows", arch: "x64" } })).toThrow();
    expect(() => serverBundleInfoSchema.parse({ ...validInfo, runtime: { ...validInfo.runtime, sha256: "ABC" } })).toThrow();
    expect(() => serverBundleInfoSchema.parse({ ...validInfo, releaseChannel: "stable" })).toThrow();
    expect(() => serverBundleInfoSchema.parse({ ...validInfo, version: "0.1.0-beta.1", releaseChannel: "beta" })).toThrow();
  });
});
