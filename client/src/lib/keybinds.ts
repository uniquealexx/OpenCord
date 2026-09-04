import type { KeybindTrigger } from "@/shared/keybinds";
import { MODIFIER_CODES } from "@/shared/keybinds";

const CODE_LABELS: Record<string, string> = {
  Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Semicolon: ";", Quote: "'", Backslash: "\\", Comma: ",", Period: ".", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  CapsLock: "Caps Lock", NumLock: "Num Lock", ScrollLock: "Scroll Lock",
  PrintScreen: "PrtSc", ContextMenu: "Menu",
  NumpadAdd: "Num +", NumpadSubtract: "Num −", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadDecimal: "Num .", NumpadEnter: "Num Enter",
};

export function formatKeyLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  // F1…F24, Insert, Delete и т.п. читаются как есть.
  return code;
}

function metaLabel(): string {
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "Cmd" : "Win";
}

export function formatTrigger(trigger: KeybindTrigger): string {
  const parts: string[] = [];
  if (trigger.control) parts.push("Ctrl");
  if (trigger.alt) parts.push("Alt");
  if (trigger.shift) parts.push("Shift");
  if (trigger.meta) parts.push(metaLabel());
  parts.push(formatKeyLabel(trigger.code));
  return parts.join(" + ");
}

export function triggerFromKeyboardEvent(event: KeyboardEvent): KeybindTrigger {
  return { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
}

export function isBindableKey(event: Pick<KeyboardEvent, "code">): boolean {
  return !MODIFIER_CODES.has(event.code);
}
