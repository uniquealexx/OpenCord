// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientUpdateState } from "@/shared/updater";

const updateHtmlPath = path.resolve("public", "update.html");

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
  Reflect.deleteProperty(window, "openCordUpdateGate");
});

describe("mandatory update window", () => {
  it("uses a monolithic minimal style without decorative effects", async () => {
    const html = await readFile(updateHtmlPath, "utf8");
    expect(html).toContain("background: transparent");
    expect(html).toContain("background: #4d6bfe");
    expect(html).not.toContain("backdrop-filter");
    expect(html).not.toContain("status-indicator");
    expect(html).not.toContain(".shell::after");
    expect(html).not.toMatch(/gradient\s*\(/i);
  });

  it("renders download progress and version transition", async () => {
    const dom = await renderUpdateState({ status: "downloading", currentVersion: "0.1.0-beta.15", channel: "beta", version: "0.1.0-beta.17", percent: 42 });
    expect(dom.querySelector("h1")?.textContent).toBe("Updating OpenCord");
    expect(dom.querySelector("#versions")?.textContent).toContain("0.1.0-beta.15  →  0.1.0-beta.17");
    expect(dom.querySelector("#percent")?.textContent).toBe("42%");
    expect(dom.querySelector<HTMLElement>("#bar")?.style.width).toBe("42%");
    expect(dom.querySelector("#track")?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("renders the blocking update error state clearly", async () => {
    const dom = await renderUpdateState({ status: "error", currentVersion: "0.1.0-beta.15", channel: "beta", message: "No connection" });
    expect(dom.querySelector("#shell")?.getAttribute("data-status")).toBe("error");
    expect(dom.querySelector("h1")?.textContent).toBe("OpenCord could not be updated");
    expect(dom.querySelector("#message")?.textContent).toBe("No connection");
    expect(dom.querySelector("#footer-message")?.textContent).toContain("action");
    expect(dom.querySelector("#retry")?.textContent).toBe("Retry");
    expect(dom.querySelector("#quit")?.textContent).toBe("Quit");
  });
});

async function renderUpdateState(state: ClientUpdateState): Promise<Document> {
  const html = await readFile(updateHtmlPath, "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const script = parsed.querySelector("script")?.textContent;
  if (!script) throw new Error("Update window script is missing");
  document.documentElement.innerHTML = parsed.documentElement.innerHTML;
  Object.defineProperty(window, "openCordUpdateGate", {
    configurable: true,
    value: {
      onStateChange: () => undefined,
      getState: async () => state,
      retry: async () => undefined,
      quit: async () => undefined,
    },
  });
  window.eval(script);
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return document;
}
