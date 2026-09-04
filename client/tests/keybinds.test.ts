import { describe, expect, it } from "vitest";
import { keybindMapSchema, keybindSchema, keybindTriggerSchema, sameTrigger } from "../src/shared/keybinds";
import { formatKeyLabel, formatTrigger, isBindableKey } from "../src/lib/keybinds";

describe("keybind schemas", () => {
  it("defaults modifiers and mode", () => {
    expect(keybindTriggerSchema.parse({ code: "KeyM" })).toEqual({ code: "KeyM", control: false, alt: false, shift: false, meta: false });
    expect(keybindSchema.parse({ trigger: { code: "KeyM" } })).toEqual({ trigger: { code: "KeyM", control: false, alt: false, shift: false, meta: false }, mode: "toggle" });
    expect(keybindMapSchema.parse(undefined)).toEqual({});
    expect(keybindMapSchema.parse(null)).toEqual({});
  });
  it("accepts a full map and normalizes null slots", () => {
    const map = keybindMapSchema.parse({ mute: { trigger: { code: "KeyM", control: true }, mode: "hold" }, deafen: null });
    expect(map.mute?.mode).toBe("hold");
    expect(map.deafen).toBeNull();
  });
  it("rejects modifier-style garbage", () => {
    expect(keybindTriggerSchema.safeParse({ code: "left ctrl" }).success).toBe(false);
  });
  it("sameTrigger compares code and all modifiers", () => {
    const base = { code: "KeyM", control: false, alt: false, shift: false, meta: false };
    expect(sameTrigger(base, { ...base })).toBe(true);
    expect(sameTrigger(base, { ...base, control: true })).toBe(false);
    expect(sameTrigger(base, { ...base, code: "KeyN" })).toBe(false);
  });
});

describe("keybind display helpers", () => {
  it("formats key labels", () => {
    expect(formatKeyLabel("KeyM")).toBe("M");
    expect(formatKeyLabel("Digit1")).toBe("1");
    expect(formatKeyLabel("F5")).toBe("F5");
    expect(formatKeyLabel("Semicolon")).toBe(";");
    expect(formatKeyLabel("Numpad3")).toBe("Num 3");
    expect(formatKeyLabel("Space")).toBe("Space");
  });
  it("formats triggers with modifiers", () => {
    expect(formatTrigger({ code: "KeyM", control: true, alt: false, shift: true, meta: false })).toBe("Ctrl + Shift + M");
    expect(formatTrigger({ code: "F9", control: false, alt: false, shift: false, meta: false })).toBe("F9");
  });
  it("rejects modifiers as bindable keys", () => {
    expect(isBindableKey({ code: "ControlLeft" })).toBe(false);
    expect(isBindableKey({ code: "KeyM" })).toBe(true);
  });
});
