// Упоминания пользователей и код идентичности.
//
// В тексте сообщения упоминание хранится как маркер <@userId> (как в Discord), а список
// реально применённых упоминаний передаётся отдельным полем mentions и проверяется сервером.
// Так упоминания переживают переименования: рендер резолвится по userId, а не по тексту.
//
// Код идентичности — SHA-256 отпечаток публичного SPKI-ключа в формате XXXX-XXXX-XXXX-XXXX.
// Он уникален для каждой пары ключей и позволяет отличить двух пользователей с одинаковым
// тегом username#1234. Реализован через WebCrypto, поэтому работает и в браузере,
// и в Electron main, и в Node-сервере — клиент и сервер вычисляют одинаковые коды.

export const MENTION_TOKEN_PATTERN = /<@([A-Za-z0-9_-]{1,64})>/gu;

export function buildMentionToken(userId: string): string {
  return `<@${userId}>`;
}

/** Возвращает уникальные userId из маркеров <@userId> в тексте, сохраняя порядок первого появления. */
export function parseMentionTokens(content: string): string[] {
  const ids: string[] = [];
  for (const match of content.matchAll(MENTION_TOKEN_PATTERN)) {
    const userId = match[1]!;
    if (!ids.includes(userId)) ids.push(userId);
  }
  return ids;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** SHA-256 отпечаток публичного ключа (SPKI DER, base64) в формате XXXX-XXXX-XXXX-XXXX. */
export async function publicKeyFingerprint(publicKey: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", base64ToBytes(publicKey));
  return bytesToHex(new Uint8Array(digest)).match(/.{1,4}/gu)?.slice(0, 4).join("-") ?? "unknown";
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  // Реальные ключи — корректный base64 (SPKI DER). Декодируем снисходительно, чтобы
  // случайные или тестовые строки не роняли список участников: отпечаток всё равно
  // детерминирован, а для настоящих ключей результат совпадает с клиентом.
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/").replace(/[^A-Za-z0-9+/]/gu, "");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
  }
}
