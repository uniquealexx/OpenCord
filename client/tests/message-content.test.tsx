import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMentionToken } from "@opencord/shared";
import { MessageContent } from "@/components/message-content";
import { I18nRoot, setActiveLanguage } from "@/lib/i18n";
import type { MockMember } from "@/shared/state";

const members: MockMember[] = [
  { id: "user-lina", username: "lina", role: "member", status: "online", avatarColor: "#ffffff" } as MockMember,
];

function renderContent(content: string, mentions?: string[]): void {
  setActiveLanguage("en");
  render(
    <I18nRoot>
      <MessageContent content={content} members={members} mentions={mentions} />
    </I18nRoot>,
  );
}

afterEach(() => {
  setActiveLanguage("en");
  cleanup();
  if ("clipboard" in navigator) Reflect.deleteProperty(navigator, "clipboard");
});

describe("message-content", () => {
  it("renders spoiler blurred and reveals it on click", async () => {
    const user = userEvent.setup();
    renderContent("a ||secret|| b");
    const spoiler = screen.getByRole("button", { name: /hidden spoiler/i });
    expect(spoiler).toHaveAttribute("aria-expanded", "false");
    expect(spoiler).toHaveTextContent("secret");
    await user.click(spoiler);
    expect(spoiler).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /activate to hide/i })).toBeInTheDocument();
  });

  it("reveals spoiler with the keyboard", async () => {
    const user = userEvent.setup();
    renderContent("||secret||");
    const spoiler = screen.getByRole("button", { name: /hidden spoiler/i });
    spoiler.focus();
    await user.keyboard("{Enter}");
    expect(spoiler).toHaveAttribute("aria-expanded", "true");
  });

  it("renders a fenced code block with language label and copy button", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderContent("```ts\nconst a = 1;\n```");
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByText("const a = 1;")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("renders quotes with indented border blocks and nesting", () => {
    const { container } = render(
      <I18nRoot>
        <MessageContent content={"> outer\n>> inner"} members={members} />
      </I18nRoot>,
    );
    const quotes = container.querySelectorAll("blockquote");
    expect(quotes.length).toBe(2);
    expect(quotes[0]).toHaveTextContent("outer");
    expect(quotes[1]).toHaveTextContent("inner");
  });

  it("keeps bold, italic, strike, inline code and emoji working", () => {
    const { container } = render(
      <I18nRoot>
        <MessageContent content={"**b** *i* ~~s~~ `c` 🎉"} members={members} />
      </I18nRoot>,
    );
    expect(container.querySelector("strong")).toHaveTextContent("b");
    expect(container.querySelector("em")).toHaveTextContent("i");
    expect(container.querySelector("s")).toHaveTextContent("s");
    expect(container.querySelector("p code")).toHaveTextContent("c");
    expect(screen.getByText(/🎉/)).toBeInTheDocument();
  });

  it("keeps mention pills and @everyone working inside rich text", () => {
    const content = `hi ${buildMentionToken("user-lina")} and @everyone **bold**`;
    renderContent(content, ["user-lina"]);
    expect(screen.getByText("@lina")).toBeInTheDocument();
    expect(screen.getByText("@everyone")).toBeInTheDocument();
    expect(document.querySelector("strong")).toHaveTextContent("bold");
  });

  it("renders raw HTML as text without creating elements (XSS safety)", () => {
    const { container } = render(
      <I18nRoot>
        <MessageContent content={'<img src="x" onerror="alert(1)"> <script>alert(1)</script>'} members={members} />
      </I18nRoot>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("does not execute HTML inside code blocks or spoilers", () => {
    const { container } = render(
      <I18nRoot>
        <MessageContent content={'```html\n<img src=x onerror=alert(1)>\n```\n||<b>bold</b>||'} members={members} />
      </I18nRoot>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("never uses dangerouslySetInnerHTML in the renderer source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const file of ["src/components/message-content.tsx", "src/lib/message-markdown.ts"]) {
      const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
