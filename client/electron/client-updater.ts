import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { releaseManifestSchema, type ReleaseManifest } from "@opencord/shared";
import type { ClientUpdateState } from "../src/shared/updater";

const repositoryUrl = "https://github.com/uniquealexx/OpenCord";
const releasesApiUrl = "https://api.github.com/repos/uniquealexx/OpenCord/releases?per_page=20";
const maximumManifestBytes = 1_048_576;
const maximumMetadataBytes = 1_048_576;
const maximumInstallerBytes = 2 * 1024 * 1024 * 1024;
const trustedHosts = new Set(["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
type UpdateFileInfo = { url: string; size?: number; sha512?: string };
type UpdateCheckResult = { updateInfo: { version: string; files?: UpdateFileInfo[] } } | null;

/**
 * Which distribution channel the running client belongs to.
 * - `windows`: installed NSIS build — update via release manifest + NSIS installer.
 * - `mac`: packaged macOS build — update via electron-updater MacUpdater (zip).
 * - `appimage`: packaged Linux build launched from an AppImage.
 * - `deb`: packaged Linux build installed via deb — no self-update mechanism.
 * - `development`: unpackaged launch — updater is disabled.
 */
export type ClientUpdateFlavor = "windows" | "mac" | "appimage" | "deb" | "development";

export interface ElectronUpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  checkForUpdates(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

type StateListener = (state: ClientUpdateState) => void;
export type StartupUpdateDecision = "retry" | "quit";
export type StartupUpdateResult = "ready" | "install" | "quit";

interface StartupUpdateManager {
  check(): Promise<ClientUpdateState>;
  download(): Promise<ClientUpdateState>;
}

export async function runRequiredStartupUpdate(
  manager: StartupUpdateManager,
  decideAfterError: (message: string) => Promise<StartupUpdateDecision>,
): Promise<StartupUpdateResult> {
  for (;;) {
    const checked = await manager.check();
    if (checked.status === "disabled" || checked.status === "up-to-date") return "ready";
    if (checked.status === "available") {
      const downloaded = await manager.download();
      if (downloaded.status === "downloaded") return "install";
      if (downloaded.status !== "error") throw new Error(`Unexpected startup update state after download: ${downloaded.status}`);
      if (await decideAfterError(downloaded.message) === "quit") return "quit";
      continue;
    }
    if (checked.status === "error") {
      if (await decideAfterError(checked.message) === "quit") return "quit";
      continue;
    }
    throw new Error(`Unexpected startup update state after check: ${checked.status}`);
  }
}

export class ClientUpdateManager {
  private state: ClientUpdateState;
  private candidate: ReleaseManifest | null = null;
  private directCandidate: { version: string; fileName: string; sizeBytes: number; sha512: string | null } | null = null;
  private operation: Promise<ClientUpdateState> | null = null;

  constructor(
    private readonly updater: ElectronUpdaterAdapter,
    private readonly currentVersion: string,
    private readonly flavor: ClientUpdateFlavor,
    private readonly emitState: StateListener,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {
    const channel = releaseChannelForVersion(currentVersion);
    const enabled = flavor !== "development" && flavor !== "deb";
    this.state = enabled
      ? { status: "idle", currentVersion, channel }
      : { status: "disabled", currentVersion, channel, reason: disabledReason(flavor) };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.on("download-progress", ({ percent }) => {
      const version = this.candidate?.version ?? this.directCandidate?.version;
      if (!version || this.state.status !== "downloading") return;
      this.setState({ status: "downloading", currentVersion, channel, version, percent: Math.max(0, Math.min(100, percent)) });
    });
    updater.on("error", (error) => console.error("OpenCord client updater error:", error.message));
  }

  getState(): ClientUpdateState {
    return this.state;
  }

  check(): Promise<ClientUpdateState> {
    if (!this.updaterEnabled) return Promise.resolve(this.state);
    if (this.operation) return this.operation;
    this.operation = this.performCheck().finally(() => { this.operation = null; });
    return this.operation;
  }

  download(): Promise<ClientUpdateState> {
    if (!this.updaterEnabled) return Promise.resolve(this.state);
    if (this.operation) return this.operation;
    this.operation = this.performDownload().finally(() => { this.operation = null; });
    return this.operation;
  }

  install(): void {
    if (this.state.status !== "downloaded") throw new Error("Обновление клиента ещё не загружено");
    this.updater.quitAndInstall(true, true);
  }

  private get updaterEnabled(): boolean {
    return this.flavor !== "development" && this.flavor !== "deb";
  }

  private async performCheck(): Promise<ClientUpdateState> {
    const channel = releaseChannelForVersion(this.currentVersion);
    this.setState({ status: "checking", currentVersion: this.currentVersion, channel });
    if (this.flavor !== "windows") return this.performDirectCheck();
    try {
      const candidate = await resolveClientRelease(this.fetcher, this.currentVersion, channel);
      if (!candidate) {
        this.candidate = null;
        return this.setState({ status: "up-to-date", currentVersion: this.currentVersion, channel, checkedAt: new Date().toISOString() });
      }
      await validateUpdateMetadata(this.fetcher, candidate);
      this.updater.channel = candidate.releaseChannel === "beta" ? "beta" : "latest";
      this.updater.allowPrerelease = candidate.releaseChannel === "beta";
      this.updater.allowDowngrade = false;
      const result = await this.updater.checkForUpdates();
      if (!result || result.updateInfo.version !== candidate.version) throw new Error("electron-updater вернул версию, не совпадающую с проверенным release manifest");
      const windowsClient = candidate.artifacts.windowsClient;
      if (!windowsClient) throw new Error("Release manifest не содержит Windows-клиент");
      this.candidate = candidate;
      return this.setState({ status: "available", currentVersion: this.currentVersion, channel, version: candidate.version, releaseUrl: candidate.releaseUrl!, sizeBytes: windowsClient.installer.sizeBytes });
    } catch (error) {
      this.candidate = null;
      return this.setState({ status: "error", currentVersion: this.currentVersion, channel, message: errorMessage(error) });
    }
  }

  private async performDirectCheck(): Promise<ClientUpdateState> {
    const channel = releaseChannelForVersion(this.currentVersion);
    try {
      this.updater.channel = channel === "beta" ? "beta" : "latest";
      this.updater.allowPrerelease = channel === "beta";
      this.updater.allowDowngrade = false;
      const result = await this.updater.checkForUpdates();
      if (!result) {
        this.directCandidate = null;
        return this.setState({ status: "up-to-date", currentVersion: this.currentVersion, channel, checkedAt: new Date().toISOString() });
      }
      const version = result.updateInfo.version;
      if (!semverPattern.test(version) || compareSemver(version, this.currentVersion) <= 0) {
        throw new Error("electron-updater вернул версию, не новее или некорректную");
      }
      const file = result.updateInfo.files?.[0];
      if (!file?.url) throw new Error("Update metadata не содержит файл обновления");
      const fileName = updateFileName(file.url);
      const expectedUrl = `${repositoryUrl}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(fileName)}`;
      if (file.url !== expectedUrl) throw new Error("Update metadata содержит недоверенный URL файла обновления");
      if (!Number.isInteger(file.size) || file.size! <= 0) throw new Error("Update metadata не содержит размер файла обновления");
      this.directCandidate = { version, fileName, sizeBytes: file.size!, sha512: file.sha512 ?? null };
      return this.setState({
        status: "available",
        currentVersion: this.currentVersion,
        channel,
        version,
        releaseUrl: `${repositoryUrl}/releases/tag/v${encodeURIComponent(version)}`,
        sizeBytes: file.size!,
      });
    } catch (error) {
      this.directCandidate = null;
      return this.setState({ status: "error", currentVersion: this.currentVersion, channel, message: errorMessage(error) });
    }
  }

  private async performDirectDownload(): Promise<ClientUpdateState> {
    const channel = releaseChannelForVersion(this.currentVersion);
    const candidate = this.directCandidate;
    if (!candidate || this.state.status !== "available") throw new Error("Сначала проверьте наличие обновления");
    this.setState({ status: "downloading", currentVersion: this.currentVersion, channel, version: candidate.version, percent: 0 });
    try {
      const downloadedPaths = await this.updater.downloadUpdate();
      const filePath = downloadedPaths.find((downloaded) => path.basename(downloaded) === candidate.fileName);
      if (!filePath) throw new Error("electron-updater не вернул ожидаемый файл обновления");
      const file = await stat(filePath);
      if (!file.isFile() || file.size !== candidate.sizeBytes) throw new Error("Размер загруженного обновления не совпадает с update metadata");
      if (candidate.sha512 && await sha512File(filePath) !== candidate.sha512) throw new Error("SHA-512 загруженного обновления не совпадает с update metadata");
      return this.setState({ status: "downloaded", currentVersion: this.currentVersion, channel, version: candidate.version });
    } catch (error) {
      return this.setState({ status: "error", currentVersion: this.currentVersion, channel, message: errorMessage(error) });
    }
  }

  private async performDownload(): Promise<ClientUpdateState> {
    const channel = releaseChannelForVersion(this.currentVersion);
    if (this.flavor !== "windows") return this.performDirectDownload();
    const candidate = this.candidate;
    if (!candidate || this.state.status !== "available") throw new Error("Сначала проверьте наличие обновления");
    const windowsClient = candidate.artifacts.windowsClient;
    if (!windowsClient) throw new Error("Release manifest не содержит Windows-клиент");
    this.setState({ status: "downloading", currentVersion: this.currentVersion, channel, version: candidate.version, percent: 0 });
    try {
      const downloadedPaths = await this.updater.downloadUpdate();
      const installerPath = downloadedPaths.find((filePath) => path.basename(filePath) === windowsClient.installer.fileName);
      if (!installerPath) throw new Error("electron-updater не вернул ожидаемый NSIS installer");
      const installer = await stat(installerPath);
      if (!installer.isFile() || installer.size !== windowsClient.installer.sizeBytes || installer.size > maximumInstallerBytes) throw new Error("Размер загруженного installer не совпадает с release manifest");
      if (await sha256File(installerPath) !== windowsClient.installer.sha256) throw new Error("SHA-256 загруженного installer не совпадает с release manifest");
      return this.setState({ status: "downloaded", currentVersion: this.currentVersion, channel, version: candidate.version });
    } catch (error) {
      return this.setState({ status: "error", currentVersion: this.currentVersion, channel, message: errorMessage(error) });
    }
  }

  private setState(next: ClientUpdateState): ClientUpdateState {
    this.state = next;
    this.emitState(next);
    return next;
  }
}

export async function resolveClientRelease(fetcher: Fetcher, currentVersion: string, channel: "beta" | "stable"): Promise<ReleaseManifest | null> {
  parseSemver(currentVersion);
  const releasesResponse = await fetchTrusted(fetcher, releasesApiUrl, 30_000);
  const releases = JSON.parse((await readResponseBytes(releasesResponse, maximumManifestBytes)).toString("utf8"));
  if (!Array.isArray(releases)) throw new Error("GitHub Releases вернул некорректный список релизов");

  const candidates = releases.flatMap((release): Array<{ version: string; manifestUrl: string }> => {
    if (!isObject(release) || release.draft !== false || typeof release.tag_name !== "string" || !Array.isArray(release.assets)) return [];
    const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
    if (!semverPattern.test(version) || compareSemver(version, currentVersion) <= 0) return [];
    const beta = /-beta(?:\.|$)/u.test(version.split("+", 1)[0] ?? version);
    if ((channel === "stable" && beta) || (!beta && version.includes("-"))) return [];
    if (release.prerelease !== beta) return [];
    const assets = release.assets.filter((asset) => isObject(asset) && asset.name === "release-manifest.json");
    if (assets.length !== 1 || typeof assets[0].browser_download_url !== "string") return [];
    const manifestUrl = `${repositoryUrl}/releases/download/v${encodeURIComponent(version)}/release-manifest.json`;
    return assets[0].browser_download_url === manifestUrl ? [{ version, manifestUrl }] : [];
  }).sort((left, right) => compareSemver(right.version, left.version));

  const selected = candidates[0];
  if (!selected) return null;
  const manifestResponse = await fetchTrusted(fetcher, selected.manifestUrl, 30_000);
  const manifest = releaseManifestSchema.parse(JSON.parse((await readResponseBytes(manifestResponse, maximumManifestBytes)).toString("utf8")));
  validateClientManifest(manifest, selected.version, channel);
  return manifest;
}

function validateClientManifest(manifest: ReleaseManifest, expectedVersion: string, currentChannel: "beta" | "stable"): void {
  if (manifest.version !== expectedVersion || manifest.releaseChannel === "development") throw new Error("Release manifest не совпадает с выбранным GitHub Release");
  if (currentChannel === "stable" && manifest.releaseChannel !== "stable") throw new Error("Stable-клиент не принимает prerelease-обновления");
  if (manifest.releaseUrl !== `${repositoryUrl}/releases/tag/v${encodeURIComponent(manifest.version)}`) throw new Error("Release manifest содержит недоверенный URL релиза");
  const client = manifest.artifacts.windowsClient;
  if (!client || client.target.os !== "windows" || client.target.arch !== "x64") throw new Error("Release manifest не содержит Windows x64 клиента");
  for (const artifact of [client.installer, client.updateMetadata, ...(client.blockmap ? [client.blockmap] : [])]) {
    if (!artifact.downloadUrl) throw new Error("Windows-артефакт не содержит URL загрузки");
    const expectedUrl = `${repositoryUrl}/releases/download/v${encodeURIComponent(manifest.version)}/${encodeURIComponent(artifact.fileName)}`;
    if (artifact.downloadUrl !== expectedUrl) throw new Error("Release manifest содержит недоверенный URL Windows-артефакта");
  }
  if (client.installer.sizeBytes > maximumInstallerBytes) throw new Error("NSIS installer превышает допустимый размер 2 ГБ");
}

async function validateUpdateMetadata(fetcher: Fetcher, manifest: ReleaseManifest): Promise<void> {
  const metadata = manifest.artifacts.windowsClient?.updateMetadata;
  if (!metadata?.downloadUrl) throw new Error("Release manifest не содержит update metadata");
  const response = await fetchTrusted(fetcher, metadata.downloadUrl, 30_000);
  const bytes = await readResponseBytes(response, Math.min(maximumMetadataBytes, metadata.sizeBytes));
  if (bytes.length !== metadata.sizeBytes || sha256Bytes(bytes) !== metadata.sha256) throw new Error("Update metadata повреждён или подменён");
  const text = bytes.toString("utf8");
  if (!text.includes(`version: ${manifest.version}`) || !text.includes(manifest.artifacts.windowsClient!.installer.fileName)) throw new Error("Update metadata не соответствует release manifest");
}

async function fetchTrusted(fetcher: Fetcher, initialUrl: string, timeoutMs: number): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:" || !trustedHosts.has(parsed.hostname)) throw new Error("Обновления разрешено загружать только с доверенных HTTPS-хостов GitHub");
    const response = await fetcher(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenCord-Updater/1" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) throw new Error("GitHub вернул некорректную цепочку перенаправлений");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`GitHub Releases недоступен: HTTP ${response.status}`);
    return response;
  }
  throw new Error("Слишком много перенаправлений GitHub Releases");
}

async function readResponseBytes(response: Response, maximumBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error("GitHub вернул пустой ответ");
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > maximumBytes) throw new Error("Ответ GitHub превышает допустимый размер");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of response.body) {
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Ответ GitHub превышает допустимый размер");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function releaseChannelForVersion(version: string): "beta" | "stable" {
  return /-beta(?:\.|$)/u.test(version.split("+", 1)[0] ?? version) ? "beta" : "stable";
}

function compareSemver(leftValue: string, rightValue: string): number {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  for (const index of [0, 1, 2] as const) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const leftPart = left.prerelease[index]; const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1; if (rightPart === undefined) return 1; if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart); const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function parseSemver(value: string): { core: [bigint, bigint, bigint]; prerelease: string[] } {
  const match = semverPattern.exec(value);
  if (!match) throw new Error(`Некорректная SemVer-версия: ${value}`);
  return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease: match[4]?.split(".") ?? [] };
}

function sha256Bytes(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function sha256File(filePath: string): Promise<string> { return new Promise((resolve, reject) => { const hash = createHash("sha256"); const stream = createReadStream(filePath); stream.on("data", (chunk) => hash.update(chunk)); stream.once("error", reject); stream.once("end", () => resolve(hash.digest("hex"))); }); }
function sha512File(filePath: string): Promise<string> { return new Promise((resolve, reject) => { const hash = createHash("sha512"); const stream = createReadStream(filePath); stream.on("data", (chunk) => hash.update(chunk)); stream.once("error", reject); stream.once("end", () => resolve(hash.digest("hex"))); }); }
function updateFileName(url: string): string {
  const fileName = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(fileName)) throw new Error("Update metadata содержит некорректное имя файла обновления");
  return fileName;
}
function disabledReason(flavor: ClientUpdateFlavor): string {
  if (flavor === "deb") return "В deb-сборке автоматическое обновление не поддерживается — установите новую версию из GitHub Releases";
  return "Обновления доступны только в установленной сборке OpenCord";
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
