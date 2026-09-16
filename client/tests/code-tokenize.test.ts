import { describe, expect, it } from "vitest";
import { MAX_HIGHLIGHT_LENGTH, tokenizeCode, type CodeToken, type CodeTokenType } from "@/lib/code-tokenize";

function join(tokens: CodeToken[]): string {
  return tokens.map((token) => token.text).join("");
}

function has(tokens: CodeToken[], type: CodeTokenType, text: string): boolean {
  return tokens.some((token) => token.type === type && token.text === text);
}

function hasText(tokens: CodeToken[], type: CodeTokenType, fragment: string): boolean {
  return tokens.some((token) => token.type === type && token.text.includes(fragment));
}

describe("code-tokenize", () => {
  it("reconstructs the original code exactly (no lost or added characters)", () => {
    const samples: Array<[string, string | null]> = [
      ['const a = 1; // note\nconst s = "hi";', "js"],
      ['def f():\n    return "s"  # c', "python"],
      ['<!-- c -->\n<div class="x">', "html"],
      ["SELECT * FROM t -- c\n", "sql"],
      ["let x = 1;", null],
      ["", "js"],
      ["no language 🎉", "unknown-lang"],
      ['/* a\nb */\nint x;', "cpp"],
    ];
    for (const [code, language] of samples) {
      expect(join(tokenizeCode(code, language))).toBe(code);
    }
  });

  it("tokenizes JavaScript keywords, strings, numbers and comments", () => {
    const line = tokenizeCode('const x = "hi"; // note', "js");
    expect(has(line, "keyword", "const")).toBe(true);
    expect(has(line, "string", '"hi"')).toBe(true);
    expect(has(line, "comment", "// note")).toBe(true);
    expect(has(line, "punct", "=")).toBe(true);
    expect(has(tokenizeCode("let n = 42;", "js"), "number", "42")).toBe(true);
    expect(has(tokenizeCode("let n = 0x1f;", "js"), "number", "0x1f")).toBe(true);
  });

  it("tokenizes Python keywords, builtins, strings and comments", () => {
    const tokens = tokenizeCode('def f():\n    return "s"  # c', "python");
    expect(has(tokens, "keyword", "def")).toBe(true);
    expect(has(tokens, "keyword", "return")).toBe(true);
    expect(has(tokens, "string", '"s"')).toBe(true);
    expect(has(tokens, "comment", "# c")).toBe(true);
  });

  it("tokenizes JSON keys, numbers and literals", () => {
    const tokens = tokenizeCode('{"a": 1, "ok": true}', "json");
    expect(has(tokens, "string", '"a"')).toBe(true);
    expect(has(tokens, "number", "1")).toBe(true);
    expect(has(tokens, "keyword", "true")).toBe(true);
  });

  it("tokenizes HTML tags, attributes, comments and strings", () => {
    const tokens = tokenizeCode('<!-- c -->\n<div class="x">', "html");
    expect(has(tokens, "comment", "<!-- c -->")).toBe(true);
    expect(has(tokens, "keyword", "div")).toBe(true);
    expect(has(tokens, "builtin", "class")).toBe(true);
    expect(has(tokens, "string", '"x"')).toBe(true);
  });

  it("tokenizes CSS properties and block comments", () => {
    const tokens = tokenizeCode(".a { color: red; } /* c */", "css");
    expect(has(tokens, "builtin", "color")).toBe(true);
    expect(has(tokens, "comment", "/* c */")).toBe(true);
  });

  it("tokenizes shell commands and comments", () => {
    const tokens = tokenizeCode('# c\necho "hi"', "bash");
    expect(hasText(tokens, "comment", "# c")).toBe(true);
    expect(has(tokens, "builtin", "echo")).toBe(true);
    expect(has(tokens, "string", '"hi"')).toBe(true);
  });

  it("matches SQL keywords case-insensitively", () => {
    const tokens = tokenizeCode("SELECT * FROM t -- c", "sql");
    expect(has(tokens, "keyword", "SELECT")).toBe(true);
    expect(has(tokens, "keyword", "FROM")).toBe(true);
    expect(has(tokens, "comment", "-- c")).toBe(true);
  });

  it("tokenizes Go, Rust, Java and C/C++ snippets", () => {
    expect(has(tokenizeCode("func main() { n := 1 }", "go"), "keyword", "func")).toBe(true);
    expect(has(tokenizeCode("let x = 1;", "rust"), "keyword", "let")).toBe(true);
    expect(has(tokenizeCode("public class A {}", "java"), "keyword", "class")).toBe(true);
    const cpp = tokenizeCode("int main() { return 0; }", "cpp");
    expect(has(cpp, "keyword", "int")).toBe(true);
    expect(has(cpp, "keyword", "return")).toBe(true);
    expect(has(cpp, "number", "0")).toBe(true);
  });

  it("tokenizes YAML booleans and comments", () => {
    const tokens = tokenizeCode("key: true # c", "yaml");
    expect(has(tokens, "keyword", "true")).toBe(true);
    expect(has(tokens, "comment", "# c")).toBe(true);
  });

  it("carries block comments across lines", () => {
    const tokens = tokenizeCode("/* a\nb */\nint x;", "cpp");
    expect(hasText(tokens, "comment", "/* a\nb */")).toBe(true);
    expect(has(tokens, "keyword", "int")).toBe(true);
  });

  it("carries HTML comments across lines", () => {
    const tokens = tokenizeCode("<!-- a\nb -->\n<div>", "html");
    expect(hasText(tokens, "comment", "<!-- a\nb -->")).toBe(true);
  });

  it("carries triple-quoted Python strings across lines", () => {
    const tokens = tokenizeCode('x = """line1\nline2"""', "python");
    expect(hasText(tokens, "string", '"""line1\nline2"""')).toBe(true);
  });

  it("handles an unterminated string without throwing", () => {
    const tokens = tokenizeCode('const a = "oops', "js");
    expect(has(tokens, "keyword", "const")).toBe(true);
    expect(has(tokens, "string", '"oops')).toBe(true);
    expect(join(tokens)).toBe('const a = "oops');
  });

  it("falls back to generic tokenizing for unknown languages", () => {
    const tokens = tokenizeCode('x = "y" # c', "brainfuck");
    expect(has(tokens, "string", '"y"')).toBe(true);
    expect(has(tokens, "comment", "# c")).toBe(true);
  });

  it("does not highlight blocks longer than the cap", () => {
    const big = "a".repeat(MAX_HIGHLIGHT_LENGTH + 1);
    expect(tokenizeCode(big, "js")).toEqual([{ type: "plain", text: big }]);
  });

  it("does not treat a '#' inside a word as a comment in boundary languages", () => {
    const tokens = tokenizeCode("color: red#fff", "bash");
    expect(tokens.some((token) => token.type === "comment")).toBe(false);
  });
});
