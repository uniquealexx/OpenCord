"use client";

/**
 * Builder + source parser for custom server help pages.
 *
 * The admin authors pages in the server settings as builder calls that look
 * like JS (`api.page(...)`, `api.text(...)`, ...). This is intentionally NOT
 * executed: the shipped renderer CSP has no `unsafe-eval`, so `eval` and
 * `new Function` are dead in production. Instead `parseHelpSource` parses the
 * restricted one-call-per-line syntax below into a JSON spec with a small
 * hand-written tokenizer, and only that spec is stored on the server and
 * rendered by viewing clients. Viewing clients never run any code.
 */

import {
  SERVER_HELP_SOURCE_MAX_LENGTH,
  serverHelpSchema,
  type ServerHelp,
  type ServerHelpAudience,
  type ServerHelpBlock,
  type ServerHelpTextSize,
} from "@opencord/shared";

export type HelpSourceResult = { ok: true; spec: ServerHelp } | { ok: false; error: string };

type ScalarOption = string | boolean | number;
type ParsedValue = ScalarOption | string[] | Record<string, ScalarOption | string[]>;

interface PageDraft {
  id: string;
  title: string;
  audience: ServerHelpAudience;
  blocks: ServerHelpBlock[];
}

const TEXT_SIZES: readonly ServerHelpTextSize[] = ["xs", "sm", "md", "lg"];

type ApplySuccess = { ok: true; page?: PageDraft };

function fail(line: number, message: string): Extract<HelpSourceResult, { ok: false }> {
  return { ok: false, error: `line ${line}: ${message}` };
}

function isApplyError(result: object): result is Extract<HelpSourceResult, { ok: false }> {
  return "error" in result;
}

function isRecord(value: ParsedValue | undefined): value is Record<string, ScalarOption | string[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split a comma-separated argument list, ignoring commas inside strings/brackets/braces. */
function splitTopLevel(input: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let current = "";
  for (const char of input) {
    if (quote !== null) {
      current += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "[" || char === "{") {
      depth += 1;
      current += char;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth < 0) return null;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (quote !== null || depth !== 0) return null;
  parts.push(current);
  return parts;
}

function parseStringLiteral(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) return null;
  let out = "";
  let escaped = false;
  for (const char of trimmed.slice(1, -1)) {
    if (escaped) {
      if (char === "n") out += "\n";
      else if (char === "t") out += "\t";
      else out += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else {
      out += char;
    }
  }
  return escaped ? null : out;
}

function parseValue(token: string): ParsedValue | undefined {
  const trimmed = token.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  const asString = parseStringLiteral(trimmed);
  if (asString !== null) return asString;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    const items = splitTopLevel(inner);
    if (!items) return undefined;
    const parsed: string[] = [];
    for (const item of items) {
      const value = parseStringLiteral(item);
      if (value === null) return undefined;
      parsed.push(value);
    }
    return parsed;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    const record: Record<string, ScalarOption | string[]> = {};
    if (!inner) return record;
    const entries = splitTopLevel(inner);
    if (!entries) return undefined;
    for (const entry of entries) {
      const colon = entry.indexOf(":");
      if (colon < 0) return undefined;
      const rawKey = entry.slice(0, colon).trim();
      const key = /^[A-Za-z_$][\w$]*$/.test(rawKey) ? rawKey : parseStringLiteral(rawKey);
      if (key === null) return undefined;
      const value = parseValue(entry.slice(colon + 1));
      if (value === undefined || (typeof value === "object" && !Array.isArray(value))) return undefined;
      record[key] = value as ScalarOption | string[];
    }
    return record;
  }
  return undefined;
}

function asString(value: ParsedValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: ParsedValue | undefined, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : null;
}

function checkOptions(
  line: number,
  options: ParsedValue | undefined,
  allowed: readonly string[],
): Record<string, ScalarOption | string[]> | HelpSourceResult {
  if (options === undefined) return {};
  if (!isRecord(options)) return fail(line, "options must be an object like { size: \"lg\" }");
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) return fail(line, `unknown option "${key}"`);
  }
  return options;
}

/**
 * Parse builder source into a validated help spec.
 *
 * Accepted syntax is one `api.*` call per line; `//` comments and blank lines
 * are ignored. Anything else (loops, variables, arbitrary JS) is rejected —
 * this keeps the editor CSP-safe and every error points at a line number.
 */
export function parseHelpSource(source: string): HelpSourceResult {
  if (typeof source !== "string" || !source.trim()) return { ok: false, error: "script is empty" };
  if (source.length > SERVER_HELP_SOURCE_MAX_LENGTH) {
    return { ok: false, error: `script exceeds ${SERVER_HELP_SOURCE_MAX_LENGTH} characters` };
  }
  const pages: PageDraft[] = [];
  let current: PageDraft | null = null;
  const gate: { pageId: string | null } = { pageId: null };
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const withoutComment = stripLineComment(lines[index] ?? "");
    const text = withoutComment.trim();
    if (!text) continue;
    const call = parseCall(text);
    if (!call) return fail(line, "expected api.method(...) — one call per line");
    const result = applyCall(line, pages, current, gate, call.method, call.args);
    if (isApplyError(result)) return result;
    if (result.page) {
      current = result.page;
      pages.push(current);
    }
  }
  if (!pages.length) return { ok: false, error: "add at least one api.page(id, title)" };
  const parsed = serverHelpSchema.safeParse({ enabled: false, gate: gate.pageId === null ? { enabled: false, pageId: null } : { enabled: true, pageId: gate.pageId }, pages });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((issue) => issue.message).join("; ") };
  }
  return { ok: true, spec: parsed.data };
}

function stripLineComment(line: string): string {
  let quote: string | null = null;
  let escaped = false;
  for (let i = 0; i < line.length - 1; i += 1) {
    const char = line[i]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function parseCall(text: string): { method: string; args: ParsedValue[] } | null {
  const prefix = /^api\.([A-Za-z_$][\w$]*)\s*\(/u.exec(text);
  if (!prefix || prefix[1] === undefined) return null;
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = prefix[0].length - 1; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const argsText = text.slice(prefix[0].length, i).trim();
        const rest = text.slice(i + 1).trim();
        if (rest !== "" && rest !== ";") return null;
        if (!argsText) return { method: prefix[1], args: [] };
        const parts = splitTopLevel(argsText);
        if (!parts) return null;
        const args: ParsedValue[] = [];
        for (const part of parts) {
          const value = parseValue(part);
          if (value === undefined) return null;
          args.push(value);
        }
        return { method: prefix[1], args };
      }
    }
  }
  return null;
}

function needPage(line: number, current: PageDraft | null): PageDraft | Extract<HelpSourceResult, { ok: false }> {
  if (!current) return fail(line, "call api.page(id, title) first");
  return current;
}

function applyCall(
  line: number,
  pages: PageDraft[],
  current: PageDraft | null,
  gate: { pageId: string | null },
  method: string,
  args: ParsedValue[],
): Extract<HelpSourceResult, { ok: false }> | ApplySuccess {
  switch (method) {
    case "gate": {
      const [pageId] = args;
      if (typeof pageId !== "string" || args.length !== 1) {
        return fail(line, 'gate expects (pageId), e.g. api.gate("rules")');
      }
      if (gate.pageId !== null) return fail(line, "duplicate gate");
      gate.pageId = pageId;
      return { ok: true };
    }
    case "page": {
      const [id, title, rawOptions] = args;
      if (typeof id !== "string" || typeof title !== "string" || (args.length !== 2 && args.length !== 3)) {
        return fail(line, 'page expects (id, title, options?), e.g. api.page("rules", "Rules")');
      }
      if (pages.some((page) => page.id === id)) return fail(line, `duplicate page id "${id}"`);
      const options = checkOptions(line, rawOptions, ["audience"]);
      if (isApplyError(options)) return options;
      const audience = (options as Record<string, ScalarOption | string[]>).audience ?? "always";
      if (audience !== "always" && audience !== "pending" && audience !== "accepted") {
        return fail(line, 'page audience must be one of "always", "pending", "accepted"');
      }
      return { ok: true, page: { id, title, audience, blocks: [] } };
    }
    case "text": {
      const page = needPage(line, current);
      if (isApplyError(page)) return page;
      const target = page as PageDraft;
      const [content, rawOptions] = args;
      if (typeof content !== "string" || (args.length !== 1 && args.length !== 2)) {
        return fail(line, 'text expects (content, options?), e.g. api.text("No spam", { size: "lg" })');
      }
      const options = checkOptions(line, rawOptions, ["size", "weight", "align"]);
      if (isApplyError(options)) return options;
      const opts = options as Record<string, ScalarOption | string[]>;
      const size = opts.size === undefined ? "sm" : opts.size;
      const weight = opts.weight === undefined ? "normal" : opts.weight;
      const align = opts.align === undefined ? "left" : opts.align;
      if (typeof size !== "string" || !TEXT_SIZES.includes(size as ServerHelpTextSize)) {
        return fail(line, 'text size must be one of "xs", "sm", "md", "lg"');
      }
      if (weight !== "normal" && weight !== "medium" && weight !== "bold") {
        return fail(line, 'text weight must be one of "normal", "medium", "bold"');
      }
      if (align !== "left" && align !== "center") return fail(line, 'text align must be "left" or "center"');
      target.blocks.push({ kind: "text", text: content, size: size as ServerHelpTextSize, weight, align });
      return { ok: true };
    }
    case "divider": {
      const page = needPage(line, current);
      if (isApplyError(page)) return page;
      if (args.length !== 0) return fail(line, "divider takes no arguments");
      (page as PageDraft).blocks.push({ kind: "divider" });
      return { ok: true };
    }
    case "button": {
      const page = needPage(line, current);
      if (isApplyError(page)) return page;
      const target = page as PageDraft;
      const [label, rawOptions] = args;
      if (typeof label !== "string" || (args.length !== 1 && args.length !== 2)) {
        return fail(line, 'button expects (label, options?), e.g. api.button("FAQ", { toPage: "faq" })');
      }
      const options = checkOptions(line, rawOptions, ["variant", "toPage", "close", "accept", "requires"]);
      if (isApplyError(options)) return options;
      const opts = options as Record<string, ScalarOption | string[]>;
      const variant = opts.variant === undefined ? "secondary" : opts.variant;
      if (variant !== "primary" && variant !== "secondary") {
        return fail(line, 'button variant must be "primary" or "secondary"');
      }
      const close = asBoolean(opts.close, false);
      if (close === null) return fail(line, "button close must be true or false");
      const accept = asBoolean(opts.accept, false);
      if (accept === null) return fail(line, "button accept must be true or false");
      const toPage = opts.toPage === undefined ? null : asString(opts.toPage);
      if (opts.toPage !== undefined && toPage === null) return fail(line, "button toPage must be a page id string");
      if (toPage !== null && close) return fail(line, "button cannot combine toPage with close: true");
      if (accept && (toPage !== null || close)) return fail(line, "accept button cannot combine toPage with close");
      const requiresRaw = opts.requires === undefined ? [] : opts.requires;
      if (!Array.isArray(requiresRaw) || !requiresRaw.every((entry): entry is string => typeof entry === "string")) {
        return fail(line, "button requires must be an array of control ids");
      }
      if (requiresRaw.length > 0 && !accept) return fail(line, "button requires needs accept: true");
      target.blocks.push({
        kind: "button",
        label,
        variant,
        action: accept ? { kind: "accept" } : toPage !== null ? { kind: "page", pageId: toPage } : { kind: "close" },
        requires: requiresRaw,
      });
      return { ok: true };
    }
    case "checkbox":
    case "switch": {
      const page = needPage(line, current);
      if (isApplyError(page)) return page;
      const target = page as PageDraft;
      const [id, label, defaultChecked] = args;
      if (typeof id !== "string" || typeof label !== "string" || (args.length !== 2 && args.length !== 3)) {
        return fail(line, `${method} expects (id, label, defaultChecked?), e.g. api.${method}("read", "I read the rules")`);
      }
      if (defaultChecked !== undefined && typeof defaultChecked !== "boolean") {
        return fail(line, `${method} defaultChecked must be true or false`);
      }
      target.blocks.push({ kind: method, id, label, defaultChecked: defaultChecked ?? false });
      return { ok: true };
    }
    case "select":
    case "combobox": {
      const page = needPage(line, current);
      if (isApplyError(page)) return page;
      const target = page as PageDraft;
      const [id, label, options, defaultValue] = args;
      if (typeof id !== "string" || typeof label !== "string" || !Array.isArray(options) || (args.length !== 3 && args.length !== 4)) {
        return fail(line, 'select expects (id, label, options, defaultValue?), e.g. api.select("topic", "Topic", ["Roles", "Voice"])');
      }
      if (defaultValue !== undefined && typeof defaultValue !== "string") {
        return fail(line, "select defaultValue must be a string");
      }
      target.blocks.push({ kind: "select", id, label, options, defaultValue });
      return { ok: true };
    }
    default:
      return fail(line, `unknown call api.${method} — use gate, page, text, divider, button, checkbox, switch, select`);
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Serialize a validated spec back to builder source (for reopening the editor). */
export function specToSource(spec: ServerHelp): string {
  const lines: string[] = ["// Help pages for the `?` button: one api.* call per line.", "// Full JavaScript is not supported here — only the calls below."];
  if (spec.gate.enabled && spec.gate.pageId) {
    lines.push(`api.gate(${quote(spec.gate.pageId)});`);
    lines.push("");
  }
  for (const page of spec.pages) {
    lines.push(page.audience === "always" ? `api.page(${quote(page.id)}, ${quote(page.title)});` : `api.page(${quote(page.id)}, ${quote(page.title)}, { audience: ${quote(page.audience)} });`);
    for (const block of page.blocks) {
      switch (block.kind) {
        case "text": {
          const options: string[] = [];
          if (block.size !== "sm") options.push(`size: ${quote(block.size)}`);
          if (block.weight !== "normal") options.push(`weight: ${quote(block.weight)}`);
          if (block.align !== "left") options.push(`align: ${quote(block.align)}`);
          lines.push(options.length ? `api.text(${quote(block.text)}, { ${options.join(", ")} });` : `api.text(${quote(block.text)});`);
          break;
        }
        case "divider":
          lines.push("api.divider();");
          break;
        case "button": {
          const options: string[] = [];
          if (block.variant !== "secondary") options.push(`variant: ${quote(block.variant)}`);
          if (block.action.kind === "page") options.push(`toPage: ${quote(block.action.pageId)}`);
          if (block.action.kind === "accept") {
            options.push("accept: true");
            if (block.requires.length > 0) options.push(`requires: [${block.requires.map(quote).join(", ")}]`);
          }
          lines.push(options.length ? `api.button(${quote(block.label)}, { ${options.join(", ")} });` : `api.button(${quote(block.label)});`);
          break;
        }
        case "checkbox":
        case "switch":
          lines.push(block.defaultChecked ? `api.${block.kind}(${quote(block.id)}, ${quote(block.label)}, true);` : `api.${block.kind}(${quote(block.id)}, ${quote(block.label)});`);
          break;
        case "select":
          lines.push(
            block.defaultValue !== undefined
              ? `api.select(${quote(block.id)}, ${quote(block.label)}, [${block.options.map(quote).join(", ")}], ${quote(block.defaultValue)});`
              : `api.select(${quote(block.id)}, ${quote(block.label)}, [${block.options.map(quote).join(", ")}]);`,
          );
          break;
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export const DEFAULT_HELP_PAGE_SOURCE = `// Example: rules and FAQ behind the \`?\` button.
// One api.* call per line; full JavaScript is not supported here.
api.page("rules", "Rules");
api.text("Server rules", { size: "lg", weight: "bold", align: "center" });
api.text("1. No spam or flooding the chat.");
api.text("2. Be kind to other members.");
api.divider();
api.checkbox("read", "I have read the rules");
api.select("topic", "Question topic", ["Roles", "Voice", "Files"], "Roles");
api.button("Open FAQ", { toPage: "faq" });
api.button("Got it", { variant: "primary" });

api.page("faq", "FAQ");
api.text("Frequently asked questions", { size: "md", weight: "bold" });
api.text("How do I get a role? Ask an administrator in the chat.");
api.button("Back to rules", { toPage: "rules" });
`;
