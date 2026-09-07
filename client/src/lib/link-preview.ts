import { extractCodeBlocks, parseInline, type InlineNode } from "@/lib/message-markdown";

export const LINK_PREVIEW_TIMEOUT_MS = 5_000 as const;
export const LINK_PREVIEW_MAX_BYTES = 131_072 as const;
export const LINK_PREVIEW_MAX_URLS = 3 as const;
export const LINK_PREVIEW_TITLE_MAX_LENGTH = 140 as const;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\]]+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const OG_TITLE_BEFORE = /<meta\b[^>]*\bproperty=["']og:title["'][^>]*>/iu;
const OG_TITLE_AFTER = /<meta\b[^>]*\bcontent=(["'])([\s\S]*?)\1[^>]*\bproperty=["']og:title["'][^>]*>/iu;
const CONTENT_ATTRIBUTE = /\bcontent=(["'])([\s\S]*?)\1/iu;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu;

function inlineTextParts(nodes: InlineNode[], parts: string[]): void {
  for (const node of nodes) {
    if (node.type === "text") parts.push(node.text);
    else if (node.type === "inlineCode") continue;
    else parts.push(...collectInlineText(node.children));
  }
}

function collectInlineText(nodes: InlineNode[]): string[] {
  const parts: string[] = [];
  inlineTextParts(nodes, parts);
  return parts;
}

function cleanCandidate(raw: string): string | null {
  const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getLinkDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function isDirectImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const segment = parsed.pathname.split("/").pop() ?? "";
  const extension = segment.split(".").pop()?.toLowerCase().split(/[^a-z0-9]/u)[0] ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export function extractMessageUrls(content: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const chunk of extractCodeBlocks(content)) {
    if (chunk.type !== "text") continue;
    for (const part of collectInlineText(parseInline(chunk.text))) {
      URL_PATTERN.lastIndex = 0;
      for (const match of part.matchAll(URL_PATTERN)) {
        const cleaned = cleanCandidate(match[0]);
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        found.push(cleaned);
        if (found.length >= LINK_PREVIEW_MAX_URLS) return found;
      }
    }
  }
  return found;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&(amp|lt|gt|quot|apos|#39);/giu, (_, name: string) => {
      switch (name.toLowerCase()) {
        case "amp": return "&";
        case "lt": return "<";
        case "gt": return ">";
        case "quot": return '"';
        default: return "'";
      }
    })
    .replace(/&#(\d{1,7});/gu, (_, digits: string) => {
      const point = Number(digits);
      return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-f]{1,6});/giu, (_, digits: string) => {
      const point = parseInt(digits, 16);
      return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    });
}

function normalizeTitle(raw: string): string | null {
  const title = decodeEntities(raw).replace(/\s+/gu, " ").trim().slice(0, LINK_PREVIEW_TITLE_MAX_LENGTH).trim();
  return title || null;
}

export function parseLinkTitle(html: string): string | null {
  const head = html.slice(0, LINK_PREVIEW_MAX_BYTES);
  const direct = OG_TITLE_BEFORE.exec(head);
  if (direct) {
    const title = normalizeTitle(CONTENT_ATTRIBUTE.exec(direct[0])?.[2] ?? "");
    if (title) return title;
  }
  const reversed = OG_TITLE_AFTER.exec(head);
  if (reversed) {
    const title = normalizeTitle(reversed[2] ?? "");
    if (title) return title;
  }
  const tag = TITLE_TAG.exec(head);
  if (tag) {
    const title = normalizeTitle(tag[1] ?? "");
    if (title) return title;
  }
  return null;
}

async function readBounded(response: Response, cap: number): Promise<string> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (body?.getReader) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
        if (total > cap) break;
      }
    } finally {
      try { await reader.cancel(); } catch { /* already closed */ }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
    const merged = new Uint8Array(Math.min(total, cap + 1024));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= merged.length) break;
      merged.set(chunk.subarray(0, merged.length - offset), offset);
      offset += Math.min(chunk.length, merged.length - offset);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(merged.subarray(0, offset));
  }
  return (await response.text()).slice(0, cap);
}

export async function fetchLinkPreviewTitle(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string | null> {
  if (!isHttpUrl(url) || isDirectImageUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer" });
    if (!response.ok) return null;
    const contentType = response.headers?.get("content-type") ?? "";
    if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/iu.test(contentType.split(";")[0] ?? "")) return null;
    const length = Number(response.headers?.get("content-length") ?? "");
    if (Number.isFinite(length) && length > LINK_PREVIEW_MAX_BYTES * 4) return null;
    return parseLinkTitle(await readBounded(response, LINK_PREVIEW_MAX_BYTES));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
