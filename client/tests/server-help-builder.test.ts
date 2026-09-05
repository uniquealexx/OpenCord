import { describe, expect, it } from "vitest";
import { DEFAULT_HELP_PAGE_SOURCE, parseHelpSource, specToSource } from "@/components/server-help/builder";

describe("help page builder source", () => {
  it("parses the shipped example into two pages", () => {
    const result = parseHelpSource(DEFAULT_HELP_PAGE_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.pages.map((page) => page.id)).toEqual(["rules", "faq"]);
    const rules = result.spec.pages[0]!;
    expect(rules.blocks.map((block) => block.kind)).toEqual(["text", "text", "text", "divider", "checkbox", "select", "button", "button"]);
    expect(rules.blocks[0]).toMatchObject({ kind: "text", size: "lg", weight: "bold", align: "center" });
    expect(rules.blocks[6]).toMatchObject({ kind: "button", action: { kind: "page", pageId: "faq" } });
    expect(rules.blocks[7]).toMatchObject({ kind: "button", variant: "primary", action: { kind: "close" } });
  });

  it("round-trips through code generation", () => {
    const first = parseHelpSource(DEFAULT_HELP_PAGE_SOURCE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parseHelpSource(specToSource(first.spec));
    expect(second).toEqual(first);
  });

  it("ignores comments and blank lines, accepts single quotes", () => {
    const result = parseHelpSource(`// comment\n\napi.page('a', 'A');\napi.text('hi'); // trailing\napi.button('Bye');\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.pages).toHaveLength(1);
    expect(result.spec.pages[0]!.blocks).toHaveLength(2);
  });

  it("reports line numbers for authoring mistakes", () => {
    expect(parseHelpSource("")).toMatchObject({ ok: false });
    expect(parseHelpSource('api.text("orphan");')).toEqual({ ok: false, error: expect.stringContaining("line 1") });
    expect(parseHelpSource('api.page("a", "A");\nfor (let i = 0; i < 3; i++) {}')).toEqual({ ok: false, error: expect.stringContaining("line 2") });
    expect(parseHelpSource('api.page("a", "A");\napi.dance("x");')).toEqual({ ok: false, error: expect.stringContaining("line 2") });
    expect(parseHelpSource('api.page("a", "A");\napi.text("x", { size: "huge" });')).toEqual({ ok: false, error: expect.stringContaining("line 2") });
    expect(parseHelpSource('api.page("a", "A");\napi.page("a", "B");')).toEqual({ ok: false, error: expect.stringContaining("duplicate page") });
    expect(parseHelpSource('api.page("a", "A");\napi.button("X", { toPage: "missing" });')).toEqual({ ok: false, error: expect.stringContaining("does not exist") });
    expect(parseHelpSource('api.page("a", "A");\napi.select("s", "S", ["A"], "B");')).toEqual({ ok: false, error: expect.stringContaining("one of its options") });
  });

  it("rejects oversized scripts and blocks", () => {
    expect(parseHelpSource(`api.page("a", "A");\napi.text("${"x".repeat(2001)}");`)).toMatchObject({ ok: false });
    expect(parseHelpSource(`api.page("a", "A");\n${"api.text(\"x\");\n".repeat(31)}`)).toMatchObject({ ok: false });
    expect(parseHelpSource(`// ${"x".repeat(20_000)}\napi.page("a", "A");`)).toMatchObject({ ok: false });
  });

  it("parses the rules gate with audience and required controls", () => {
    const source = [
      'api.gate("rules");',
      'api.page("rules", "Rules", { audience: "pending" });',
      'api.text("No spam");',
      'api.checkbox("agree", "I read the rules");',
      'api.button("Accept", { variant: "primary", accept: true, requires: ["agree"] });',
      "",
      'api.page("news", "News", { audience: "accepted" });',
      'api.text("News");',
      "",
    ].join("\n");
    const result = parseHelpSource(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.gate).toEqual({ enabled: true, pageId: "rules" });
    expect(result.spec.pages.map((page) => [page.id, page.audience])).toEqual([["rules", "pending"], ["news", "accepted"]]);
    expect(result.spec.pages[0]!.blocks.at(-1)).toMatchObject({ kind: "button", action: { kind: "accept" }, requires: ["agree"] });
    // Round-trip сохраняет гейт, аудиторию и requires.
    const second = parseHelpSource(specToSource(result.spec));
    expect(second).toEqual(result);
  });

  it("rejects broken gate configurations with line numbers where possible", () => {
    expect(parseHelpSource('api.gate("rules");\napi.gate("faq");\napi.page("rules", "R");')).toEqual({ ok: false, error: expect.stringContaining("line 2") });
    expect(parseHelpSource('api.page("a", "A");\napi.button("X", { accept: true, toPage: "a" });')).toEqual({ ok: false, error: expect.stringContaining("line 2") });
    expect(parseHelpSource('api.page("a", "A");\napi.checkbox("x", "X");\napi.button("B", { requires: ["x"] });')).toEqual({ ok: false, error: expect.stringContaining("line 3") });
    expect(parseHelpSource('api.page("a", "A", { audience: "everyone" });')).toEqual({ ok: false, error: expect.stringContaining("line 1") });
    // Гейт на несуществующую страницу и страница гейта без accept-кнопки.
    expect(parseHelpSource('api.gate("missing");\napi.page("a", "A");')).toMatchObject({ ok: false });
    expect(parseHelpSource('api.gate("a");\napi.page("a", "A");\napi.text("hi");')).toMatchObject({ ok: false });
    // requires на несуществующий контрол той же страницы.
    expect(parseHelpSource('api.page("a", "A");\napi.button("B", { accept: true, requires: ["ghost"] });')).toMatchObject({ ok: false });
  });
});
