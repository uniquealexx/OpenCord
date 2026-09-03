import { describe, expect, it } from "vitest";
import { NAME_FONT_VALUES, nameFontStyle, nicknameStyle } from "@/lib/name-font";

describe("name font styles", () => {
  it("covers every protocol value", () => {
    expect([...NAME_FONT_VALUES]).toEqual(["none", "pixel", "gothic", "italic", "mono", "serif"]);
  });

  it("renders bundled faces for pixel and gothic with fallbacks", () => {
    expect(nameFontStyle("pixel")).toMatchObject({ fontFamily: expect.stringContaining("OpenCord Pixel") });
    expect(nameFontStyle("gothic")).toMatchObject({ fontFamily: expect.stringContaining("OpenCord Gothic") });
  });

  it("renders system stacks for italic, mono and serif", () => {
    expect(nameFontStyle("italic")).toEqual({ fontStyle: "italic" });
    expect(nameFontStyle("mono")).toMatchObject({ fontFamily: expect.stringContaining("ui-monospace") });
    expect(nameFontStyle("serif")).toMatchObject({ fontFamily: expect.stringContaining("Georgia") });
  });

  it("leaves the default nickname untouched", () => {
    expect(nameFontStyle("none")).toEqual({});
    expect(nameFontStyle(null)).toEqual({});
    expect(nameFontStyle(undefined)).toEqual({});
  });

  it("merges the font and the glow into one nickname style", () => {
    expect(nicknameStyle("none", null)).toBeUndefined();
    expect(nicknameStyle("none", undefined)).toBeUndefined();
    expect(nicknameStyle("mono", "#34d399")).toEqual({
      fontFamily: expect.stringContaining("ui-monospace"),
      textShadow: expect.stringContaining("#34d399"),
    });
  });
});
