// Discord-подобный markdown для сообщений OpenCord (только клиентский рендер).
//
// Сервер передаёт content как есть, протокол не меняется: весь парсинг выполняется
// локально при отображении. HTML никогда не собирается из пользовательского текста —
// рендер идёт React-узлами из строк, поэтому теги вроде <img> остаются текстом.

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "inlineCode"; text: string }
  | { type: "spoiler"; children: InlineNode[] };

export type ContentChunk =
  | { type: "text"; text: string }
  | { type: "codeBlock"; language: string | null; code: string };

const FENCE_PATTERN = /```([^\s`]*)\n?([\s\S]*?)(?:```|$)/g;
const LANGUAGE_PATTERN = /^[a-z0-9][a-z0-9+#.-]{0,31}$/i;
export const MAX_INLINE_DEPTH = 8;

/** Метка языка после ```: только безопасный токен, иначе null (без подписи). */
export function sanitizeCodeLanguage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const token = raw.trim().slice(0, 32);
  return LANGUAGE_PATTERN.test(token) ? token.toLowerCase() : null;
}

/** Режет content на текстовые куски и fenced-блоки. Незакрытый fence — блок до конца. */
export function extractCodeBlocks(content: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let lastIndex = 0;
  FENCE_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(FENCE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) chunks.push({ type: "text", text: content.slice(lastIndex, index) });
    chunks.push({ type: "codeBlock", language: sanitizeCodeLanguage(match[1]), code: (match[2] ?? "").replace(/\n$/, "") });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) chunks.push({ type: "text", text: content.slice(lastIndex) });
  return chunks.filter((chunk) => chunk.type === "codeBlock" || chunk.text.length > 0);
}

const QUOTE_PATTERN = /^\s{0,3}(>+)\s?/;

export interface QuoteGroup {
  depth: number;
  inner: string;
}

/** Глубина цитаты строки по числу `>`; 0 — обычная строка. */
export function quoteDepthOf(line: string): number {
  return QUOTE_PATTERN.exec(line)?.[1]?.length ?? 0;
}

/** Снимает один уровень `>` со строки цитаты (вложенность разбирается рекурсией). */
export function stripQuoteMarker(line: string): string {
  return line.replace(/^\s{0,3}>\s?/, "");
}

/**
 * Группирует строки: подряд идущие цитаты одного «блока» — в QuoteGroup
 * (вложенность разбирается рекурсией по inner), остальное — абзацы.
 */
export function groupQuoteLines(lines: string[]): Array<{ type: "paragraph"; text: string } | { type: "quote"; group: QuoteGroup }> {
  const groups: Array<{ type: "paragraph"; text: string } | { type: "quote"; group: QuoteGroup }> = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      groups.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    const depth = Math.min(...quote.map(quoteDepthOf));
    groups.push({ type: "quote", group: { depth, inner: quote.map(stripQuoteMarker).join("\n") } });
    quote = [];
  };
  for (const line of lines) {
    if (quoteDepthOf(line) > 0) {
      flushParagraph();
      quote.push(line);
    } else if (line.trim() === "") {
      flushParagraph();
      flushQuote();
    } else {
      flushQuote();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushQuote();
  return groups;
}

interface Delimiter {
  token: string;
  kind: "bold" | "italic" | "strike" | "inlineCode" | "spoiler";
}

const DELIMITERS: Delimiter[] = [
  { token: "||", kind: "spoiler" },
  { token: "**", kind: "bold" },
  { token: "~~", kind: "strike" },
  { token: "`", kind: "inlineCode" },
  { token: "*", kind: "italic" },
  { token: "_", kind: "italic" },
];

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/**
 * Инлайн-разбор: спойлеры ||·||, код `·`, жирный **·**, курсив *·* / _·_,
 * зачёркнутый ~~·~~. Маркеры без пары остаются текстом. `_` требует границ
 * слова, чтобы не ломать user_name. В коде вложенности нет, спойлеры не
 * вкладываются друг в друга. Рекурсия ограничена MAX_INLINE_DEPTH.
 */
export function parseInline(text: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;
  while (rest.length > 0) {
    const found = findOpener(rest);
    if (!found) {
      nodes.push({ type: "text", text: rest });
      break;
    }
    if (found.index > 0) nodes.push({ type: "text", text: rest.slice(0, found.index) });
    const after = rest.slice(found.index + found.delimiter.token.length);
    const closer = findCloser(after, found.delimiter);
    if (closer === null || (depth >= MAX_INLINE_DEPTH && found.delimiter.kind !== "inlineCode")) {
      nodes.push({ type: "text", text: found.delimiter.token });
      rest = after;
      continue;
    }
    const inner = after.slice(0, closer);
    const tail = after.slice(closer + found.delimiter.token.length);
    if (found.delimiter.kind === "inlineCode") {
      nodes.push({ type: "inlineCode", text: inner });
    } else if (inner.length === 0) {
      nodes.push({ type: "text", text: `${found.delimiter.token}${found.delimiter.token}` });
    } else {
      nodes.push({ type: found.delimiter.kind, children: parseInline(inner, depth + 1) } as InlineNode);
    }
    rest = tail;
  }
  return mergeTextNodes(nodes);
}

function findOpener(text: string): { delimiter: Delimiter; index: number } | null {
  let best: { delimiter: Delimiter; index: number } | null = null;
  for (const delimiter of DELIMITERS) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(delimiter.token, from);
      if (index < 0) break;
      if (isValidOpener(text, index, delimiter)) {
        if (!best || index < best.index) best = { delimiter, index };
        break;
      }
      from = index + 1;
    }
  }
  return best;
}

function isValidOpener(text: string, index: number, delimiter: Delimiter): boolean {
  if (delimiter.token === "_") {
    if (isWordChar(text[index - 1])) return false;
  }
  if (delimiter.token === "*") {
    const next = text[index + 1];
    if (next === "*" || next === undefined) return false;
  }
  if (delimiter.token === "**") {
    const next = text[index + 2];
    if (next === undefined) return false;
  }
  return true;
}

function findCloser(text: string, delimiter: Delimiter): number | null {
  let from = 0;
  for (;;) {
    const index = text.indexOf(delimiter.token, from);
    if (index < 0) return null;
    if (isValidCloser(text, index, delimiter)) return index;
    from = index + 1;
  }
}

function isValidCloser(text: string, index: number, delimiter: Delimiter): boolean {
  if (delimiter.token === "_") {
    if (isWordChar(text[index + 1])) return false;
  }
  if (delimiter.token === "*") {
    const prev = text[index - 1];
    if (prev === undefined || prev === "*") return false;
  }
  return true;
}

function mergeTextNodes(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    if (node.type === "text" && last?.type === "text") {
      last.text += node.text;
    } else {
      merged.push(node);
    }
  }
  return merged;
}
