import { describe, expect, it } from "vitest";
import { isAllowedScreenShareSource } from "@/shared/screen-share";

describe("screen-share source filtering", () => {
  it("keeps physical screens and normal application windows", () => {
    expect(isAllowedScreenShareSource({ id: "screen:1:0", name: "Entire Screen" })).toBe(true);
    expect(isAllowedScreenShareSource({ id: "window:42:0", name: "Visual Studio Code" })).toBe(true);
  });

  it.each([
    "NVIDIA GeForce Overlay",
    "NVIDIA Share",
    "Discord Overlay",
    "Steam Overlay",
    "Xbox Game Bar",
    "Codex Computer Use Cursor Overlay",
    "Cua.AgentCursorOverlay.default",
    "ChatGPT is using your computer. Esc to stop",
    "Windows Input Experience",
  ])("blocks non-application source %s", (name) => {
    expect(isAllowedScreenShareSource({ id: "window:13:0", name })).toBe(false);
  });

  it("rejects unknown source identifiers", () => {
    expect(isAllowedScreenShareSource({ id: "overlay:1:0", name: "Unknown" })).toBe(false);
  });
});
