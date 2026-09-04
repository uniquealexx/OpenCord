import { describe, expect, it } from "vitest";
import { keybindMapSchema, keybindSchema, keybindTriggerSchema, sameTrigger } from "../src/shared/keybinds";

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
