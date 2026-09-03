import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Кому выдаются мост `window.openCord`, разрешения на медиа и право навигации.
 *
 * Проверять префикс `file://` недостаточно: preload с мостом привязан к
 * `webContents`, а значит действует на ЛЮБУЮ страницу, открытую в этом окне,
 * и CSP есть только внутри `index.html`. При этом клиент сам кладёт на диск
 * контент, присланный сервером (`previewAttachment` пишет видео в каталог
 * предпросмотра и возвращает `file://`-ссылку), поэтому «любой file://» — это
 * «любой файл, который сервер сумел записать пользователю на диск».
 *
 * Доверие выдаётся только конкретным страницам оболочки по точному пути.
 */
export interface TrustedRendererOptions {
  /** Origin dev-сервера Next.js. Если задан, renderer грузится по HTTP, а не с диска. */
  developmentUrl?: string | null;
  /** Абсолютные пути страниц оболочки, которым выдаётся доверие. */
  allowedFiles: readonly string[];
  /** На Windows файловая система регистронезависима, поэтому там сравнение тоже. */
  caseInsensitive?: boolean;
}

/**
 * Ключ сравнения: схема отбрасывается (она уже проверена), а host учитывается —
 * `file://attacker/share/page.html` это UNC-путь на чужую машину, и его pathname
 * совпал бы с локальным. Точечные сегменты (`..`) нормализует сам разбор URL,
 * query и fragment на то, какой это документ, не влияют.
 */
function fileKey(url: URL, caseInsensitive: boolean): string {
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { /* Битое percent-кодирование сравниваем как есть. */ }
  const key = `${url.host}|${pathname}`;
  return caseInsensitive ? key.toLowerCase() : key;
}

export function isTrustedRendererUrl(url: string | null | undefined, options: TrustedRendererOptions): boolean {
  if (!url) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }

  if (options.developmentUrl) {
    try { return parsed.origin === new URL(options.developmentUrl).origin; } catch { return false; }
  }

  if (parsed.protocol !== "file:") return false;
  const caseInsensitive = options.caseInsensitive ?? process.platform === "win32";
  const key = fileKey(parsed, caseInsensitive);
  return options.allowedFiles.some((file) => fileKey(pathToFileURL(path.resolve(file)), caseInsensitive) === key);
}
