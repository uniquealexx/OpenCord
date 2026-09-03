/**
 * Пост-обработка статического экспорта: замена `script-src 'unsafe-inline'` на
 * список sha256-хешей реально присутствующих inline-скриптов.
 *
 * Зачем: renderer грузится с `file://` и держит мост `window.openCord` (подпись
 * идентичности, SSH-деплой, загрузка вложений), а разрешение `media` выдаётся ему
 * молча. `'unsafe-inline'` снимал главную защиту именно от инъекции в renderer,
 * ради которой CSP и добавлялась. Nonce тут невозможен — политика лежит в `<meta>`
 * статического файла, одинакового для всех запусков, — поэтому используются хеши.
 *
 * Хешируется содержимое тега после нормализации переводов строк: HTML-парсер
 * приводит `\r\n` и одиночный `\r` к `\n` ещё до токенизации, поэтому браузер
 * считает хеш от текста с `\n`. Без этого шага файл с CRLF (`public/update.html`)
 * получает хеш, который не совпадёт, и скрипт блокируется. Файлы без
 * inline-скриптов остаются без изменений; inline-обработчики событий
 * (`onclick=…`) хешами не покрываются, поэтому их появление — ошибка сборки.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
const CSP_META = /<meta\b[^>]*\bhttp-equiv=(["'])Content-Security-Policy\1[^>]*>/iu;
const CONTENT_ATTRIBUTE = /\bcontent=(["'])([\s\S]*?)\1/iu;
const INLINE_EVENT_HANDLER = /\son[a-z]+\s*=\s*["']/iu;

/** `&#x27;` в атрибуте `content` — результат экранирования React, до правки политику надо развернуть. */
function decodeAttribute(value) {
  return value
    .replace(/&#x27;/giu, "'")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&amp;/giu, "&");
}

function encodeAttribute(value) {
  return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/'/gu, "&#x27;");
}

/** Нормализация переводов строк по правилам HTML-парсера: CRLF и одиночный CR становятся LF. */
function normalizeNewlines(body) {
  return body.replace(/\r\n?/gu, "\n");
}

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const [, attributes = "", body = ""] = match;
    if (/\bsrc\s*=/iu.test(attributes)) continue;
    const hash = `sha256-${createHash("sha256").update(normalizeNewlines(body), "utf8").digest("base64")}`;
    if (!hashes.includes(hash)) hashes.push(hash);
  }
  return hashes;
}

export function hardenScriptSrc(policy, hashes) {
  const directives = policy.split(";").map((directive) => directive.trim()).filter(Boolean);
  const index = directives.findIndex((directive) => /^script-src(?:\s|$)/iu.test(directive));
  if (index === -1) throw new Error("В политике нет директивы script-src");
  // `'none'` в исходной политике означает «никаких скриптов»; вместе с хешами он
  // недопустим и в разных браузерах разбирается по-разному, поэтому убирается.
  const sources = directives[index].split(/\s+/u).slice(1)
    .filter((source) => source !== "'unsafe-inline'")
    .filter((source) => hashes.length === 0 || source !== "'none'");
  for (const hash of hashes) if (!sources.includes(`'${hash}'`)) sources.push(`'${hash}'`);
  directives[index] = ["script-src", ...sources].join(" ");
  return directives.join("; ");
}

export function hardenHtmlCsp(html, fileLabel = "html") {
  const hashes = inlineScriptHashes(html);
  const meta = CSP_META.exec(html);
  if (!meta) {
    if (hashes.length) throw new Error(`${fileLabel}: inline-скрипт без meta Content-Security-Policy`);
    return { html, hashes: [] };
  }
  if (INLINE_EVENT_HANDLER.test(html)) throw new Error(`${fileLabel}: inline-обработчик события нельзя покрыть хешем CSP`);
  const content = CONTENT_ATTRIBUTE.exec(meta[0]);
  if (!content) throw new Error(`${fileLabel}: у meta Content-Security-Policy нет атрибута content`);
  const hardened = hardenScriptSrc(decodeAttribute(content[2]), hashes);
  const nextMeta = meta[0].replace(content[0], `content="${encodeAttribute(hardened)}"`);
  return { html: html.replace(meta[0], nextMeta), hashes };
}

async function* htmlFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(entryPath);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield entryPath;
  }
}

async function main() {
  const outDirectory = path.resolve(import.meta.dirname, "..", "out");
  let processed = 0;
  for await (const file of htmlFiles(outDirectory)) {
    const label = path.relative(outDirectory, file);
    const source = await readFile(file, "utf8");
    const { html, hashes } = hardenHtmlCsp(source, label);
    if (html === source) continue;
    await writeFile(file, html, "utf8");
    processed += 1;
    console.info(`CSP: ${label} — inline-скриптов захешировано: ${hashes.length}`);
  }
  if (!processed) throw new Error("Не найдено ни одного HTML с политикой для усиления — экспорт неполный?");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
