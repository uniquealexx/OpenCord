import { describe, expect, it } from "vitest";
import {
  canonicalModifierCode,
  isModifierCode,
  isModifierOnlyTrigger,
  keybindMapSchema,
  keybindSchema,
  keybindTriggerSchema,
  modifierFamily,
  normalizeTrigger,
  sameTrigger,
} from "../src/shared/keybinds";
import { formatKeyLabel, formatTrigger, splitTriggerParts } from "../src/lib/keybinds";

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
  it("accepts lone modifiers as triggers", () => {
    expect(keybindTriggerSchema.safeParse({ code: "AltLeft", alt: true }).success).toBe(true);
    expect(keybindTriggerSchema.safeParse({ code: "ControlLeft", control: true }).success).toBe(true);
    expect(keybindTriggerSchema.safeParse({ code: "left ctrl" }).success).toBe(false);
  });
  it("sameTrigger compares code and all modifiers", () => {
    const base = { code: "KeyM", control: false, alt: false, shift: false, meta: false };
    expect(sameTrigger(base, { ...base })).toBe(true);
    expect(sameTrigger(base, { ...base, control: true })).toBe(false);
    expect(sameTrigger(base, { ...base, code: "KeyN" })).toBe(false);
  });
  it("sameTrigger treats left and right modifiers as one", () => {
    const left = { code: "ControlLeft", control: true, alt: false, shift: false, meta: false };
    const right = { code: "ControlRight", control: true, alt: false, shift: false, meta: false };
    expect(sameTrigger(left, right)).toBe(true);
    expect(sameTrigger(left, { code: "AltLeft", control: false, alt: true, shift: false, meta: false })).toBe(false);
  });
});

describe("modifier helpers", () => {
  it("resolves families and canonical codes", () => {
    expect(modifierFamily("ControlLeft")).toBe("control");
    expect(modifierFamily("AltRight")).toBe("alt");
    expect(modifierFamily("ShiftLeft")).toBe("shift");
    expect(modifierFamily("MetaRight")).toBe("meta");
    expect(modifierFamily("KeyM")).toBeNull();
    expect(isModifierCode("AltLeft")).toBe(true);
    expect(isModifierCode("KeyM")).toBe(false);
    expect(canonicalModifierCode("control")).toBe("ControlLeft");
    expect(canonicalModifierCode("alt")).toBe("AltLeft");
  });
  it("normalizeTrigger canonicalizes lone modifiers and leaves combos alone", () => {
    expect(normalizeTrigger({ code: "ControlRight", control: true, alt: false, shift: false, meta: false }))
      .toEqual({ code: "ControlLeft", control: true, alt: false, shift: false, meta: false });
    const combo = { code: "KeyM", control: true, alt: false, shift: false, meta: false };
    expect(normalizeTrigger(combo)).toEqual(combo);
    expect(isModifierOnlyTrigger({ code: "AltLeft", control: false, alt: true, shift: false, meta: false })).toBe(true);
    expect(isModifierOnlyTrigger(combo)).toBe(false);
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
  it("labels modifiers", () => {
    expect(formatKeyLabel("ControlLeft")).toBe("Ctrl");
    expect(formatKeyLabel("ControlRight")).toBe("Ctrl");
    expect(formatKeyLabel("AltLeft")).toBe("Alt");
    expect(formatKeyLabel("ShiftRight")).toBe("Shift");
  });
  it("formats triggers with modifiers", () => {
    expect(formatTrigger({ code: "KeyM", control: true, alt: false, shift: true, meta: false })).toBe("Ctrl + Shift + M");
    expect(formatTrigger({ code: "F9", control: false, alt: false, shift: false, meta: false })).toBe("F9");
  });
  it("formats lone modifiers without doubling", () => {
    expect(formatTrigger({ code: "ControlLeft", control: true, alt: false, shift: false, meta: false })).toBe("Ctrl");
    expect(formatTrigger({ code: "AltLeft", control: false, alt: true, shift: false, meta: false })).toBe("Alt");
    expect(splitTriggerParts({ code: "KeyM", control: true, alt: true, shift: false, meta: false })).toEqual(["Ctrl", "Alt", "M"]);
    expect(splitTriggerParts({ code: "ShiftLeft", control: false, alt: false, shift: true, meta: false })).toEqual(["Shift"]);
  });
});
