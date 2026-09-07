import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkPreviews } from "@/components/link-preview";
import { MessageContent } from "@/components/message-content";
import { I18nRoot, setActiveLanguage } from "@/lib/i18n";
import { extractMessageUrls, fetchLinkPreviewTitle, getLinkDomain, isDirectImageUrl, isHttpUrl, parseLinkTitle } from "@/lib/link-preview";
import type { MockMember } from "@/shared/state";

const members: MockMember[] = [
  { id: "user-lina", username: "lina", role: "member", status: "online", avatarColor: "#ffffff" } as MockMember,
];

function htmlResponse(html: string, contentType = "text/html; charset=utf-8"): Response {
  return {
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => html,
    body: undefined,
  } as unknown as Response;
}

beforeEach(() => {
  setActiveLanguage("en");
  vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<title>Nope</title>")));
});

afterEach(() => {
  setActiveLanguage("en");
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractMessageUrls", () => {
  it("detects http(s) urls and trims trailing punctuation", () => {
    expect(extractMessageUrls("see https://example.com/a,b. and http://foo.test/x?y=1!")).toEqual([
      "https://example.com/a,b",
      "http://foo.test/x?y=1",
    ]);
  });

  it("ignores non-http schemes and dedupes", () => {
    expect(extractMessageUrls("ftp://x.test/a mailto:a@b.test javascript:alert(1) https://dup.test/ https://dup.test/")).toEqual([
      "https://dup.test/",
    ]);
  });

  it("skips fenced code blocks and inline code", () => {
    expect(extractMessageUrls("```\nhttps://code.test/secret\n```\n`https://inline.test/x`")).toEqual([]);
    expect(extractMessageUrls("**bold https://fmt.test/x** and `https://skip.test/`")).toEqual(["https://fmt.test/x"]);
  });

  it("caps previews at three urls", () => {
    expect(
      extractMessageUrls("https://a.test/ https://b.test/ https://c.test/ https://d.test/").length,
    ).toBe(3);
  });
});

describe("link-preview helpers", () => {
  it("resolves domains only for http(s)", () => {
    expect(getLinkDomain("https://Example.COM:8080/x")).toBe("example.com");
    expect(getLinkDomain("javascript:alert(1)")).toBeNull();
    expect(isHttpUrl("http://a.test")).toBe(true);
    expect(isHttpUrl("ftp://a.test")).toBe(false);
  });

  it("treats only raster image extensions as thumbnails", () => {
    expect(isDirectImageUrl("https://cdn.test/pic.png?size=1")).toBe(true);
    expect(isDirectImageUrl("https://cdn.test/photo.JPG")).toBe(true);
    expect(isDirectImageUrl("https://cdn.test/vector.svg")).toBe(false);
    expect(isDirectImageUrl("https://cdn.test/page.html")).toBe(false);
  });

  it("parses og:title first, then <title>, decoding entities", () => {
    expect(parseLinkTitle('<meta property="og:title" content="OG &amp; nice"><title>Fallback</title>')).toBe("OG & nice");
    expect(parseLinkTitle('<meta content="Reversed" property="og:title">')).toBe("Reversed");
    expect(parseLinkTitle("<title>  Plain  Title </title>")).toBe("Plain Title");
    expect(parseLinkTitle("<p>no title here</p>")).toBeNull();
  });
});

describe("fetchLinkPreviewTitle", () => {
  it("returns the fetched title", async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<meta property="og:title" content="Hello">'));
    await expect(fetchLinkPreviewTitle("https://example.test/a", fetchMock)).resolves.toBe("Hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/a", expect.objectContaining({ credentials: "omit", redirect: "follow", referrerPolicy: "no-referrer" }));
  });

  it("skips binary content without rendering it", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("%PDF-1.4", "application/pdf"));
    await expect(fetchLinkPreviewTitle("https://example.test/f.pdf", fetchMock)).resolves.toBeNull();
  });

  it("never fetches non-http urls, image urls, or failures", async () => {
    const fetchMock = vi.fn(async () => htmlResponse("<title>x</title>"));
    await expect(fetchLinkPreviewTitle("javascript:alert(1)", fetchMock)).resolves.toBeNull();
    await expect(fetchLinkPreviewTitle("https://cdn.test/pic.png", fetchMock)).resolves.toBeNull();
    await expect(fetchLinkPreviewTitle("https://down.test/", async () => { throw new Error("down"); })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LinkPreviews card", () => {
  it("renders domain with url fallback and only image thumbnails", async () => {
    const { container } = render(
      <I18nRoot>
        <LinkPreviews content="pic https://cdn.test/a.png page https://example.test/post" />
      </I18nRoot>,
    );
    expect(await screen.findByText("cdn.test")).toBeInTheDocument();
    expect(screen.getByText("example.test")).toBeInTheDocument();
    const images = container.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(images[0]).toHaveAttribute("src", "https://cdn.test/a.png");
    expect(images[0]).toHaveAttribute("loading", "lazy");
    const link = screen.getByRole("link", { name: /example\.test/ });
    expect(link).toHaveAttribute("href", "https://example.test/post");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the fetched title when available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse('<meta property="og:title" content="Fetched Title">')));
    render(
      <I18nRoot>
        <LinkPreviews content="read https://example.test/post" />
      </I18nRoot>,
    );
    expect(await screen.findByText("Fetched Title")).toBeInTheDocument();
  });

  it("fetches nothing and renders nothing when previews are disabled", () => {
    const fetchMock = vi.fn(async () => htmlResponse("<title>x</title>"));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <I18nRoot>
        <LinkPreviews content="see https://example.test/a" enabled={false} />
      </I18nRoot>,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("collapses and expands previews per message", async () => {
    const user = userEvent.setup();
    render(
      <I18nRoot>
        <LinkPreviews content="see https://example.test/a" />
      </I18nRoot>,
    );
    expect(await screen.findByText("example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /hide link previews/i }));
    expect(screen.queryByText("example.test")).toBeNull();
    await user.click(screen.getByRole("button", { name: /show link previews/i }));
    expect(await screen.findByText("example.test")).toBeInTheDocument();
  });

  it("keeps malicious content as text without executable markup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse('<title><img src=x onerror=alert(1)>hi</title>')));
    const { container } = render(
      <I18nRoot>
        <MessageContent content={'<script>alert(1)</script> javascript:alert(2) https://example.test/<b>x</b>'} members={members} />
      </I18nRoot>,
    );
    expect(await screen.findByText("example.test")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a[href^='javascript:']")).toBeNull();
    for (const link of container.querySelectorAll("a")) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("https://") || href.startsWith("http://")).toBe(true);
    }
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });

  it("hides previews inside MessageContent when the setting is off", () => {
    const { container } = render(
      <I18nRoot>
        <MessageContent content="see https://example.test/a" members={members} linkPreviewsEnabled={false} />
      </I18nRoot>,
    );
    expect(within(container).queryByText("example.test")).toBeNull();
  });

  it("never uses dangerouslySetInnerHTML in preview sources", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const file of ["src/components/link-preview.tsx", "src/lib/link-preview.ts"]) {
      const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
