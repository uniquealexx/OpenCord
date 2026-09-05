"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type TokenType = "plain" | "comment" | "string" | "number" | "boolean" | "api" | "method" | "punct";

interface Token {
  text: string;
  type: TokenType;
}

const TOKEN_CLASS: Record<TokenType, string> = {
  plain: "text-slate-200",
  comment: "text-slate-500 italic",
  string: "text-emerald-300",
  number: "text-amber-300",
  boolean: "text-cyan-300",
  api: "text-violet-300",
  method: "text-violet-200",
  punct: "text-slate-500",
};

const PUNCTUATION = new Set(["(", ")", "[", "]", "{", "}", ",", ":", ";", ".", "="]);

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

const CLOSE_CHARS = new Set([")", "]", "}"]);

function isWordChar(char: string): boolean {
  return /[\w$]/u.test(char);
}

/**
 * Minimal scanner for the builder syntax: comments, strings, numbers,
 * booleans, api.* calls. Runs per line so a broken line never breaks
 * highlighting of the rest.
 */
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let plain = "";
  const flushPlain = (): void => {
    if (plain) tokens.push({ text: plain, type: "plain" });
    plain = "";
  };
  while (index < line.length) {
    const char = line[index]!;
    if (char === '"' || char === "'" || char === "`") {
      flushPlain();
      let end = index + 1;
      let escaped = false;
      while (end < line.length) {
        const current = line[end]!;
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === char) break;
        end += 1;
      }
      tokens.push({ text: line.slice(index, Math.min(end + 1, line.length)), type: "string" });
      index = Math.min(end + 1, line.length);
    } else if (char === "/" && line[index + 1] === "/") {
      flushPlain();
      tokens.push({ text: line.slice(index), type: "comment" });
      break;
    } else if ((char === "-" && /\d/u.test(line[index + 1] ?? "")) || /\d/u.test(char)) {
      const prev = index > 0 ? (line[index - 1] ?? "") : "";
      if (prev && isWordChar(prev)) {
        plain += char;
        index += 1;
        continue;
      }
      flushPlain();
      let end = index + (char === "-" ? 1 : 0);
      while (end < line.length && /\d/u.test(line[end]!)) end += 1;
      if (line[end] === "." && /\d/u.test(line[end + 1] ?? "")) {
        end += 1;
        while (end < line.length && /\d/u.test(line[end]!)) end += 1;
      }
      tokens.push({ text: line.slice(index, end), type: "number" });
      index = end;
    } else if (isWordChar(char)) {
      flushPlain();
      let end = index;
      while (end < line.length && isWordChar(line[end]!)) end += 1;
      const word = line.slice(index, end);
      const previous = line.slice(0, index).trimEnd().slice(-1);
      if (word === "api" && line[end] === ".") tokens.push({ text: word, type: "api" });
      else if (word === "true" || word === "false") tokens.push({ text: word, type: "boolean" });
      else if (previous === ".") tokens.push({ text: word, type: "method" });
      else tokens.push({ text: word, type: "plain" });
      index = end;
    } else if (PUNCTUATION.has(char)) {
      flushPlain();
      tokens.push({ text: char, type: "punct" });
      index += 1;
    } else {
      plain += char;
      index += 1;
    }
  }
  flushPlain();
  return tokens;
}

/** Parse "line N: ..." produced by builder.ts into a 1-based line number. */
export function parseErrorLine(error: string | null): number | null {
  if (!error) return null;
  const match = /line (\d+)/u.exec(error);
  if (!match?.[1]) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line >= 1 ? line : null;
}

function selectedLineRange(text: string, start: number, end: number): { startLine: number; endLine: number } {
  const startLine = Math.max(0, text.slice(0, start).split("\n").length - 1);
  let endLine = Math.max(0, text.slice(0, end).split("\n").length - 1);
  if (end > start) {
    const lineStartOfEnd = text.lastIndexOf("\n", end - 1) + 1;
    if (lineStartOfEnd === end) endLine = Math.max(startLine, endLine - 1);
  }
  return { startLine, endLine };
}

const CODE_TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  lineHeight: "20px",
  tabSize: 2,
  fontVariantLigatures: "none",
  letterSpacing: 0,
  whiteSpace: "pre",
  overflowWrap: "normal",
  wordBreak: "normal",
};

/**
 * Code-looking input for the help page script.
 *
 * A transparent textarea stays the real input (keyboard, screen readers,
 * native undo for plain typing) over a highlighted <pre>. Both layers share
 * the exact same font/padding/line-height so highlight never drifts.
 * Editing helpers (Tab/Shift+Tab, Enter auto-indent, bracket pairing,
 * Ctrl+/ comment toggle) behave like a real code editor; the parser still
 * accepts only one api.* call per line.
 */
export function ScriptEditor({
  id,
  value,
  onChange,
  disabled = false,
  invalid = false,
  errorLine = null,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  errorLine?: number | null;
}): React.ReactElement {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [focused, setFocused] = useState(false);

  const lines = useMemo(() => value.split("\n"), [value]);

  function updateCursor(): void {
    const area = areaRef.current;
    if (!area) return;
    const text = area.value;
    const pos = area.selectionStart ?? 0;
    const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    setCursor({ line, col: pos - lastNewline });
  }

  function syncScroll(): void {
    const area = areaRef.current;
    if (!area) return;
    if (preRef.current) {
      preRef.current.scrollTop = area.scrollTop;
      preRef.current.scrollLeft = area.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop;
  }

  function applyEdit(next: string, anchor: number, focus?: number): void {
    const clampedAnchor = Math.max(0, Math.min(anchor, next.length));
    const clampedFocus = Math.max(0, Math.min(focus ?? clampedAnchor, next.length));
    onChange(next);
    window.setTimeout(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      try {
        area.setSelectionRange(clampedAnchor, clampedFocus);
      } catch {
        // jsdom or hidden element: selection is best-effort.
      }
      updateCursor();
      syncScroll();
    }, 0);
  }

  function handleTab(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (event.key !== "Tab") return false;
    const area = areaRef.current;
    if (!area) return false;
    event.preventDefault();
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    const all = value.split("\n");
    const { startLine, endLine } = selectedLineRange(value, start, end);
    if (start === end) {
      if (event.shiftKey) {
        const line = all[startLine] ?? "";
        const remove = line.startsWith("  ") ? 2 : line.startsWith(" ") || line.startsWith("\t") ? 1 : 0;
        if (remove === 0) return true;
        all[startLine] = line.slice(remove);
        const lineStart = all.slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0) + remove;
        const col = Math.max(0, start - lineStart);
        applyEdit(all.join("\n"), start - Math.min(remove, col));
        return true;
      }
      applyEdit(`${value.slice(0, start)}  ${value.slice(end)}`, start + 2);
      return true;
    }
    if (event.shiftKey) {
      let removedFirst = 0;
      let removedTotal = 0;
      const prevLineStart = value.split("\n").slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
      const nextLines = all.map((text, row) => {
        if (row < startLine || row > endLine) return text;
        const remove = text.startsWith("  ") ? 2 : text.startsWith(" ") || text.startsWith("\t") ? 1 : 0;
        if (row === startLine) removedFirst = remove;
        removedTotal += remove;
        return text.slice(remove);
      });
      const next = nextLines.join("\n");
      const nextLineStart = next.split("\n").slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
      const anchorCol = Math.max(0, start - prevLineStart - removedFirst);
      const nextAnchor = nextLineStart + anchorCol;
      applyEdit(next, nextAnchor, Math.max(nextAnchor, end - removedTotal));
      return true;
    }
    const count = endLine - startLine + 1;
    const nextLines = all.map((text, row) => (row >= startLine && row <= endLine ? `  ${text}` : text));
    applyEdit(nextLines.join("\n"), start + 2, end + 2 * count);
    return true;
  }

  function handleEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (event.key !== "Enter") return false;
    const area = areaRef.current;
    if (!area) return false;
    event.preventDefault();
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lineStart = before.lastIndexOf("\n") + 1;
    const fullLineEnd = value.indexOf("\n", end);
    const fullLine = value.slice(value.lastIndexOf("\n", Math.max(0, start - 1)) + 1, fullLineEnd === -1 ? undefined : fullLineEnd);
    const baseIndent = /^[\t ]*/u.exec(fullLine)?.[0] ?? "";
    const extra = /[{[(]\s*$/u.test(before.slice(lineStart)) ? "  " : "";
    const nextChar = after[0];
    if (extra && nextChar && (nextChar === "}" || nextChar === "]" || nextChar === ")")) {
      const next = `${before}\n${baseIndent}${extra}\n${baseIndent}${after}`;
      applyEdit(next, before.length + 1 + baseIndent.length + extra.length);
      return true;
    }
    const next = `${before}\n${baseIndent}${extra}${after}`;
    applyEdit(next, before.length + 1 + baseIndent.length + extra.length);
    return true;
  }

  function handlePairs(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    const area = areaRef.current;
    if (!area || event.ctrlKey || event.metaKey || event.altKey) return false;
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;

    if (event.key === "Backspace" && start === end && start > 0 && start < value.length) {
      const prev = value[start - 1]!;
      const next = value[start]!;
      if (OPEN_TO_CLOSE[prev] === next) {
        event.preventDefault();
        applyEdit(value.slice(0, start - 1) + value.slice(start + 1), start - 1);
        return true;
      }
      return false;
    }

    if (event.key.length !== 1) return false;
    const key = event.key;

    if (key in OPEN_TO_CLOSE) {
      const close = OPEN_TO_CLOSE[key]!;
      const next = value[start] ?? "";
      const prev = start > 0 ? (value[start - 1] ?? "") : "";
      if ((key === '"' || key === "'" || key === "`") && start === end && next === key) {
        event.preventDefault();
        applyEdit(value, start + 1);
        return true;
      }
      if (start !== end) {
        event.preventDefault();
        const selected = value.slice(start, end);
        applyEdit(value.slice(0, start) + key + selected + close + value.slice(end), start + 1, end + 1);
        return true;
      }
      if (key === '"' || key === "'" || key === "`") {
        if (/[\w$]/u.test(next) || /[\w$]/u.test(prev)) return false;
        event.preventDefault();
        applyEdit(value.slice(0, start) + key + close + value.slice(start), start + 1);
        return true;
      }
      event.preventDefault();
      applyEdit(value.slice(0, start) + key + close + value.slice(start), start + 1);
      return true;
    }

    if (CLOSE_CHARS.has(key) && start === end && value[start] === key) {
      event.preventDefault();
      applyEdit(value, start + 1);
      return true;
    }
    return false;
  }

  function handleCommentToggle(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "/") return false;
    const area = areaRef.current;
    if (!area) return false;
    event.preventDefault();
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    const all = value.split("\n");
    const { startLine, endLine } = selectedLineRange(value, start, end);
    const target = all.slice(startLine, endLine + 1);
    const meaningful = target.filter((text) => text.trim().length > 0);
    if (meaningful.length === 0) return true;
    const allCommented = meaningful.every((text) => text.trimStart().startsWith("//"));
    const nextLines = all.map((text, row) => {
      if (row < startLine || row > endLine || text.trim() === "") return text;
      if (allCommented) {
        const slash = text.indexOf("//");
        const after = text.slice(slash + 2);
        return text.slice(0, slash) + after.replace(/^ /u, "");
      }
      const indent = /^[\t ]*/u.exec(text)?.[0] ?? "";
      return `${indent}// ${text.slice(indent.length)}`;
    });
    const next = nextLines.join("\n");
    if (start === end) {
      const prevLineStart = value.split("\n").slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
      const nextLineStart = next.split("\n").slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
      const col = start - prevLineStart;
      const delta = nextLines[startLine]!.length - all[startLine]!.length;
      applyEdit(next, nextLineStart + Math.max(0, col + delta));
      return true;
    }
    const nextStart = next.split("\n").slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
    const nextEnd = nextStart + nextLines.slice(startLine, endLine + 1).join("\n").length;
    applyEdit(next, nextStart, nextEnd);
    return true;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (disabled) return;
    if (handleCommentToggle(event)) return;
    if (handleTab(event)) return;
    if (handleEnter(event)) return;
    if (handlePairs(event)) return;
  }

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-lg border bg-[#0d1117] transition focus-within:ring-2",
        invalid || errorLine !== null
          ? "border-red-400/50 focus-within:border-red-400/80 focus-within:ring-red-500/20"
          : "border-white/10 focus-within:border-violet-400/80 focus-within:ring-violet-500/20",
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/[.06] bg-black/25 px-3 py-1.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-[#ff5f57]" />
          <i className="size-2.5 rounded-full bg-[#febc2e]" />
          <i className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="rounded bg-white/[.06] px-1.5 py-0.5 font-mono text-[10px] leading-4 text-slate-300">help.js</span>
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] leading-4 text-violet-200">api.*</span>
        <span className="ml-auto hidden font-mono text-[10px] leading-4 text-slate-600 sm:block">Tab — отступ · Enter — новая строка · Ctrl+/ — комментарий</span>
      </div>
      <div className="flex min-h-64">
        <div
          ref={gutterRef}
          aria-hidden="true"
          data-testid="script-gutter"
          className="scrollbar-none w-12 shrink-0 select-none overflow-hidden border-r border-white/[.06] bg-black/20 py-3 pr-2 text-right"
          style={CODE_TEXT_STYLE}
        >
          {lines.map((_, index) => {
            const number = index + 1;
            const isError = errorLine === number;
            const isActive = focused && cursor.line === number;
            return (
              <div
                key={number}
                className={cn("px-1", isError ? "bg-red-500/15 text-red-300" : isActive ? "bg-white/[.06] text-slate-200" : "text-slate-600")}
              >
                {number}
              </div>
            );
          })}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre
            ref={preRef}
            aria-hidden="true"
            data-testid="script-highlight"
            className="scrollbar-none pointer-events-none absolute inset-0 overflow-hidden py-3"
            style={CODE_TEXT_STYLE}
          >
            {lines.map((line, index) => {
              const number = index + 1;
              const isError = errorLine === number;
              const isActive = focused && !disabled && cursor.line === number;
              return (
                <div key={number} className={cn("w-max min-w-full px-3", isError ? "bg-red-500/[.12]" : isActive ? "bg-white/[.05]" : "bg-transparent")}>
                  {line.length === 0 ? (
                    " "
                  ) : (
                    <>
                      {tokenizeLine(line).map((token, tokenIndex) => (
                        <span key={tokenIndex} className={TOKEN_CLASS[token.type]}>
                          {token.text}
                        </span>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </pre>
          <textarea
            ref={areaRef}
            id={id}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              window.setTimeout(() => {
                updateCursor();
                syncScroll();
              }, 0);
            }}
            onScroll={syncScroll}
            onSelect={updateCursor}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              updateCursor();
            }}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            aria-invalid={invalid || errorLine !== null}
            className="script-editor-input scrollbar-thin absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-3 font-mono text-xs leading-5 text-transparent caret-slate-100 outline-none selection:bg-violet-400/30 selection:text-slate-100 disabled:cursor-not-allowed"
            style={{ ...CODE_TEXT_STYLE, WebkitTextFillColor: "transparent" }}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[.06] bg-black/25 px-3 py-1 font-mono text-[10px] leading-4 text-slate-500">
        <span>
          Ln {Math.min(cursor.line, Math.max(1, lines.length))}, Col {cursor.col}
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">Spaces: 2</span>
          <span className="hidden sm:inline">UTF-8</span>
          {errorLine !== null ? <span className="text-red-300">line {errorLine}</span> : <span>{lines.length} lines</span>}
        </span>
      </div>
    </div>
  );
}
