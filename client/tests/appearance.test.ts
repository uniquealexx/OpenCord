import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSystemDark, resolveAppearance, useSystemDark } from "@/lib/appearance";

describe("appearance resolution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if ("matchMedia" in window) Reflect.deleteProperty(window, "matchMedia");
  });

  it("keeps explicit modes regardless of the system", () => {
    expect(resolveAppearance("dark", false)).toBe("dark");
    expect(resolveAppearance("dark", true)).toBe("dark");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("light", false)).toBe("light");
  });

  it("follows the system in system mode", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });

  it("falls back to dark without matchMedia", () => {
    expect(getSystemDark()).toBe(true);
  });

  it("reads the OS theme via matchMedia", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    expect(getSystemDark()).toBe(false);
  });

  it("updates when the OS theme changes", () => {
    let changeHandler: ((event: { matches: boolean }) => void) | null = null;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn((_type: string, handler: (event: { matches: boolean }) => void) => {
          changeHandler = handler;
        }),
        removeEventListener: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useSystemDark());
    expect(result.current).toBe(false);
    act(() => {
      changeHandler?.({ matches: true });
    });
    expect(result.current).toBe(true);
  });
});
