import type { KeybindTrigger } from "@/shared/keybinds";
import { isModifierCode, modifierFamily } from "@/shared/keybinds";

const CODE_LABELS: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Semicolon: ";", Quote: "'", Backslash: "\\", Comma: ",", Period: ".", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  CapsLock: "Caps Lock", NumLock: "Num Lock", ScrollLock: "Scroll Lock",
  PrintScreen: "PrtSc", ContextMenu: "Menu",
  ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt",
  ShiftLeft: "Shift", ShiftRight: "Shift",
  NumpadAdd: "Num +", NumpadSubtract: "Num −", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .", NumpadEnter: "Num Enter",
};

export function formatKeyLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code === "MetaLeft" || code === "MetaRight") return metaLabel();
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  // F1…F24, Insert, Delete и т.п. читаются как есть.
  return code;
}

function metaLabel(): string {
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "Cmd" : "Win";
}

/**
 * Триггер отдельными чипсами: ["Ctrl", "Shift", "M"].
 * У одиночного модификатора собственный флаг не дублируется ("Ctrl", а не "Ctrl + Ctrl").
 */
export function splitTriggerParts(trigger: KeybindTrigger): string[] {
  const own = isModifierCode(trigger.code) ? modifierFamily(trigger.code) : null;
  const parts: string[] = [];
  if (trigger.control && own !== "control") parts.push("Ctrl");
  if (trigger.alt && own !== "alt") parts.push("Alt");
  if (trigger.shift && own !== "shift") parts.push("Shift");
  if (trigger.meta && own !== "meta") parts.push(metaLabel());
  parts.push(formatKeyLabel(trigger.code));
  return parts;
}

export function formatTrigger(trigger: KeybindTrigger): string {
  return splitTriggerParts(trigger).join(" + ");
}

export function triggerFromKeyboardEvent(event: KeyboardEvent): KeybindTrigger {
  return { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
}

/** Живое превью захвата: зажатые модификаторы отдельными чипсами. */
export function liveModifierParts(modifiers: { control: boolean; alt: boolean; shift: boolean; meta: boolean }): string[] {
  const parts: string[] = [];
  if (modifiers.control) parts.push("Ctrl");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.shift) parts.push("Shift");
  if (modifiers.meta) parts.push(metaLabel());
  return parts;
}
