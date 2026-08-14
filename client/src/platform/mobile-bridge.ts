// Мобильная реализация OpenCordBridge для Capacitor (Android WebView).
//
// Реализует то же подмножество нативного слоя, что и Electron main + preload:
//   - identity  — Ed25519 через WebCrypto; приватный ключ хранится в Android Keystore
//                 через @aparajita/capacitor-secure-storage (см. docs/mobile-android-prototype.md);
//   - storage   — состояние клиента в localStorage WebView с той же Zod-валидацией,
//                 что и у десктопного ClientStateStore;
//   - attachments — выбор файла через <input type="file">, загрузка/превью через нативный
//                 CapacitorHttp (не подчиняется CORS, как и Node-fetch в Electron main);
//   - server    — probe /health через CapacitorHttp с общей логикой probeOpenCordServer.
//
// Desktop-only поверхности (window, deployment, screenShare, updates) намеренно отсутствуют:
// renderer обращается к ним через window.openCord?.<field>, и отсутствие поля даёт undefined.
// Приватный ключ никогда не покидает устройство: серверу уходит только публичный ключ
// и подпись челленджа. Никакого fallback на незащищённое хранилище нет.

import { CapacitorHttp } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { attachmentSchema, publicKeyFingerprint, type Attachment } from "@opencord/shared";
import { attachmentDownloadRequestSchema, attachmentTransferContextSchema, type AttachmentDownloadRequest, type AttachmentTransferContext } from "@/shared/attachments";
import type { OpenCordBridge, PublicIdentity } from "@/shared/bridge";
import { createDefaultState, parsePersistedState, type PersistedClientState } from "@/shared/state";
import { probeOpenCordServer, type ServerProbeResult } from "@/shared/server-probe";

const IDENTITY_PUBLIC_KEY = "opencord.identity.publicKey";
const IDENTITY_PRIVATE_KEY = "opencord.identity.privateKey";
const IDENTITY_DISCRIMINATOR = "opencord.identity.discriminator";
const STATE_STORAGE_KEY = "opencord.client-state";

const MAX_INLINE_PREVIEW_BYTES = 10 * 1024 * 1024;
const IMAGE_PREVIEW_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

interface StoredIdentity {
  publicKey: string;
  privateKey: string;
  discriminator: string;
}

export type MobileBridge = Omit<OpenCordBridge, "window" | "deployment" | "screenShare" | "updates">;

export function createMobileBridge(): MobileBridge {
  return {
    storage: {
      load: loadState,
      save: (nextState) => saveState(nextState),
      reset: resetState,
    },
    identity: {
      getOrCreate,
      signChallenge,
      reset: resetIdentity,
    },
    attachments: {
      selectAndUpload,
      uploadFile,
      download,
      preview,
      setLatencySensitive: async () => { /* мобильный стек не троттлит передачу вложений */ },
    },
    server: {
      probe,
    },
  };
}

// --- Identity (WebCrypto Ed25519 + Keystore) ------------------------------------------------

async function getOrCreate(): Promise<PublicIdentity> {
  const stored = await loadStoredIdentity();
  if (stored) return publicIdentity(stored.publicKey, stored.discriminator);
  return resetIdentity();
}

async function signChallenge(challenge: unknown): Promise<string> {
  if (typeof challenge !== "string" || challenge.length < 16 || challenge.length > 1_000) throw new Error("Некорректный челлендж");
  let challengeBytes: Uint8Array<ArrayBuffer>;
  try { challengeBytes = base64ToBytes(challenge); } catch { throw new Error("Некорректный челлендж"); }
  if (challengeBytes.length < 16 || challengeBytes.length > 256) throw new Error("Некорректная длина челленджа");
  const stored = await loadStoredIdentity();
  if (!stored) throw new Error("Идентичность отсутствует");
  const privateKey = await importPrivateKey(stored.privateKey);
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, challengeBytes);
  return bytesToBase64(new Uint8Array(signature));
}

async function resetIdentity(): Promise<PublicIdentity> {
  const identity = await createIdentity();
  await SecureStorage.setItem(IDENTITY_PUBLIC_KEY, identity.publicKey);
  await SecureStorage.setItem(IDENTITY_PRIVATE_KEY, identity.privateKey);
  await SecureStorage.setItem(IDENTITY_DISCRIMINATOR, identity.discriminator);
  return publicIdentity(identity.publicKey, identity.discriminator);
}

async function loadStoredIdentity(): Promise<StoredIdentity | null> {
  const publicKey = await SecureStorage.getItem(IDENTITY_PUBLIC_KEY);
  const privateKey = await SecureStorage.getItem(IDENTITY_PRIVATE_KEY);
  if (!isKeyPayload(publicKey) || !isKeyPayload(privateKey)) return null;
  let discriminator = await SecureStorage.getItem(IDENTITY_DISCRIMINATOR);
  // Идентичность, созданная до появления дискриминатора: до-генерируем, не трогая ключи.
  if (!isDiscriminator(discriminator)) {
    discriminator = randomDiscriminator();
    await SecureStorage.setItem(IDENTITY_DISCRIMINATOR, discriminator);
  }
  return { publicKey, privateKey, discriminator };
}

function isDiscriminator(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}$/u.test(value);
}

function isKeyPayload(value: string | null): value is string {
  // Ограничения повторяют auth.respond в shared/protocol.ts (40..1000 символов base64).
  return typeof value === "string" && value.length >= 40 && value.length <= 1_000 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

async function createIdentity(): Promise<StoredIdentity> {
  let pair: CryptoKeyPair;
  try {
    pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  } catch {
    throw new Error("Устройство не поддерживает Ed25519 в WebCrypto");
  }
  const publicKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)));
  const privateKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
  return { publicKey, privateKey, discriminator: randomDiscriminator() };
}

/** Дискриминатор тега username#1234 — ровно 4 цифры, генерируется вместе с ключами. */
function randomDiscriminator(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String((values[0] ?? 0) % 10_000).padStart(4, "0");
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("pkcs8", base64ToBytes(privateKey), { name: "Ed25519" }, false, ["sign"]);
  } catch {
    throw new Error("Не удалось прочитать приватный ключ");
  }
}

async function publicIdentity(publicKey: string, discriminator: string): Promise<PublicIdentity> {
  // Отпечаток считается общим алгоритмом из @opencord/shared: SHA-256 от SPKI DER,
  // группы по 4 hex-символа. Сервер возвращает тот же код для этого пользователя.
  const fingerprint = await publicKeyFingerprint(publicKey);
  return { publicKey, fingerprint, discriminator };
}

// --- Состояние клиента (localStorage + Zod) ------------------------------------------------

async function loadState(): Promise<PersistedClientState> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STATE_STORAGE_KEY); } catch { raw = null; }
  if (raw === null) {
    const initial = createDefaultState();
    await saveState(initial);
    return initial;
  }
  try {
    return parsePersistedState(JSON.parse(raw) as unknown);
  } catch {
    const fallback = createDefaultState();
    await saveState(fallback);
    return fallback;
  }
}

async function saveState(input: unknown): Promise<PersistedClientState> {
  const state = parsePersistedState(input);
  localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  return state;
}

async function resetState(): Promise<PersistedClientState> {
  return saveState(createDefaultState());
}

// --- Вложения (выбор файла + нативный HTTP) ------------------------------------------------

async function selectAndUpload(contextInput: AttachmentTransferContext): Promise<Attachment | null> {
  const context = attachmentTransferContextSchema.parse(contextInput);
  const file = await pickFile();
  if (!file) return null;
  return uploadMobileFile(context, file);
}

/** Загрузка конкретного файла (вставка Ctrl+V, drag&drop) — тот же нативный HTTP-путь. */
async function uploadFile(contextInput: AttachmentTransferContext, file: File): Promise<Attachment> {
  const context = attachmentTransferContextSchema.parse(contextInput);
  return uploadMobileFile(context, file);
}

async function uploadMobileFile(context: AttachmentTransferContext, file: File): Promise<Attachment> {
  if (file.size < 1) throw new Error("Выбран пустой файл или не обычный файл");
  if (context.maxAttachmentBytes !== null && file.size > context.maxAttachmentBytes) throw new Error(`Файл превышает лимит ${Math.floor(context.maxAttachmentBytes / 1024 / 1024)} МБ`);
  const response = await CapacitorHttp.post({
    url: attachmentUrl(context.serverAddress),
    headers: {
      authorization: `Bearer ${context.sessionToken}`,
      "content-type": "application/octet-stream",
      "x-opencord-file-name": base64UrlEncode(file.name),
      "x-opencord-mime-type": mimeTypeFor(file.name, file.type),
    },
    data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    dataType: "file",
    connectTimeout: 10_000,
    readTimeout: 60_000,
  });
  if (response.status !== 201) throw new Error(serverAttachmentError(response.status, response.data));
  return attachmentSchema.parse(responsePayload(response.data));
}

async function download(requestInput: AttachmentDownloadRequest): Promise<boolean> {
  // Валидация зеркалит десктопный обработчик (IPC attachmentDownload); сам запрос не выполняется.
  attachmentDownloadRequestSchema.parse(requestInput);
  // v1 прототипа: сохранение файлов на диск не реализовано (см. docs/mobile-android-prototype.md).
  throw new Error("Скачивание вложений недоступно в мобильной версии");
}

async function preview(requestInput: AttachmentDownloadRequest): Promise<string> {
  const request = attachmentDownloadRequestSchema.parse(requestInput);
  if (!IMAGE_PREVIEW_TYPES.has(request.attachment.mimeType)) {
    throw new Error(["video/mp4", "video/webm", "video/ogg"].includes(request.attachment.mimeType)
      ? "Предпросмотр видео недоступен в мобильной версии"
      : "Предпросмотр этого типа файла недоступен");
  }
  if (request.attachment.sizeBytes > MAX_INLINE_PREVIEW_BYTES) throw new Error("Предпросмотр изображений больше 10 МБ недоступен");
  const response = await CapacitorHttp.get({
    url: attachmentUrl(request.serverAddress, request.attachment.id),
    headers: { authorization: `Bearer ${request.sessionToken}` },
    responseType: "arraybuffer",
    connectTimeout: 10_000,
    readTimeout: 60_000,
  });
  if (response.status !== 200) throw new Error(serverAttachmentError(response.status, response.data));
  const base64 = String(response.data);
  const contents = base64ToBytes(base64);
  if (contents.length !== request.attachment.sizeBytes) throw new Error("Размер медиафайла не совпадает с метаданными");
  const digest = await crypto.subtle.digest("SHA-256", contents);
  if (bytesToHex(new Uint8Array(digest)) !== request.attachment.sha256) throw new Error("Контрольная сумма медиафайла не совпадает");
  return `data:${request.attachment.mimeType};base64,${base64}`;
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    let settled = false;
    const cleanup = (): void => {
      window.removeEventListener("focus", onFocus);
      input.remove();
    };
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };
    // Возврат фокуса происходит и после выбора, и после отмены; после выбора сначала
    // срабатывает onchange, поэтому отложенный finish(null) по фокусу означает отмену.
    const onFocus = (): void => { window.setTimeout(() => finish(null), 400); };
    input.onchange = () => finish(input.files?.[0] ?? null);
    input.onerror = () => { cleanup(); reject(new Error("Не удалось открыть выбор файла")); };
    document.body.appendChild(input);
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

function attachmentUrl(serverAddress: string, attachmentId?: string): string {
  const url = new URL(serverAddress);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Некорректный адрес сервера");
  url.pathname = attachmentId ? `/api/attachments/${encodeURIComponent(attachmentId)}` : "/api/attachments";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function responsePayload(data: unknown): unknown {
  return typeof data === "string" ? (JSON.parse(data) as unknown) : data;
}

function serverAttachmentError(status: number, data: unknown): string {
  try {
    const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
    if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
      return `Сервер отклонил файл (${status}): ${payload.error}`;
    }
  } catch { /* не-JSON ответ */ }
  return `Сервер отклонил операцию с файлом (${status})`;
}

// --- Проверка сервера ------------------------------------------------------------------------

async function probe(address: string): Promise<ServerProbeResult> {
  return probeOpenCordServer(address, capacitorHealthFetch);
}

async function capacitorHealthFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  void init; // таймауты и redirect задаются опциями CapacitorHttp ниже
  const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let response: Awaited<ReturnType<typeof CapacitorHttp.get>>;
  try {
    response = await CapacitorHttp.get({
      url: target,
      headers: { accept: "application/json" },
      connectTimeout: 5_000,
      readTimeout: 8_000,
      responseType: "text",
    });
  } catch {
    throw new Error("Server unreachable");
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    if (typeof value === "string") headers.set(name, value);
  }
  const body = response.data === null || response.data === undefined ? "" : typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  return new Response(body, { status: response.status, headers });
}

// --- Кодирование -----------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 === 1) throw new Error("Некорректные данные в формате base64");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64UrlEncode(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function mimeTypeFor(fileName: string, fallbackType: string): string {
  const extension = `.${fileName.split(".").at(-1)?.toLowerCase() ?? ""}`;
  const byExtension: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json", ".zip": "application/zip",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".ogv": "video/ogg",
  };
  const known = byExtension[extension];
  if (known) return known;
  return fallbackType && fallbackType !== "application/octet-stream" ? fallbackType : "application/octet-stream";
}
