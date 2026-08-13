import { describe, expect, it } from "vitest";
import { normalizeServerAddress, requiresInsecureHttpConfirmation, sameServerAddress } from "@/lib/server-address";

describe("server address validation", () => {
  it("allows HTTPS and loopback HTTP without confirmation", () => {
    expect(normalizeServerAddress("https://chat.example.test/path")).toBe("https://chat.example.test");
    expect(normalizeServerAddress("http://127.0.0.1:3210/path")).toBe("http://127.0.0.1:3210");
  });

  it("allows remote HTTP only after explicit confirmation", () => {
    const address = "http://203.0.113.42:3210/path";
    expect(() => normalizeServerAddress(address)).toThrow("HTTPS required");
    expect(normalizeServerAddress(address, { allowInsecureHttp: true })).toBe("http://203.0.113.42:3210");
    expect(requiresInsecureHttpConfirmation(address)).toBe(true);
  });

  it("still rejects credentials and unsupported protocols", () => {
    expect(() => normalizeServerAddress("http://user:secret@203.0.113.42:3210", { allowInsecureHttp: true })).toThrow("Credentials are not allowed");
    expect(() => normalizeServerAddress("ftp://203.0.113.42", { allowInsecureHttp: true })).toThrow("HTTPS required");
  });

  it("compares previously confirmed HTTP server addresses canonically", () => {
    expect(sameServerAddress("http://203.0.113.42:3210/path", "http://203.0.113.42:3210/")).toBe(true);
  });

  it("treats loopback aliases as the same server", () => {
    expect(sameServerAddress("http://localhost:3210", "http://127.0.0.1:3210")).toBe(true);
    expect(sameServerAddress("http://127.0.0.1:3210", "http://localhost:3210/")).toBe(true);
    expect(sameServerAddress("http://[::1]:3210", "http://127.0.0.1:3210")).toBe(true);
    expect(sameServerAddress("http://127.0.0.1:3210", "http://127.0.0.1:3211")).toBe(false);
    expect(sameServerAddress("http://localhost:3210", "https://localhost:3210")).toBe(false);
    expect(sameServerAddress("http://localhost:3210", "http://203.0.113.42:3210")).toBe(false);
  });
});
