import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { t, type ReadEntry } from "tar";
import {
  PROTOCOL_VERSION,
  releaseManifestSchema,
  serverBundleInfoSchema,
  type ReleaseManifest,
  type ServerBundleInfo,
} from "@opencord/shared";

const repositoryUrl = "https://github.com/uniquealexx/OpenCord";
const maximumManifestBytes = 1_048_576;
const maximumBundleBytes = 2 * 1024 * 1024 * 1024;
const trustedRedirectHosts = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

export interface ResolvedServerBundle {
  filePath: string;
  sha256: string;
  info: ServerBundleInfo;
  source: "local" | "github-release";
}

export interface SelectedServerBundle {
  fileName: string;
  version: string;
  releaseChannel: ServerBundleInfo["releaseChannel"];
}

export interface ServerBundleProvider {
  select(): Promise<SelectedServerBundle | null>;
  resolve(signal?: AbortSignal): Promise<ResolvedServerBundle>;
}

type FileChooser = () => Promise<string | null>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class LocalServerBundleProvider {
  private selectedPath: string | null = null;

  constructor(
    private readonly releaseDirectory: string,
    private readonly expectedVersion: string,
    private readonly chooseFile: FileChooser,
  ) {}

  async select(): Promise<SelectedServerBundle | null> {
    const selected = await this.chooseFile();
    if (!selected) return null;
    const bundle = await validateLocalServerBundle(selected);
    this.selectedPath = bundle.filePath;
    return selectedBundle(bundle);
  }

  async resolveAvailable(signal?: AbortSignal): Promise<ResolvedServerBundle | null> {
    signal?.throwIfAborted();
    if (this.selectedPath) return validateLocalServerBundle(this.selectedPath);
    const automaticPath = path.join(this.releaseDirectory, `opencord-server-${this.expectedVersion}.tar.gz`);
    if ((await stat(automaticPath).catch(() => null))?.isFile()) return validateLocalServerBundle(automaticPath);
    return null;
  }

  async resolve(signal?: AbortSignal): Promise<ResolvedServerBundle> {
    const available = await this.resolveAvailable(signal);
    if (available) return available;
    const selected = await this.chooseFile();
    if (!selected) throw new Error("Выберите локальный OpenCord Server bundle (.tar.gz) для развёртывания");
    const bundle = await validateLocalServerBundle(selected);
    this.selectedPath = bundle.filePath;
    return bundle;
  }
}

export class GitHubReleaseBundleProvider {
  private downloadDirectory: string | null = null;
  private resolved: Promise<ResolvedServerBundle> | null = null;

  constructor(
    private readonly manifestUrl: string,
    private readonly expectedVersion: string,
    private readonly temporaryDirectory: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {
    assertCanonicalManifestUrl(manifestUrl, expectedVersion);
  }

  resolve(signal?: AbortSignal): Promise<ResolvedServerBundle> {
    if (!this.resolved) {
      this.resolved = this.downloadAndValidate(signal).catch((error: unknown) => {
        this.resolved = null;
        throw error;
      });
    }
    return this.resolved;
  }

  async dispose(): Promise<void> {
    const directory = this.downloadDirectory;
    this.downloadDirectory = null;
    this.resolved = null;
    if (directory) await rm(directory, { recursive: true, force: true });
  }

  private async downloadAndValidate(signal?: AbortSignal): Promise<ResolvedServerBundle> {
    signal?.throwIfAborted();
    const manifestResponse = await fetchTrusted(this.fetcher, this.manifestUrl, signal, 30_000);
    const manifestBytes = await readResponseBytes(manifestResponse, maximumManifestBytes, signal);
    const manifest = releaseManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    validateManifestCompatibility(manifest, this.expectedVersion);

    const artifact = manifest.artifacts.serverBundle;
    const downloadUrl = artifact.downloadUrl;
    if (!downloadUrl) throw new Error("Release manifest не содержит ссылку на server bundle");
    assertCanonicalBundleUrl(downloadUrl, manifest.version, artifact.fileName);
    if (artifact.sizeBytes > maximumBundleBytes) throw new Error("Server bundle превышает допустимый размер 2 ГБ");

    const directory = this.downloadDirectory ?? await mkdtemp(path.join(this.temporaryDirectory, "opencord-server-bundle-"));
    this.downloadDirectory = directory;
    const bundlePath = path.join(directory, artifact.fileName);
    const partialPath = `${bundlePath}.part`;
    const response = await fetchTrusted(this.fetcher, downloadUrl, signal, 10 * 60_000);
    const sha256 = await downloadVerifiedFile(response, partialPath, artifact.sizeBytes, artifact.sha256, signal);
    await rename(partialPath, bundlePath);

    const bundle = await validateServerBundle(bundlePath, sha256, "github-release");
    validateBundleCompatibility(bundle.info, manifest);
    return bundle;
  }
}

export class ReleaseAwareServerBundleProvider implements ServerBundleProvider {
  constructor(
    private readonly local: LocalServerBundleProvider,
    private readonly remote: GitHubReleaseBundleProvider,
  ) {}

  select(): Promise<SelectedServerBundle | null> {
    return this.local.select();
  }

  async resolve(signal?: AbortSignal): Promise<ResolvedServerBundle> {
    const local = await this.local.resolveAvailable(signal);
    if (local) return local;
    try {
      return await this.remote.resolve(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Не удалось скачать проверенный OpenCord Server bundle: ${errorMessage(error)}. Выберите локальный bundle вручную или повторите попытку позже.`);
    }
  }

  dispose(): Promise<void> {
    return this.remote.dispose();
  }
}

export function githubReleaseManifestUrl(version: string): string {
  return `${repositoryUrl}/releases/download/v${encodeURIComponent(version)}/release-manifest.json`;
}

export async function validateLocalServerBundle(filePath: string): Promise<ResolvedServerBundle> {
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.toLowerCase().endsWith(".tar.gz")) throw new Error("OpenCord Server bundle должен иметь расширение .tar.gz");
  const sidecarPath = `${resolvedPath}.sha256`;
  const sidecar = await readFile(sidecarPath, "utf8").catch(() => {
    throw new Error(`Не найден файл контрольной суммы: ${path.basename(sidecarPath)}`);
  });
  const expectedSha256 = sidecar.trim().split(/\s+/u)[0]?.toLowerCase();
  if (!expectedSha256 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new Error("Файл контрольной суммы bundle повреждён");
  return validateServerBundle(resolvedPath, expectedSha256, "local");
}

export async function validateServerBundle(filePath: string, expectedSha256: string, source: ResolvedServerBundle["source"]): Promise<ResolvedServerBundle> {
  const resolvedPath = path.resolve(filePath);
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new Error("Некорректная SHA-256 server bundle");
  const actualSha256 = await sha256File(resolvedPath);
  if (actualSha256 !== expectedSha256) throw new Error("SHA-256 server bundle не совпадает");

  let infoText = "";
  let runtimeSha256: string | null = null;
  let runtimeSize = 0;
  const pending: Promise<void>[] = [];
  const seenEntries = new Set<string>();
  await t({
    file: resolvedPath,
    strict: true,
    onentry: (entry: ReadEntry) => {
      const entryPath = normalizeArchivePath(entry.path);
      if (!entryPath && entry.type === "Directory") { entry.resume(); return; }
      if (!entryPath || entryPath.startsWith("/") || entryPath.split("/").includes("..")) throw new Error(`Bundle содержит небезопасный путь: ${entry.path}`);
      if (seenEntries.has(entryPath)) throw new Error(`Bundle содержит повторяющуюся запись: ${entry.path}`);
      seenEntries.add(entryPath);
      if (entry.type !== "File" && entry.type !== "Directory") throw new Error(`Bundle содержит недопустимую запись: ${entry.path}`);
      if (/^(?:server|shared)\/src(?:\/|$)/u.test(entryPath) || /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$/u.test(entryPath)) {
        throw new Error(`Source-free bundle содержит build-only файл: ${entry.path}`);
      }
      if (entryPath === "bundle-info.json") {
        pending.push(consumeEntry(entry, (chunk) => {
          if (infoText.length + chunk.length > 65_536) throw new Error("bundle-info.json превышает допустимый размер");
          infoText += chunk.toString("utf8");
        }));
      } else if (entryPath === "server-runtime-linux-x64.tar.gz") {
        const hash = createHash("sha256");
        pending.push(consumeEntry(entry, (chunk) => { runtimeSize += chunk.length; hash.update(chunk); }).then(() => { runtimeSha256 = hash.digest("hex"); }));
      } else {
        entry.resume();
      }
    },
  });
  await Promise.all(pending);
  if (!infoText) throw new Error("Bundle не содержит bundle-info.json");
  const info = serverBundleInfoSchema.parse(JSON.parse(infoText));
  if (runtimeSha256 !== info.runtime.sha256 || runtimeSize !== info.runtime.sizeBytes) throw new Error("Внутренний runtime bundle повреждён или подменён");
  return { filePath: resolvedPath, sha256: actualSha256, info, source };
}

function validateManifestCompatibility(manifest: ReleaseManifest, expectedVersion: string): void {
  if (manifest.releaseChannel === "development") throw new Error("Удалённый release manifest не может использовать канал development");
  if (manifest.version !== expectedVersion) throw new Error(`Release manifest предназначен для OpenCord ${manifest.version}, ожидается ${expectedVersion}`);
  if (manifest.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Server bundle использует несовместимую версию протокола ${manifest.protocolVersion}`);
  if (manifest.artifacts.serverBundle.target.os !== "linux" || manifest.artifacts.serverBundle.target.arch !== "x64") throw new Error("Release manifest не содержит Linux x64 server bundle");
}

function validateBundleCompatibility(info: ServerBundleInfo, manifest: ReleaseManifest): void {
  if (info.version !== manifest.version
    || info.releaseChannel !== manifest.releaseChannel
    || info.commit !== manifest.commit
    || info.protocolVersion !== manifest.protocolVersion) {
    throw new Error("Метаданные server bundle не совпадают с release manifest");
  }
}

function assertCanonicalManifestUrl(value: string, version: string): void {
  if (value !== githubReleaseManifestUrl(version)) throw new Error("Разрешён только канонический OpenCord release manifest");
}

function assertCanonicalBundleUrl(value: string, version: string, fileName: string): void {
  const expected = `${repositoryUrl}/releases/download/v${encodeURIComponent(version)}/${encodeURIComponent(fileName)}`;
  if (value !== expected) throw new Error("Release manifest содержит недоверенную ссылку на server bundle");
}

async function fetchTrusted(fetcher: Fetcher, initialUrl: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    assertTrustedDownloadHost(currentUrl);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const response = await fetcher(currentUrl, { redirect: "manual", signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 5) throw new Error("GitHub вернул некорректную цепочку перенаправлений");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) throw new Error(`GitHub release недоступен: HTTP ${response.status}`);
    return response;
  }
  throw new Error("Слишком много перенаправлений GitHub release");
}

function assertTrustedDownloadHost(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || !trustedRedirectHosts.has(url.hostname)) throw new Error("Загрузка release разрешена только с доверенных HTTPS-хостов GitHub");
}

async function readResponseBytes(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error("GitHub вернул пустой ответ");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of response.body) {
    signal?.throwIfAborted();
    const chunk = Buffer.from(value);
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Ответ GitHub превышает допустимый размер");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function downloadVerifiedFile(response: Response, partialPath: string, expectedSize: number, expectedSha256: string, signal?: AbortSignal): Promise<string> {
  if (!response.body) throw new Error("GitHub вернул пустой server bundle");
  const advertisedLength = response.headers.get("content-length");
  if (advertisedLength && Number(advertisedLength) !== expectedSize) throw new Error("Размер server bundle не совпадает с release manifest");
  const handle = await open(partialPath, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const value of response.body) {
      signal?.throwIfAborted();
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > expectedSize || size > maximumBundleBytes) throw new Error("Загружаемый server bundle превышает заявленный размер");
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(partialPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  const sha256 = hash.digest("hex");
  if (size !== expectedSize || sha256 !== expectedSha256) {
    await unlink(partialPath).catch(() => undefined);
    throw new Error("Скачанный server bundle повреждён или подменён");
  }
  return sha256;
}

function selectedBundle(bundle: ResolvedServerBundle): SelectedServerBundle {
  return { fileName: path.basename(bundle.filePath), version: bundle.info.version, releaseChannel: bundle.info.releaseChannel };
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
}

function consumeEntry(entry: ReadEntry, onChunk: (chunk: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    entry.on("data", onChunk);
    entry.once("end", resolve);
    entry.once("error", reject);
  });
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
