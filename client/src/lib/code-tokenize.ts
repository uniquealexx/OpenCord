// Мини-токенизатор кода для подсветки fenced-блоков сообщений.
//
// Намеренно без зависимостей (никаких highlight.js/prismjs): простая
// regex-машина по строкам, которая умеет ровно то, что нужно чату — комментарии,
// строки, числа, ключевые слова и встроенные имена. Модуль полностью чистый:
// ни DOM, ни React, поэтому юнит-тесты выполняются мгновенно.
//
// Токенизация идёт построчно, но состояние (многострочные строки, блочные
// комментарии /* */ и <!-- -->) переносится между строками. Склейка текстов
// всех токенов в точности восстанавливает исходный код — рендер не теряет
// символы и не добавляет свои.

export type CodeTokenType = "comment" | "string" | "number" | "keyword" | "builtin" | "punct" | "plain";

export interface CodeToken {
  type: CodeTokenType;
  text: string;
}

/** Блоки длиннее этого предела не подсвечиваются — защита от затратной работы. */
export const MAX_HIGHLIGHT_LENGTH = 50_000;

interface BlockCommentRule {
  start: string;
  end: string;
}

interface StringRule {
  open: string;
  close: string;
  escape: boolean;
  multiline: boolean;
}

interface LanguageConfig {
  lineComments: readonly string[];
  /** Для `#`-языков: комментарий только в начале слова (не внутри `foo#bar`). */
  lineCommentBoundary: boolean;
  blockComments: readonly BlockCommentRule[];
  strings: readonly StringRule[];
  keywords: ReadonlySet<string>;
  builtins: ReadonlySet<string>;
  /** SQL/HTML/YAML пишут ключевые слова в разном регистре. */
  keywordInsensitive: boolean;
  /** CSS/HTML: дефис — часть имени (`background-color`, `my-tag`). */
  identifierDash: boolean;
}

function words(source: string): ReadonlySet<string> {
  return new Set(source.split(/\s+/).filter((word) => word.length > 0));
}

function defineLanguage(input: {
  lineComments?: readonly string[];
  lineCommentBoundary?: boolean;
  blockComments?: readonly BlockCommentRule[];
  strings?: readonly StringRule[];
  keywords: string;
  builtins?: string;
  keywordInsensitive?: boolean;
  identifierDash?: boolean;
}): LanguageConfig {
  return {
    lineComments: input.lineComments ?? [],
    lineCommentBoundary: input.lineCommentBoundary ?? false,
    blockComments: input.blockComments ?? [],
    // Длинные открывающие кавычки (Python `"""`) проверяются раньше коротких.
    strings: [...(input.strings ?? [])].sort((a, b) => b.open.length - a.open.length),
    keywords: words(input.keywords),
    builtins: words(input.builtins ?? ""),
    keywordInsensitive: input.keywordInsensitive ?? false,
    identifierDash: input.identifierDash ?? false,
  };
}

const DOUBLE = (escape = true, multiline = false): StringRule => ({ open: '"', close: '"', escape, multiline });
const SINGLE = (escape = true, multiline = false): StringRule => ({ open: "'", close: "'", escape, multiline });
const BACKTICK: StringRule = { open: "`", close: "`", escape: true, multiline: true };
const BLOCK = (start: string, end: string): BlockCommentRule => ({ start, end });

const JS_KEYWORDS =
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield async await as from of type namespace declare readonly abstract satisfies keyof infer is asserts override get set unknown never any string number boolean object symbol bigint";

const JS_BUILTINS =
  "console Math JSON Object Array String Number Boolean Symbol BigInt Map Set WeakMap WeakSet Date RegExp Error TypeError RangeError Promise Proxy Reflect Intl globalThis window document process require module exports NaN Infinity parseInt parseFloat isNaN isFinite setTimeout setInterval clearTimeout clearInterval fetch queueMicrotask structuredClone";

const PYTHON_KEYWORDS =
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case";

const PYTHON_BUILTINS =
  "print len range str int float bool list dict set tuple frozenset bytes bytearray object type super isinstance issubclass enumerate zip map filter reduce sum min max abs round sorted reversed any all open input format repr hash id iter next getattr setattr hasattr delattr callable globals locals vars dir help self cls";

const JSON_KEYWORDS = "true false null";

const HTML_KEYWORDS =
  "html head body div span script style link meta title a p img ul ol li table tr td th thead tbody tfoot form input button select option textarea label h1 h2 h3 h4 h5 h6 section article header footer nav main aside pre code br hr iframe canvas svg path template slot strong em b i u small blockquote figure figcaption video audio source track picture";

const HTML_BUILTINS =
  "class id href src alt type value name style rel target placeholder disabled checked selected readonly required for role aria-label data- width height action method";

const CSS_KEYWORDS = "important media supports keyframes font-face import charset page layer container property scope starting-style";

const CSS_BUILTINS =
  "color background background-color display position margin margin-top margin-bottom margin-left margin-right padding padding-top padding-right padding-bottom padding-left border border-color border-radius border-width font font-family font-size font-weight font-style line-height width height min-width max-width max-height flex flex-direction align-items justify-content gap grid grid-template-columns grid-template-rows grid-column grid-row transition transform translate rotate scale opacity z-index top right bottom left overflow overflow-x overflow-y cursor content box-shadow text-align text-decoration text-transform letter-spacing white-space vertical-align visibility pointer-events user-select";

const BASH_KEYWORDS = "if then else elif fi for while until do done case esac in function select time coproc";

const BASH_BUILTINS =
  "echo printf read cd pwd ls cp mv rm mkdir rmdir touch cat grep sed awk find chmod chown export local return exit source test set unset shift eval exec true false alias unalias umask kill wait trap type which curl wget git docker sudo apt apt-get npm node pnpm python python3";

const SQL_KEYWORDS =
  "select from where insert into values update set delete create table index view drop alter add column primary key foreign references not null default unique join inner left right outer full cross on group by order having limit offset union all distinct as and or in exists between like is case when then else end begin commit rollback transaction database schema grant revoke with recursive asc desc returning using natural except intersect truncate constraint cascade restrict";

const SQL_BUILTINS =
  "count sum avg min max now current_date current_timestamp coalesce nullif greatest least length lower upper trim substring concat cast";

const GO_KEYWORDS = "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var";

const GO_BUILTINS =
  "true false nil iota append cap clear close complex copy delete imag len make max min new panic print println real recover bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any comparable";

const RUST_KEYWORDS =
  "as break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await abstract become box do final macro override priv try typeof unsized virtual yield";

const RUST_BUILTINS =
  "String Vec Option Result Some None Ok Err Box Rc Arc RefCell Mutex HashMap HashSet BTreeMap BTreeSet println print eprintln eprint format vec panic assert assert_eq assert_ne debug_assert todo unimplemented unreachable write writeln read drop clone into from new default to_string to_owned as_ref as_mut iter into_iter map filter collect unwrap expect";

const JAVA_KEYWORDS =
  "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null";

const JAVA_BUILTINS =
  "System String Integer Double Float Long Boolean Character Object Math List ArrayList Map HashMap Set HashSet Optional Stream Collectors Objects Arrays Collections Exception RuntimeException IllegalArgumentException Thread Runnable StringBuilder out";

const CPP_KEYWORDS =
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override final new delete this nullptr true false using try catch throw constexpr noexcept static_cast dynamic_cast reinterpret_cast const_cast operator friend explicit mutable wchar_t char8_t char16_t char32_t bool alignas alignof decltype thread_local consteval constinit co_await co_return co_yield";

const CPP_BUILTINS =
  "printf fprintf sprintf snprintf scanf malloc calloc realloc free memcpy memset strlen strcpy strcmp std cout cin cerr endl string vector map set unordered_map unordered_set pair make_pair unique_ptr shared_ptr weak_ptr move forward size_t int32_t int64_t uint32_t uint64_t NULL stdin stdout stderr";

const YAML_KEYWORDS = "true false null yes no on off";

const LANGUAGE_CONFIGS: Readonly<Record<string, LanguageConfig>> = {
  js: defineLanguage({
    lineComments: ["//"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), SINGLE(), BACKTICK],
    keywords: JS_KEYWORDS,
    builtins: JS_BUILTINS,
  }),
  python: defineLanguage({
    lineComments: ["#"],
    strings: [
      { open: '"""', close: '"""', escape: true, multiline: true },
      { open: "'''", close: "'''", escape: true, multiline: true },
      DOUBLE(),
      SINGLE(),
    ],
    keywords: PYTHON_KEYWORDS,
    builtins: PYTHON_BUILTINS,
  }),
  json: defineLanguage({
    strings: [DOUBLE()],
    keywords: JSON_KEYWORDS,
  }),
  html: defineLanguage({
    blockComments: [BLOCK("<!--", "-->")],
    strings: [DOUBLE(false, true), SINGLE(false, true)],
    keywords: HTML_KEYWORDS,
    builtins: HTML_BUILTINS,
    keywordInsensitive: true,
    identifierDash: true,
  }),
  css: defineLanguage({
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), SINGLE()],
    keywords: CSS_KEYWORDS,
    builtins: CSS_BUILTINS,
    keywordInsensitive: true,
    identifierDash: true,
  }),
  bash: defineLanguage({
    lineComments: ["#"],
    lineCommentBoundary: true,
    strings: [DOUBLE(), SINGLE(false), BACKTICK],
    keywords: BASH_KEYWORDS,
    builtins: BASH_BUILTINS,
  }),
  sql: defineLanguage({
    lineComments: ["--"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [SINGLE()],
    keywords: SQL_KEYWORDS,
    builtins: SQL_BUILTINS,
    keywordInsensitive: true,
  }),
  go: defineLanguage({
    lineComments: ["//"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), BACKTICK, SINGLE()],
    keywords: GO_KEYWORDS,
    builtins: GO_BUILTINS,
  }),
  rust: defineLanguage({
    lineComments: ["//"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), SINGLE()],
    keywords: RUST_KEYWORDS,
    builtins: RUST_BUILTINS,
  }),
  java: defineLanguage({
    lineComments: ["//"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), SINGLE()],
    keywords: JAVA_KEYWORDS,
    builtins: JAVA_BUILTINS,
  }),
  cpp: defineLanguage({
    lineComments: ["//"],
    blockComments: [BLOCK("/*", "*/")],
    strings: [DOUBLE(), SINGLE()],
    keywords: CPP_KEYWORDS,
    builtins: CPP_BUILTINS,
  }),
  yaml: defineLanguage({
    lineComments: ["#"],
    lineCommentBoundary: true,
    strings: [DOUBLE(), SINGLE()],
    keywords: YAML_KEYWORDS,
    keywordInsensitive: true,
  }),
};

// Неизвестный язык не оставляет код серым: подставляем нейтральную generic-схему,
// которая всё равно ловит комментарии, строки и числа.
const GENERIC_CONFIG = defineLanguage({
  lineComments: ["//", "#"],
  lineCommentBoundary: true,
  blockComments: [BLOCK("/*", "*/")],
  strings: [DOUBLE(), SINGLE(), BACKTICK],
  keywords: "",
});

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  javascript: "js", js: "js", mjs: "js", cjs: "js", jsx: "js", node: "js",
  typescript: "js", ts: "js", tsx: "js",
  py: "python", python: "python", python3: "python",
  json: "json", jsonc: "json",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", less: "css",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash", shellscript: "bash",
  sql: "sql", postgres: "sql", postgresql: "sql", mysql: "sql", sqlite: "sql",
  go: "go", golang: "go",
  rs: "rust", rust: "rust",
  java: "java", kotlin: "java",
  c: "cpp", cpp: "cpp", "c++": "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp",
  yml: "yaml", yaml: "yaml",
};

function resolveConfig(language: string | null): LanguageConfig {
  if (!language) return GENERIC_CONFIG;
  const group = LANGUAGE_ALIASES[language.toLowerCase()];
  if (!group) return GENERIC_CONFIG;
  return LANGUAGE_CONFIGS[group] ?? GENERIC_CONFIG;
}

interface ScanState {
  kind: "normal" | "blockComment" | "string";
  end: string;
  escape: boolean;
}

const NORMAL_STATE: ScanState = { kind: "normal", end: "", escape: false };

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/y;
const IDENTIFIER_DASH_RE = /[A-Za-z_-][A-Za-z0-9_-]*/y;
const NUMBER_RE = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/y;
const IDENTIFIER_START_RE = /[A-Za-z_$]/;
const DIGIT_RE = /[0-9]/;
const WHITESPACE_RE = /\s/;
const PUNCT_CHARS = new Set("{}()[],;.<>+-*/%=!&|^~?:#@\\");

/** Sticky-regex матч ровно в позиции `index` — без slice и без O(n²) на длинных строках. */
function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index;
  const match = pattern.exec(text);
  return match ? match[0] : null;
}

function scanLine(text: string, state: ScanState, config: LanguageConfig): { tokens: CodeToken[]; state: ScanState } {
  const tokens: CodeToken[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain.length > 0) {
      tokens.push({ type: "plain", text: plain });
      plain = "";
    }
  };
  const push = (type: CodeTokenType, value: string): void => {
    flush();
    if (value.length > 0) tokens.push({ type, text: value });
  };

  let cursor = 0;
  let current = state;

  while (cursor < text.length) {
    if (current.kind === "blockComment") {
      const close = text.indexOf(current.end, cursor);
      if (close < 0) {
        push("comment", text.slice(cursor));
        cursor = text.length;
        break;
      }
      push("comment", text.slice(cursor, close + current.end.length));
      cursor = close + current.end.length;
      current = NORMAL_STATE;
      continue;
    }

    if (current.kind === "string") {
      const close = current.end;
      let scan = cursor;
      let closed = false;
      while (scan < text.length) {
        if (current.escape && text.charAt(scan) === "\\") {
          scan += 2;
          continue;
        }
        if (text.startsWith(close, scan)) {
          closed = true;
          break;
        }
        scan += 1;
      }
      if (closed) {
        push("string", text.slice(cursor, scan + close.length));
        cursor = scan + close.length;
        current = NORMAL_STATE;
      } else {
        push("string", text.slice(cursor));
        cursor = text.length;
      }
      continue;
    }

    let handled = false;

    for (const block of config.blockComments) {
      if (!text.startsWith(block.start, cursor)) continue;
      const close = text.indexOf(block.end, cursor + block.start.length);
      if (close < 0) {
        push("comment", text.slice(cursor));
        current = { kind: "blockComment", end: block.end, escape: false };
        cursor = text.length;
      } else {
        push("comment", text.slice(cursor, close + block.end.length));
        cursor = close + block.end.length;
      }
      handled = true;
      break;
    }
    if (handled) continue;

    for (const marker of config.lineComments) {
      if (!text.startsWith(marker, cursor)) continue;
      if (config.lineCommentBoundary && cursor > 0 && !WHITESPACE_RE.test(text.charAt(cursor - 1))) continue;
      push("comment", text.slice(cursor));
      cursor = text.length;
      handled = true;
      break;
    }
    if (handled) continue;

    for (const rule of config.strings) {
      if (!text.startsWith(rule.open, cursor)) continue;
      let scan = cursor + rule.open.length;
      let closed = false;
      while (scan < text.length) {
        if (rule.escape && text.charAt(scan) === "\\") {
          scan += 2;
          continue;
        }
        if (text.startsWith(rule.close, scan)) {
          closed = true;
          break;
        }
        scan += 1;
      }
      if (closed) {
        push("string", text.slice(cursor, scan + rule.close.length));
        cursor = scan + rule.close.length;
      } else {
        push("string", text.slice(cursor));
        cursor = text.length;
        if (rule.multiline) current = { kind: "string", end: rule.close, escape: rule.escape };
      }
      handled = true;
      break;
    }
    if (handled) continue;

    const char = text.charAt(cursor);

    if (DIGIT_RE.test(char) || (char === "." && DIGIT_RE.test(text.charAt(cursor + 1)))) {
      const number = matchAt(NUMBER_RE, text, cursor);
      if (number) {
        push("number", number);
        cursor += number.length;
        continue;
      }
    }

    if (IDENTIFIER_START_RE.test(char)) {
      const word = matchAt(config.identifierDash ? IDENTIFIER_DASH_RE : IDENTIFIER_RE, text, cursor);
      if (word) {
        const lookup = config.keywordInsensitive ? word.toLowerCase() : word;
        if (config.keywords.has(lookup)) push("keyword", word);
        else if (config.builtins.has(lookup)) push("builtin", word);
        else plain += word;
        cursor += word.length;
        continue;
      }
    }

    if (PUNCT_CHARS.has(char)) {
      let scan = cursor;
      while (scan < text.length && PUNCT_CHARS.has(text.charAt(scan))) scan += 1;
      push("punct", text.slice(cursor, scan));
      cursor = scan;
      continue;
    }

    plain += char;
    cursor += 1;
  }

  flush();
  return { tokens, state: current };
}

function mergeAdjacent(tokens: CodeToken[]): CodeToken[] {
  const merged: CodeToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === token.type) last.text += token.text;
    else merged.push({ ...token });
  }
  return merged;
}

/**
 * Разбирает код на токены подсветки. Чистая функция: не трогает DOM и глобальное
 * состояние. Неизвестный или отсутствующий язык даёт generic-разбор; слишком
 * большой блок возвращается одним `plain`-токеном.
 */
export function tokenizeCode(code: string, language: string | null): CodeToken[] {
  if (code.length > MAX_HIGHLIGHT_LENGTH) return [{ type: "plain", text: code }];
  const config = resolveConfig(language);
  const lines = code.split("\n");
  const tokens: CodeToken[] = [];
  let state: ScanState = NORMAL_STATE;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const text = index < lines.length - 1 ? `${line}\n` : line;
    const result = scanLine(text, state, config);
    tokens.push(...result.tokens);
    state = result.state;
  }
  return mergeAdjacent(tokens);
}
