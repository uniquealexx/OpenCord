import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientUpdateManager, resolveClientRelease, runRequiredStartupUpdate, type ElectronUpdaterAdapter } from "../electron/client-updater";

const version = "0.2.0-beta.1";
const installerName = `OpenCord-Setup-${version}-x64.exe`;
const installerBytes = Buffer.from("verified OpenCord installer");
const metadataBytes = Buffer.from(`version: ${version}\nfiles:\n  - url: ${installerName}\n`);
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const manifestUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/release-manifest.json`;
const metadataUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/beta.yml`;

function manifest() {
  return {
    schemaVersion: 1,
    product: "opencord",
    releaseChannel: "beta",
    version,
    protocolVersion: 13,
    commit: "a".repeat(40),
    publishedAt: "2026-07-29T12:00:00.000Z",
    releaseUrl: `https://github.com/uniquealexx/OpenCord/releases/tag/v${version}`,
    artifacts: {
      serverBundle: { bundleFormatVersion: 1, fileName: `opencord-server-${version}.tar.gz`, downloadUrl: `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/opencord-server-${version}.tar.gz`, sha256: "b".repeat(64), sizeBytes: 100, target: { os: "linux", arch: "x64" }, installModes: ["docker", "native"] },
      serverImage: null,
      windowsClient: {
        installer: { fileName: installerName, downloadUrl: `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/${installerName}`, sha256: sha256(installerBytes), sizeBytes: installerBytes.length },
        updateMetadata: { fileName: "beta.yml", downloadUrl: metadataUrl, sha256: sha256(metadataBytes), sizeBytes: metadataBytes.length },
        blockmap: null,
        target: { os: "windows", arch: "x64" },
      },
    },
  };
}

function releases() {
  return [{ tag_name: `v${version}`, draft: false, prerelease: true, assets: [{ name: "release-manifest.json", browser_download_url: manifestUrl }] }];
}

function fetcher(input: string): Promise<Response> {
  if (input.includes("api.github.com")) return Promise.resolve(Response.json(releases()));
  if (input === manifestUrl) return Promise.resolve(Response.json(manifest()));
  if (input === metadataUrl) return Promise.resolve(new Response(metadataBytes));
  return Promise.resolve(new Response(null, { status: 404 }));
}

class FakeUpdater implements ElectronUpdaterAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  channel: string | null = null;
  installerPath = "";
  quitAndInstall = vi.fn();
  on(_event: "download-progress", _listener: (progress: { percent: number }) => void): this;
  on(_event: "error", _listener: (error: Error) => void): this;
  on(): this { return this; }
  async checkForUpdates() { return { updateInfo: { version } }; }
  async downloadUpdate() { return [this.installerPath]; }
}

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("Electron client updater", () => {
  it("selects a newer beta release and keeps stable clients off prereleases", async () => {
    await expect(resolveClientRelease(fetcher, "0.1.0-beta.1", "beta")).resolves.toMatchObject({ version, releaseChannel: "beta" });
    await expect(resolveClientRelease(fetcher, "0.1.0", "stable")).resolves.toBeNull();
  });

  it("checks metadata and verifies the downloaded NSIS installer before installation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-updater-test-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, installerName);
    await writeFile(installerPath, installerBytes);
    const updater = new FakeUpdater();
    updater.installerPath = installerPath;
    const states: string[] = [];
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", true, (state) => states.push(state.status), fetcher);

    await expect(manager.check()).resolves.toMatchObject({ status: "available", version });
    await expect(manager.download()).resolves.toMatchObject({ status: "downloaded", version });
    manager.install();

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.channel).toBe("beta");
    expect(states).toEqual(expect.arrayContaining(["checking", "available", "downloading", "downloaded"]));
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("rejects a downloaded installer that does not match the manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-updater-test-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, installerName);
    await writeFile(installerPath, "tampered");
    const updater = new FakeUpdater(); updater.installerPath = installerPath;
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", true, () => undefined, fetcher);
    await manager.check();
    await expect(manager.download()).resolves.toMatchObject({ status: "error", message: expect.stringContaining("Размер") });
  });

  it("continues startup immediately when the installed client is current", async () => {
    const manager = {
      check: vi.fn(async () => ({ status: "up-to-date", currentVersion: version, channel: "beta", checkedAt: new Date().toISOString() } as const)),
      download: vi.fn(),
    };
    await expect(runRequiredStartupUpdate(manager, vi.fn())).resolves.toBe("ready");
    expect(manager.download).not.toHaveBeenCalled();
  });

  it("downloads a newer client automatically before allowing startup", async () => {
    const manager = {
      check: vi.fn(async () => ({ status: "available", currentVersion: "0.1.0-beta.3", channel: "beta", version, releaseUrl: `https://github.com/uniquealexx/OpenCord/releases/tag/v${version}`, sizeBytes: installerBytes.length } as const)),
      download: vi.fn(async () => ({ status: "downloaded", currentVersion: "0.1.0-beta.3", channel: "beta", version } as const)),
    };
    await expect(runRequiredStartupUpdate(manager, vi.fn())).resolves.toBe("install");
    expect(manager.download).toHaveBeenCalledOnce();
  });

  it("retries a failed mandatory check and never bypasses it", async () => {
    const manager = {
      check: vi.fn()
        .mockResolvedValueOnce({ status: "error", currentVersion: "0.1.0-beta.3", channel: "beta", message: "GitHub недоступен" })
        .mockResolvedValueOnce({ status: "up-to-date", currentVersion: version, channel: "beta", checkedAt: new Date().toISOString() }),
      download: vi.fn(),
    };
    const decide = vi.fn(async () => "retry" as const);
    await expect(runRequiredStartupUpdate(manager, decide)).resolves.toBe("ready");
    expect(manager.check).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("GitHub недоступен");
  });

  it("exits when the mandatory update check fails and the user declines retry", async () => {
    const manager = {
      check: vi.fn(async () => ({ status: "error", currentVersion: "0.1.0-beta.3", channel: "beta", message: "Нет сети" } as const)),
      download: vi.fn(),
    };
    await expect(runRequiredStartupUpdate(manager, async () => "quit")).resolves.toBe("quit");
  });
});
