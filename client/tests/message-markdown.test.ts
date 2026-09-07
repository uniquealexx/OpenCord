import { describe, expect, it } from "vitest";
import { extractCodeBlocks, groupQuoteLines, parseInline, quoteDepthOf, sanitizeCodeLanguage, stripQuoteMarker } from "@/lib/message-markdown";

describe("message-markdown", () => {
  it("parses spoilers and keeps unclosed markers as text", () => {
    expect(parseInline("a ||secret|| b")).toEqual([
      { type: "text", text: "a " },
      { type: "spoiler", children: [{ type: "text", text: "secret" }] },
      { type: "text", text: " b" },
    ]);
    expect(parseInline("a ||oops b")).toEqual([{ type: "text", text: "a ||oops b" }]);
    expect(parseInline("||||")).toEqual([{ type: "text", text: "||||" }]);
  });

  it("parses bold, italic, strike and inline code", () => {
    expect(parseInline("**b**")).toEqual([{ type: "bold", children: [{ type: "text", text: "b" }] }]);
    expect(parseInline("*i*")).toEqual([{ type: "italic", children: [{ type: "text", text: "i" }] }]);
    expect(parseInline("_i_")).toEqual([{ type: "italic", children: [{ type: "text", text: "i" }] }]);
    expect(parseInline("~~s~~")).toEqual([{ type: "strike", children: [{ type: "text", text: "s" }] }]);
    expect(parseInline("`c`")).toEqual([{ type: "inlineCode", text: "c" }]);
    expect(parseInline("**unclosed")).toEqual([{ type: "text", text: "**unclosed" }]);
  });

  it("does not treat underscores inside words as italic", () => {
    expect(parseInline("user_name")).toEqual([{ type: "text", text: "user_name" }]);
    expect(parseInline("@user_name hi")).toEqual([{ type: "text", text: "@user_name hi" }]);
  });

  it("keeps markdown markers inside inline code literal", () => {
    expect(parseInline("`**x**`")).toEqual([{ type: "inlineCode", text: "**x**" }]);
    expect(parseInline("`||x||`")).toEqual([{ type: "inlineCode", text: "||x||" }]);
  });

  it("nests inline formatting inside spoiler and bold", () => {
    expect(parseInline("||a **b**||")).toEqual([
      {
        type: "spoiler",
        children: [{ type: "text", text: "a " }, { type: "bold", children: [{ type: "text", text: "b" }] }],
      },
    ]);
  });

  it("extracts fenced code blocks with language labels", () => {
    expect(extractCodeBlocks("hi ```js\nconst a = 1;\n``` bye")).toEqual([
      { type: "text", text: "hi " },
      { type: "codeBlock", language: "js", code: "const a = 1;" },
      { type: "text", text: " bye" },
    ]);
    expect(extractCodeBlocks("```\nplain\n```")).toEqual([{ type: "codeBlock", language: null, code: "plain" }]);
  });

  it("treats an unclosed fence as a block to the end", () => {
    expect(extractCodeBlocks("hi ```py\nprint(1)")).toEqual([
      { type: "text", text: "hi " },
      { type: "codeBlock", language: "py", code: "print(1)" },
    ]);
  });

  it("sanitizes language labels for XSS safety", () => {
    expect(sanitizeCodeLanguage("TypeScript")).toBe("typescript");
    expect(sanitizeCodeLanguage("c++")).toBe("c++");
    expect(sanitizeCodeLanguage('"><script>alert(1)</script>')).toBeNull();
    expect(sanitizeCodeLanguage("js evil")).toBeNull();
    expect(sanitizeCodeLanguage("")).toBeNull();
    expect(sanitizeCodeLanguage(null)).toBeNull();
  });

  it("detects quote depth and strips one marker level", () => {
    expect(quoteDepthOf("> a")).toBe(1);
    expect(quoteDepthOf(">> nested")).toBe(2);
    expect(quoteDepthOf("  > spaced")).toBe(1);
    expect(quoteDepthOf("plain")).toBe(0);
    expect(quoteDepthOf(">unspaced")).toBe(1);
    expect(stripQuoteMarker(">> nested")).toBe("> nested");
  });

  it("groups consecutive quote lines and splits on blank lines", () => {
    expect(groupQuoteLines(["> a", "> b", "", "> c", "plain"])).toEqual([
      { type: "quote", group: { depth: 1, inner: "a\nb" } },
      { type: "quote", group: { depth: 1, inner: "c" } },
      { type: "paragraph", text: "plain" },
    ]);
    expect(groupQuoteLines([">> deep"])).toEqual([{ type: "quote", group: { depth: 2, inner: "> deep" } }]);
  });
});
