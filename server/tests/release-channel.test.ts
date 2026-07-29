import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const helper = path.resolve(import.meta.dirname, "../../deploy/management/release-channel.mjs");
const helperSource = readFileSync(helper, "utf8");

function run(mode: "resolve-release" | "resolve-manifest", args: string[], input: unknown) {
  return spawnSync(process.execPath, ["-e", helperSource, mode, ...args], {
    encoding: "utf8",
    input: JSON.stringify(input),
  });
}

function stableManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    product: "opencord",
    releaseChannel: "stable",
    version: "1.2.3",
    protocolVersion: 13,
    commit: "a".repeat(40),
    publishedAt: "2026-07-29T10:00:00.000Z",
    releaseUrl: "https://github.com/uniquealexx/OpenCord/releases/tag/v1.2.3",
    artifacts: {
      serverBundle: {
        fileName: "opencord-server-1.2.3.tar.gz",
        downloadUrl: "https://github.com/uniquealexx/OpenCord/releases/download/v1.2.3/opencord-server-1.2.3.tar.gz",
        sha256: "b".repeat(64),
        sizeBytes: 123456,
        bundleFormatVersion: 1,
        target: { os: "linux", arch: "x64" },
        installModes: ["docker", "native"],
      },
      serverImage: null,
      windowsClient: null,
    },
    ...overrides,
  };
}

describe("opencordctl release channel resolver", () => {
  it("resolves the unique manifest asset from a stable GitHub release", () => {
    const result = run("resolve-release", ["stable"], {
      tag_name: "v1.2.3",
      draft: false,
      prerelease: false,
      assets: [{ name: "release-manifest.json", browser_download_url: "https://github.com/uniquealexx/OpenCord/releases/download/v1.2.3/release-manifest.json" }],
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("1.2.3\thttps://github.com/uniquealexx/OpenCord/releases/download/v1.2.3/release-manifest.json\n");
  });

  it("returns update, current and newer using SemVer precedence", () => {
    const update = run("resolve-manifest", ["stable", "1.2.3", "1.2.2", "stable", "13"], stableManifest());
    const development = run("resolve-manifest", ["stable", "1.2.3", "1.2.3+local", "development", "13"], stableManifest());
    const current = run("resolve-manifest", ["stable", "1.2.3", "1.2.3+build.1", "stable", "13"], stableManifest());
    const newer = run("resolve-manifest", ["stable", "1.2.3", "1.3.0-beta.1", "beta", "13"], stableManifest());
    expect(update.status).toBe(0);
    expect(update.stdout).toMatch(/^update\t1\.2\.3\t/u);
    expect(development.stdout).toMatch(/^update\t1\.2\.3\t/u);
    expect(current.stdout).toMatch(/^current\t1\.2\.3\t/u);
    expect(newer.stdout).toMatch(/^newer\t1\.2\.3\t/u);
  });

  it("rejects protocol changes and substituted artifact URLs", () => {
    const protocol = run("resolve-manifest", ["stable", "1.2.3", "1.2.2", "stable", "12"], stableManifest());
    const substituted = stableManifest();
    substituted.artifacts.serverBundle.downloadUrl = "https://attacker.example/opencord-server-1.2.3.tar.gz";
    const url = run("resolve-manifest", ["stable", "1.2.3", "1.2.2", "stable", "13"], substituted);
    expect(protocol.status).toBe(1);
    expect(protocol.stderr).toContain("протокол");
    expect(url.status).toBe(1);
    expect(url.stderr).toContain("неожиданный server bundle URL");
  });
});
