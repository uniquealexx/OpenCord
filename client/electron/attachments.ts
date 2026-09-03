import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { attachmentSchema, type Attachment } from "@opencord/shared";

const MAX_INLINE_PREVIEW_BYTES = 10 * 1024 * 1024;
const IMAGE_PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VIDEO_PREVIEW_EXTENSIONS = new Map<string, string>([["video/mp4", ".mp4"], ["video/webm", ".webm"], ["video/ogg", ".ogv"]]);
const AUDIO_PREVIEW_EXTENSIONS = new Map<string, string>([["audio/mpeg", ".mp3"], ["audio/ogg", ".ogg"], ["audio/webm", ".webm"], ["audio/mp4", ".m4a"], ["audio/wav", ".wav"]]);
const pendingMediaPreviews = new Map<string, Promise<void>>();
export const HEAVY_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_RATE_BYTES_PER_SECOND = 8 * 1024 * 1024;
export const VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND = 2 * 1024 * 1024;
let attachmentLatencySensitive = false;

export interface AttachmentTransferOptions { latencySensitive?: boolean; /** Имя файла, отличное от basename пути (загрузка из буфера через временный файл). */ fileName?: string; /** Явный MIME-тип (у пути из буфера нет надёжного расширения). */ mimeType?: string }

export function attachmentTransferRate(sizeBytes: number, latencySensitive = false): number | null {
  if (sizeBytes < HEAVY_ATTACHMENT_BYTES) return null;
  return latencySensitive ? VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND : ATTACHMENT_RATE_BYTES_PER_SECOND;
}

export function setAttachmentLatencySensitive(value: boolean): void {
  attachmentLatencySensitive = value;
}

export function activeAttachmentTransferRate(latencySensitiveAtStart = false): number {
  return latencySensitiveAtStart || attachmentLatencySensitive
    ? VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND
    : ATTACHMENT_RATE_BYTES_PER_SECOND;
}

export class AttachmentTransferScheduler {
  private heavyTail: Promise<void> = Promise.resolve();

  async run<T>(sizeBytes: number, latencySensitive: boolean, transfer: (bytesPerSecond: number | null) => Promise<T>): Promise<T> {
    const bytesPerSecond = attachmentTransferRate(sizeBytes, latencySensitive);
    if (bytesPerSecond === null) return transfer(null);
    const previous = this.heavyTail;
    let release!: () => void;
    this.heavyTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await transfer(bytesPerSecond); } finally { release(); }
  }
}

class BandwidthThrottle extends Transform {
  private nextAvailableAt = Date.now();

  constructor(private readonly latencySensitiveAtStart: boolean) { super(); }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    const now = Date.now();
    const bytesPerSecond = activeAttachmentTransferRate(this.latencySensitiveAtStart);
    const startsAt = Math.max(now, this.nextAvailableAt);
    this.nextAvailableAt = startsAt + chunk.length / bytesPerSecond * 1_000;
    const waitMilliseconds = Math.max(0, Math.ceil(this.nextAvailableAt - now));
    if (waitMilliseconds === 0) callback(null, chunk);
    else setTimeout(() => callback(null, chunk), waitMilliseconds);
  }
}

const attachmentTransfers = new AttachmentTransferScheduler();

export async function uploadAttachment(filePath: string, serverAddress: string, sessionToken: string, maxAttachmentBytes: number | null, options: AttachmentTransferOptions = {}): Promise<Attachment> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1) throw new Error("Выбран пустой файл или не обычный файл");
  if (maxAttachmentBytes !== null && info.size > maxAttachmentBytes) throw new Error(`Файл превышает лимит ${Math.floor(maxAttachmentBytes / 1024 / 1024)} МБ`);
  return attachmentTransfers.run(info.size, Boolean(options.latencySensitive), async (bytesPerSecond) => {
    const endpoint = attachmentUrl(serverAddress);
    const { response, outgoing } = openRequest(endpoint, "POST", {
      authorization: `Bearer ${sessionToken}`,
      "content-type": "application/octet-stream",
      "content-length": String(info.size),
      "x-opencord-file-name": Buffer.from(options.fileName ?? path.basename(filePath), "utf8").toString("base64url"),
      "x-opencord-mime-type": resolveMimeType(options.mimeType, options.fileName ?? filePath),
    });
    const responsePromise = response;
    if (bytesPerSecond === null) await pipeline(createReadStream(filePath), outgoing);
    else await pipeline(createReadStream(filePath), new BandwidthThrottle(Boolean(options.latencySensitive)), outgoing);
    const incoming = await responsePromise;
    const payload = await readResponse(incoming);
    if (incoming.statusCode !== 201) throw new Error(serverError(incoming.statusCode, payload));
    return attachmentSchema.parse(JSON.parse(payload));
  });
}

export async function downloadAttachment(serverAddress: string, sessionToken: string, attachment: Attachment, destination: string, options: AttachmentTransferOptions = {}): Promise<void> {
  return attachmentTransfers.run(attachment.sizeBytes, Boolean(options.latencySensitive), async (bytesPerSecond) => {
    const endpoint = attachmentUrl(serverAddress, attachment.id);
    const { response, outgoing } = openRequest(endpoint, "GET", { authorization: `Bearer ${sessionToken}` });
    outgoing.end();
    const incoming = await response;
    if (incoming.statusCode !== 200) throw new Error(serverError(incoming.statusCode, await readResponse(incoming)));
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    const backup = `${destination}.${randomUUID()}.replaced`;
    let written = 0;
    const hash = createHash("sha256");
    const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      hash.update(chunk);
      if (written > attachment.sizeBytes) callback(new Error("Сервер прислал файл больше заявленного размера"));
      else callback(null, chunk);
    } });
    try {
      const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
      if (bytesPerSecond === null) await pipeline(incoming, verifier, output);
      else await pipeline(incoming, verifier, new BandwidthThrottle(Boolean(options.latencySensitive)), output);
      if (written !== attachment.sizeBytes) throw new Error("Размер скачанного файла не совпадает с метаданными");
      if (hash.digest("hex") !== attachment.sha256) throw new Error("Контрольная сумма скачанного файла не совпадает");
      let displaced = false;
      try { await rename(destination, backup); displaced = true; } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      try { await rename(temporary, destination); } catch (error) {
        if (displaced) await rename(backup, destination).catch(() => undefined);
        throw error;
      }
      if (displaced) await rm(backup, { force: true }).catch(() => undefined);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  });
}

export async function previewAttachment(serverAddress: string, sessionToken: string, attachment: Attachment, videoPreviewDirectory?: string, options: AttachmentTransferOptions = {}): Promise<string> {
  const mediaExtension = VIDEO_PREVIEW_EXTENSIONS.get(attachment.mimeType) ?? AUDIO_PREVIEW_EXTENSIONS.get(attachment.mimeType);
  if (mediaExtension) {
    if (!videoPreviewDirectory) throw new Error("Каталог предпросмотра медиа не настроен");
    const target = path.join(videoPreviewDirectory, `${attachment.sha256}${mediaExtension}`);
    let pending = pendingMediaPreviews.get(target);
    if (!pending) {
      pending = ensureCachedMedia(serverAddress, sessionToken, attachment, target, options).finally(() => pendingMediaPreviews.delete(target));
      pendingMediaPreviews.set(target, pending);
    }
    await pending;
    return pathToFileURL(target).toString();
  }
  if (!IMAGE_PREVIEW_TYPES.has(attachment.mimeType)) throw new Error("Предпросмотр этого типа файла недоступен");
  if (attachment.sizeBytes > MAX_INLINE_PREVIEW_BYTES) throw new Error("Предпросмотр изображений больше 10 МБ недоступен — скачайте файл");
  return attachmentTransfers.run(attachment.sizeBytes, Boolean(options.latencySensitive), async (bytesPerSecond) => {
    const endpoint = attachmentUrl(serverAddress, attachment.id);
    const { response, outgoing } = openRequest(endpoint, "GET", { authorization: `Bearer ${sessionToken}` });
    outgoing.end();
    const incoming = await response;
    if (incoming.statusCode !== 200) throw new Error(serverError(incoming.statusCode, await readResponse(incoming)));
    const contents = await readBinaryResponse(bytesPerSecond === null ? incoming : incoming.pipe(new BandwidthThrottle(Boolean(options.latencySensitive))));
    if (contents.length !== attachment.sizeBytes) throw new Error("Размер медиафайла не совпадает с метаданными");
    if (createHash("sha256").update(contents).digest("hex") !== attachment.sha256) throw new Error("Контрольная сумма медиафайла не совпадает");
    return `data:${attachment.mimeType};base64,${contents.toString("base64")}`;
  });
}

export async function prepareAttachmentPreviewDirectory(parentDirectory: string): Promise<string> {
  const directory = path.join(parentDirectory, "opencord-media-previews");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function ensureCachedMedia(serverAddress: string, sessionToken: string, attachment: Attachment, target: string, options: AttachmentTransferOptions): Promise<void> {
  try {
    const existing = await stat(target);
    if (existing.isFile() && existing.size === attachment.sizeBytes) return;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  await rm(target, { force: true });
  await downloadAttachment(serverAddress, sessionToken, attachment, target, options);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function attachmentUrl(serverAddress: string, attachmentId?: string): URL {
  const url = new URL(serverAddress);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Некорректный адрес сервера");
  url.pathname = attachmentId ? `/api/attachments/${encodeURIComponent(attachmentId)}` : "/api/attachments";
  url.search = "";
  url.hash = "";
  return url;
}

function openRequest(url: URL, method: "GET" | "POST", headers: Record<string, string>): { response: Promise<IncomingMessage>; outgoing: ClientRequest } {
  let resolveResponse!: (response: IncomingMessage) => void;
  let rejectResponse!: (error: Error) => void;
  const response = new Promise<IncomingMessage>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method, headers }, resolveResponse);
  outgoing.once("error", rejectResponse);
  outgoing.setTimeout(30_000, () => outgoing.destroy(new Error("Сервер не ответил вовремя")));
  return { response, outgoing };
}

async function readResponse(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > 256 * 1024) throw new Error("Слишком большой ответ сервера");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBinaryResponse(response: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_INLINE_PREVIEW_BYTES) throw new Error("Сервер прислал слишком большой медиафайл");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function serverError(statusCode: number | undefined, payload: string): string {
  try {
    const value = JSON.parse(payload) as { error?: unknown };
    if (typeof value.error === "string") return `Сервер отклонил файл (${statusCode ?? 0}): ${value.error}`;
  } catch { /* non-JSON response */ }
  return `Сервер отклонил операцию с файлом (${statusCode ?? 0})`;
}

function resolveMimeType(explicit: string | undefined, filePath: string): string {
  // MediaRecorder отдаёт тип с параметрами ("audio/webm;codecs=opus") — сервер такую
  // строку не примет, поэтому параметры отрезаем, а базу валидируем как обычно.
  const base = typeof explicit === "string" ? explicit.split(";")[0]?.trim().toLowerCase() ?? "" : "";
  if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(base) && base.length <= 100) return base;
  return mimeTypeFor(filePath);
}

function mimeTypeFor(filePath: string): string {
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json", ".zip": "application/zip",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav",
    ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
