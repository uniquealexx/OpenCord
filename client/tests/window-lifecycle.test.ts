import { describe, expect, it } from "vitest";
import { shouldHideWindowOnClose } from "../electron/window-lifecycle";

describe("Electron window lifecycle", () => {
  it("hides an ordinary close in the tray", () => {
    expect(shouldHideWindowOnClose(false, false)).toBe(true);
  });

  it("allows the window to close during explicit quit or update installation", () => {
    expect(shouldHideWindowOnClose(true, false)).toBe(false);
    expect(shouldHideWindowOnClose(false, true)).toBe(false);
  });
});
