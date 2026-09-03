import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error — сборочный скрипт без деклараций типов.
import { hardenHtmlCsp, hardenScriptSrc, inlineScriptHashes } from "../scripts/harden-csp.mjs";

const sha256 = (body: string): string => `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;

const documentWith = (policy: string, body: string): string =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"/></head><body><script>${body}</script></body></html>`;

describe("inlineScriptHashes", () => {
  it("хеширует тело inline-скрипта вместе с переводами строк и отступами", () => {
    const body = "\n      const shell = 1;\n    ";
    expect(inlineScriptHashes(documentWith("script-src 'none'", body))).toEqual([sha256(body)]);
  });

  // HTML-парсер приводит CRLF к LF до вычисления хеша браузером: без нормализации
  // файл с CRLF (public/update.html) собирается с хешем, который не совпадёт,
  // и скрипт блокируется уже в рантайме.
  it("нормализует CRLF и одиночный CR к LF, как это делает HTML-парсер", () => {
    const expected = sha256("\n  const a = 1;\n");
    expect(inlineScriptHashes(documentWith("script-src 'none'", "\r\n  const a = 1;\r\n"))).toEqual([expected]);
    expect(inlineScriptHashes(documentWith("script-src 'none'", "\r  const a = 1;\r"))).toEqual([expected]);
  });

  it("пропускает внешние скрипты и повторяющиеся тела", () => {
    const html = "<script src=\"./chunk.js\" async=\"\"></script><script>a()</script><script>a()</script>";
    expect(inlineScriptHashes(html)).toEqual([sha256("a()")]);
  });
});

describe("hardenScriptSrc", () => {
  it("меняет 'unsafe-inline' на хеши, сохраняя остальные источники и директивы", () => {
    const result = hardenScriptSrc("default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; img-src 'self' data:", ["sha256-AAA"]);
    expect(result).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval' blob: 'sha256-AAA'; img-src 'self' data:");
  });

  it("убирает 'none', когда добавляются хеши, и оставляет его без них", () => {
    expect(hardenScriptSrc("script-src 'none'", ["sha256-AAA"])).toBe("script-src 'sha256-AAA'");
    expect(hardenScriptSrc("script-src 'none'", [])).toBe("script-src 'none'");
  });

  it("падает, если директивы script-src нет", () => {
    expect(() => hardenScriptSrc("default-src 'none'", ["sha256-AAA"])).toThrow(/script-src/u);
  });
});

describe("hardenHtmlCsp", () => {
  it("подставляет хеш в экранированную React'ом политику и снимает экранирование корректно", () => {
    const body = "self.__next_f.push([1,\"x\"])";
    const html = documentWith("default-src &#x27;none&#x27;; script-src &#x27;self&#x27; &#x27;unsafe-inline&#x27; blob:", body);
    const result = hardenHtmlCsp(html);
    expect(result.hashes).toEqual([sha256(body)]);
    expect(result.html).toContain(`script-src &#x27;self&#x27; blob: &#x27;${sha256(body)}&#x27;`);
    expect(result.html).not.toContain("unsafe-inline");
    // Тело скрипта не должно быть тронуто: иначе хеш перестанет совпадать.
    expect(result.html).toContain(`<script>${body}</script>`);
  });

  it("не трогает документ без inline-скриптов и без политики", () => {
    const html = "<!doctype html><html><body><script src=\"./a.js\"></script></body></html>";
    expect(hardenHtmlCsp(html).html).toBe(html);
  });

  it("падает на inline-скрипте без политики", () => {
    expect(() => hardenHtmlCsp("<script>a()</script>", "index.html")).toThrow(/Content-Security-Policy/u);
  });

  it("падает на inline-обработчике события: хешем он не покрывается", () => {
    const html = documentWith("script-src 'unsafe-inline'", "a()").replace("<body>", "<body onload=\"a()\">");
    expect(() => hardenHtmlCsp(html, "index.html")).toThrow(/обработчик/u);
  });
});
