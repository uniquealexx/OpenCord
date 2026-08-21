import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientUpdateManager, resolveClientRelease, runRequiredStartupUpdate, type ElectronUpdaterAdapter } from "../electron/client-updater";

const version = "0.2.0-beta.1";
const installerName = `OpenCord-Setup-${version}-x64.exe`;
const installerBytes = Buffer.from("verified OpenCord installer");
const metadataBytes = Buffer.from(`version: ${version}\nfiles:\n  - url: ${installerName}\n`);
const sha256 = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const sha512 = (value: Buffer): string => createHash("sha512").update(value).digest("hex");
const manifestUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/release-manifest.json`;
const metadataUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/beta.yml`;
const appImageName = `OpenCord-${version}-x64.AppImage`;
const appImageBytes = Buffer.from("verified OpenCord AppImage");
const appImageUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/${appImageName}`;

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
  it("forces updater-invoked assisted installers into silent mode", async () => {
    const packageConfig = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
    const installerInclude = await readFile(path.join(process.cwd(), "build", "installer.nsh"), "utf8");

    expect(packageConfig.build.nsis.include).toBe("build/installer.nsh");
    expect(installerInclude).toContain("${isUpdated}");
    expect(installerInclude).toContain("SetSilent silent");
  });

  it("selects a newer beta release and keeps stable clients off prereleases", async () => {
    await expect(resolveClientRelease(fetcher, "0.1.0-beta.1", "beta")).resolves.toMatchObject({ version, releaseChannel: "beta" });
    await expect(resolveClientRelease(fetcher, "0.1.0", "stable")).resolves.toBeNull();
  });

  it("checks the downloaded NSIS installer, installs silently, and forces an app restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-updater-test-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, installerName);
    await writeFile(installerPath, installerBytes);
    const updater = new FakeUpdater();
    updater.installerPath = installerPath;
    const states: string[] = [];
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "windows", (state) => states.push(state.status), fetcher);

    await expect(manager.check()).resolves.toMatchObject({ status: "available", version });
    await expect(manager.download()).resolves.toMatchObject({ status: "downloaded", version });
    manager.install();

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.channel).toBe("beta");
    expect(states).toEqual(expect.arrayContaining(["checking", "available", "downloading", "downloaded"]));
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("rejects a downloaded installer that does not match the manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-updater-test-"));
    temporaryDirectories.push(directory);
    const installerPath = path.join(directory, installerName);
    await writeFile(installerPath, "tampered");
    const updater = new FakeUpdater(); updater.installerPath = installerPath;
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "windows", () => undefined, fetcher);
    await manager.check();
    await expect(manager.download()).resolves.toMatchObject({ status: "error", message: expect.stringContaining("size") });
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
        .mockResolvedValueOnce({ status: "error", currentVersion: "0.1.0-beta.3", channel: "beta", message: "GitHub is unavailable" })
        .mockResolvedValueOnce({ status: "up-to-date", currentVersion: version, channel: "beta", checkedAt: new Date().toISOString() }),
      download: vi.fn(),
    };
    const decide = vi.fn(async () => "retry" as const);
    await expect(runRequiredStartupUpdate(manager, decide)).resolves.toBe("ready");
    expect(manager.check).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenCalledWith("GitHub is unavailable");
  });

  it("exits when the mandatory update check fails and the user declines retry", async () => {
    const manager = {
      check: vi.fn(async () => ({ status: "error", currentVersion: "0.1.0-beta.3", channel: "beta", message: "No network connection" } as const)),
      download: vi.fn(),
    };
    await expect(runRequiredStartupUpdate(manager, async () => "quit")).resolves.toBe("quit");
  });
});

class DirectUpdater implements ElectronUpdaterAdapter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  channel: string | null = null;
  filePath = "";
  updateFiles: Array<{ url: string; size?: number; sha512?: string }> = [];
  quitAndInstall = vi.fn();
  on(_event: "download-progress", _listener: (progress: { percent: number }) => void): this;
  on(_event: "error", _listener: (error: Error) => void): this;
  on(): this { return this; }
  async checkForUpdates() {
    if (this.updateFiles.length === 0) return null;
    return { updateInfo: { version, files: this.updateFiles } };
  }
  async downloadUpdate() { return [this.filePath]; }
}

describe("Direct updater flow (macOS and Linux AppImage)", () => {
  it("checks, verifies and downloads an update through the update metadata", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-direct-updater-test-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, appImageName);
    await writeFile(filePath, appImageBytes);
    const updater = new DirectUpdater();
    updater.filePath = filePath;
    updater.updateFiles = [{ url: appImageUrl, size: appImageBytes.length, sha512: sha512(appImageBytes) }];
    const states: string[] = [];
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "appimage", (state) => states.push(state.status), fetcher);

    await expect(manager.check()).resolves.toMatchObject({
      status: "available",
      version,
      sizeBytes: appImageBytes.length,
      releaseUrl: `https://github.com/uniquealexx/OpenCord/releases/tag/v${version}`,
    });
    await expect(manager.download()).resolves.toMatchObject({ status: "downloaded", version });
    manager.install();

    expect(updater.allowPrerelease).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(states).toEqual(expect.arrayContaining(["checking", "available", "downloading", "downloaded"]));
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("keeps the client on the current version when no update is published", async () => {
    const updater = new DirectUpdater();
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "mac", () => undefined, fetcher);
    await expect(manager.check()).resolves.toMatchObject({ status: "up-to-date" });
  });

  it("rejects update metadata with a non-canonical download URL", async () => {
    const updater = new DirectUpdater();
    updater.updateFiles = [{ url: `https://evil.example.com/releases/download/v${version}/${appImageName}`, size: 10 }];
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "mac", () => undefined, fetcher);
    await expect(manager.check()).resolves.toMatchObject({ status: "error", message: expect.stringContaining("untrusted") });
  });

  it("rejects a downloaded update that does not match the update metadata", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-direct-updater-test-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, appImageName);
    await writeFile(filePath, "tampered");
    const updater = new DirectUpdater();
    updater.filePath = filePath;
    updater.updateFiles = [{ url: appImageUrl, size: appImageBytes.length, sha512: sha512(appImageBytes) }];
    const manager = new ClientUpdateManager(updater, "0.1.0-beta.1", "appimage", () => undefined, fetcher);
    await manager.check();
    await expect(manager.download()).resolves.toMatchObject({ status: "error", message: expect.stringContaining("size") });
  });

  it("reports a disabled state with a platform reason for deb and development flavors", async () => {
    const deb = new ClientUpdateManager(new DirectUpdater(), version, "deb", () => undefined, fetcher);
    expect(deb.getState()).toMatchObject({ status: "disabled", reason: expect.stringContaining("deb") });
    await expect(deb.check()).resolves.toMatchObject({ status: "disabled" });
    const development = new ClientUpdateManager(new DirectUpdater(), version, "development", () => undefined, fetcher);
    expect(development.getState()).toMatchObject({ status: "disabled" });
  });
});
