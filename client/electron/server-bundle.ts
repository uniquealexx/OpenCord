import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { t, type ReadEntry } from "tar";
import { serverBundleInfoSchema, type ServerBundleInfo } from "@opencord/shared";

export interface ResolvedServerBundle {
  filePath: string;
  sha256: string;
  info: ServerBundleInfo;
  source: "local";
}

export interface SelectedServerBundle {
  fileName: string;
  version: string;
  releaseChannel: ServerBundleInfo["releaseChannel"];
}

type FileChooser = () => Promise<string | null>;

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
    return { fileName: path.basename(bundle.filePath), version: bundle.info.version, releaseChannel: bundle.info.releaseChannel };
  }

  async resolve(): Promise<ResolvedServerBundle> {
    if (this.selectedPath) return validateLocalServerBundle(this.selectedPath);
    const automaticPath = path.join(this.releaseDirectory, `opencord-server-${this.expectedVersion}.tar.gz`);
    if ((await stat(automaticPath).catch(() => null))?.isFile()) return validateLocalServerBundle(automaticPath);
    const selected = await this.chooseFile();
    if (!selected) throw new Error("Выберите локальный OpenCord Server bundle (.tar.gz) для развёртывания");
    const bundle = await validateLocalServerBundle(selected);
    this.selectedPath = bundle.filePath;
    return bundle;
  }
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
  const actualSha256 = await sha256File(resolvedPath);
  if (actualSha256 !== expectedSha256) throw new Error("SHA-256 локального server bundle не совпадает");

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
  return { filePath: resolvedPath, sha256: actualSha256, info, source: "local" };
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
