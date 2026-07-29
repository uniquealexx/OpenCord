import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, RELEASE_MANIFEST_SCHEMA_VERSION, releaseManifestSchema } from "../src";

const serverBundle = {
  bundleFormatVersion: 1,
  fileName: "opencord-server-1.2.3.tar.gz",
  downloadUrl: null,
  sha256: "a".repeat(64),
  sizeBytes: 1024,
  target: { os: "linux", arch: "x64" },
  installModes: ["docker", "native"],
} as const;

describe("release manifest v1", () => {
  it("accepts a local development manifest", () => {
    const manifest = { schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION, product: "opencord", releaseChannel: "development", version: "1.2.3-dev.1", protocolVersion: PROTOCOL_VERSION, commit: null, publishedAt: null, releaseUrl: null, artifacts: { serverBundle, serverImage: null, windowsClient: null } };
    expect(releaseManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("accepts a complete stable manifest and future protocol versions", () => {
    const manifest = {
      schemaVersion: 1, product: "opencord", releaseChannel: "stable", version: "1.2.3", protocolVersion: PROTOCOL_VERSION + 1,
      commit: "b".repeat(40), publishedAt: "2026-07-29T12:00:00.000Z", releaseUrl: "https://github.com/uniquealexx/OpenCord/releases/tag/v1.2.3",
      artifacts: { serverBundle: { ...serverBundle, downloadUrl: "https://github.com/uniquealexx/OpenCord/releases/download/v1.2.3/opencord-server-1.2.3.tar.gz" }, serverImage: { reference: "ghcr.io/uniquealexx/opencord-server:1.2.3", digest: `sha256:${"c".repeat(64)}`, platforms: [{ os: "linux", arch: "amd64" }] }, windowsClient: null },
    };
    expect(releaseManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it("accepts a published beta manifest", () => {
    const manifest = {
      schemaVersion: 1, product: "opencord", releaseChannel: "beta", version: "1.2.3-beta.1", protocolVersion: PROTOCOL_VERSION,
      commit: "b".repeat(40), publishedAt: "2026-07-29T12:00:00.000Z", releaseUrl: "https://github.com/uniquealexx/OpenCord/releases/tag/v1.2.3-beta.1",
      artifacts: { serverBundle: { ...serverBundle, fileName: "opencord-server-1.2.3-beta.1.tar.gz", downloadUrl: "https://github.com/uniquealexx/OpenCord/releases/download/v1.2.3-beta.1/opencord-server-1.2.3-beta.1.tar.gz" }, serverImage: { reference: "ghcr.io/uniquealexx/opencord-server:beta", digest: `sha256:${"c".repeat(64)}`, platforms: [{ os: "linux", arch: "amd64" }] }, windowsClient: null },
    };
    expect(releaseManifestSchema.parse(manifest)).toEqual(manifest);
    expect(() => releaseManifestSchema.parse({ ...manifest, version: "1.2.3" })).toThrow();
  });

  it("rejects incomplete stable metadata and unsafe artifacts", () => {
    const base = { schemaVersion: 1, product: "opencord", releaseChannel: "stable", version: "1.2.3", protocolVersion: 13, commit: "b".repeat(40), publishedAt: "2026-07-29T12:00:00.000Z", releaseUrl: "https://github.com/uniquealexx/OpenCord/releases/tag/v1.2.3", artifacts: { serverBundle: { ...serverBundle, downloadUrl: "https://github.com/uniquealexx/OpenCord/releases/download/v1.2.3/opencord-server-1.2.3.tar.gz" }, serverImage: null, windowsClient: null } };
    expect(() => releaseManifestSchema.parse({ ...base, commit: null })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...base, version: "1.2.3-beta.1" })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...base, releaseUrl: "http://example.com/release" })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...base, artifacts: { ...base.artifacts, serverBundle: { ...base.artifacts.serverBundle, fileName: "../server.tar.gz" } } })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...base, artifacts: { ...base.artifacts, serverBundle: { ...base.artifacts.serverBundle, sha256: "ABC" } } })).toThrow();
    expect(() => releaseManifestSchema.parse({ ...base, unexpected: true })).toThrow();
  });
});
