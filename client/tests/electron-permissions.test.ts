import { describe, expect, it } from "vitest";
import { isAllowedRendererPermission } from "../electron/permissions";

describe("trusted renderer permissions", () => {
  it("allows media capture and fullscreen but keeps unrelated permissions denied", () => {
    expect(isAllowedRendererPermission("media")).toBe(true);
    expect(isAllowedRendererPermission("display-capture")).toBe(true);
    expect(isAllowedRendererPermission("fullscreen")).toBe(true);
    expect(isAllowedRendererPermission("notifications")).toBe(false);
  });
});
