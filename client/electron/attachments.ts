import { createReadStream, createWriteStream } from "node:fs";
import { stat, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { attachmentSchema, type Attachment } from "@opencord/shared";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function uploadAttachment(filePath: string, serverAddress: string, sessionToken: string): Promise<Attachment> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < 1) throw new Error("Выбран пустой файл или не обычный файл");
  if (info.size > MAX_ATTACHMENT_BYTES) throw new Error("Файл превышает лимит 10 МБ");
  const endpoint = attachmentUrl(serverAddress);
  const { response, outgoing } = openRequest(endpoint, "POST", {
    authorization: `Bearer ${sessionToken}`,
    "content-type": "application/octet-stream",
    "content-length": String(info.size),
    "x-opencord-file-name": Buffer.from(path.basename(filePath), "utf8").toString("base64url"),
    "x-opencord-mime-type": mimeTypeFor(filePath),
  });
  const responsePromise = response;
  await pipeline(createReadStream(filePath), outgoing);
  const incoming = await responsePromise;
  const payload = await readResponse(incoming);
  if (incoming.statusCode !== 201) throw new Error(serverError(incoming.statusCode, payload));
  return attachmentSchema.parse(JSON.parse(payload));
}

export async function downloadAttachment(serverAddress: string, sessionToken: string, attachment: Attachment, destination: string): Promise<void> {
  const endpoint = attachmentUrl(serverAddress, attachment.id);
  const { response, outgoing } = openRequest(endpoint, "GET", { authorization: `Bearer ${sessionToken}` });
  outgoing.end();
  const incoming = await response;
  if (incoming.statusCode !== 200) throw new Error(serverError(incoming.statusCode, await readResponse(incoming)));
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${destination}.${randomUUID()}.replaced`;
  let written = 0;
  const hash = createHash("sha256");
  incoming.on("data", (chunk: Buffer) => {
    written += chunk.length;
    hash.update(chunk);
    if (written > MAX_ATTACHMENT_BYTES) incoming.destroy(new Error("Сервер прислал слишком большой файл"));
  });
  try {
    await pipeline(incoming, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
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
}

export async function previewAttachment(serverAddress: string, sessionToken: string, attachment: Attachment): Promise<string> {
  if (!new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "video/ogg"]).has(attachment.mimeType)) throw new Error("Предпросмотр этого типа файла недоступен");
  const endpoint = attachmentUrl(serverAddress, attachment.id);
  const { response, outgoing } = openRequest(endpoint, "GET", { authorization: `Bearer ${sessionToken}` });
  outgoing.end();
  const incoming = await response;
  if (incoming.statusCode !== 200) throw new Error(serverError(incoming.statusCode, await readResponse(incoming)));
  const contents = await readBinaryResponse(incoming);
  if (contents.length !== attachment.sizeBytes) throw new Error("Размер медиафайла не совпадает с метаданными");
  if (createHash("sha256").update(contents).digest("hex") !== attachment.sha256) throw new Error("Контрольная сумма медиафайла не совпадает");
  return `data:${attachment.mimeType};base64,${contents.toString("base64")}`;
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

async function readBinaryResponse(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_ATTACHMENT_BYTES) throw new Error("Сервер прислал слишком большой медиафайл");
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

function mimeTypeFor(filePath: string): string {
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json", ".zip": "application/zip",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
  } as Record<string, string>)[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
