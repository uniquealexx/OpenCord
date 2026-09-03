import { describe, expect, it } from "vitest";
import { accentCardPalette, accentGlassBackground, hexToHsv, hsvToHex, isBrightAccent, nameGlowStyle, normalizeHexColor, relativeLuminance } from "@/lib/accent-color";

describe("accent color utilities", () => {
  it("round-trips hex through hsv", () => {
    for (const hex of ["#4d6bfe", "#7c3aed", "#34d399", "#ad4029", "#000000", "#ffffff"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("converts primary hues", () => {
    expect(hexToHsv("#ff0000")).toMatchObject({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00")).toMatchObject({ h: 120, s: 1, v: 1 });
    expect(hexToHsv("#0000ff")).toMatchObject({ h: 240, s: 1, v: 1 });
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 300, s: 0.5, v: 0.5 })).toBe("#804080");
  });

  it("normalizes user input to the canonical lowercase hex", () => {
    expect(normalizeHexColor("#7C3AED")).toBe("#7c3aed");
    expect(normalizeHexColor("4d6bfe")).toBe("#4d6bfe");
    expect(normalizeHexColor("  #34d399 ")).toBe("#34d399");
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("#1234567")).toBeNull();
    expect(normalizeHexColor("violet")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });

  it("applies the translucent glass alpha to the profile card tint", () => {
    expect(accentGlassBackground("#7c3aed")).toBe("#7c3aed73");
  });

  it("builds a soft two-layer glow for the nickname", () => {
    expect(nameGlowStyle("#34d399")).toEqual({ textShadow: "0 0 4px #34d3998c, 0 0 12px #34d39959" });
  });

  it("detects bright accents by relative luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(isBrightAccent("#f59e0b")).toBe(true);
    expect(isBrightAccent("#34d399")).toBe(true);
    expect(isBrightAccent("#94a3b8")).toBe(true);
    expect(isBrightAccent("#4d6bfe")).toBe(false);
    expect(isBrightAccent("#7c3aed")).toBe(false);
    expect(isBrightAccent("#0f766e")).toBe(false);
  });

  it("switches the card palette to dark text on bright accents and brightens it on dark ones", () => {
    const bright = accentCardPalette("#f59e0b");
    expect(bright.heading).toBe("#0f172a");
    expect(bright.soft).toBe("#1e293b");
    expect(bright.muted).toBe("#334155");
    expect(bright.badgeBg).toBe("rgba(124, 58, 237, .16)");

    const dark = accentCardPalette("#4d6bfe");
    expect(dark.heading).toBe("#ffffff");
    expect(dark.muted).toBe("#e2e8f0");
    expect(dark.soft).toBe("#f1f5f9");

    const neutral = accentCardPalette(null);
    expect(neutral.heading).toBe("#ffffff");
    expect(neutral.muted).toBe("#94a3b8");
  });
});
