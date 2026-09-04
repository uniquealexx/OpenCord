import { z } from "zod";

export const KEYBIND_ACTIONS = ["mute", "deafen"] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export const KEYBIND_MODES = ["toggle", "hold"] as const;
export type KeybindMode = (typeof KEYBIND_MODES)[number];

/** Физическая клавиша (KeyboardEvent.code) + удерживаемые модификаторы. */
export const keybindTriggerSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Za-z0-9]{0,23}$/),
  control: z.boolean().default(false),
  alt: z.boolean().default(false),
  shift: z.boolean().default(false),
  meta: z.boolean().default(false),
});
export type KeybindTrigger = z.infer<typeof keybindTriggerSchema>;

export const keybindSchema = z.object({
  trigger: keybindTriggerSchema,
  mode: z.enum(KEYBIND_MODES).default("toggle"),
});
export type Keybind = z.infer<typeof keybindSchema>;

/** Действие → бинд; отсутствующее или null поле — бинда нет. */
export const keybindMapSchema = z.preprocess((input) => input ?? {}, z.object({
  mute: keybindSchema.nullish(),
  deafen: keybindSchema.nullish(),
}));
export type KeybindMap = z.infer<typeof keybindMapSchema>;

/** Событие main → renderer: клавиша назначенного бинда нажата/отпущена. */
export const keybindActionEventSchema = z.object({
  action: z.enum(KEYBIND_ACTIONS),
  mode: z.enum(KEYBIND_MODES),
  phase: z.enum(["press", "release"]),
});
export type KeybindActionEvent = z.infer<typeof keybindActionEventSchema>;

/** Коды клавиш-модификаторов: учитываются и как часть комбо, и как одиночный бинд. */
export const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"]);

export const MODIFIER_FAMILIES = ["control", "alt", "shift", "meta"] as const;
export type ModifierFamily = (typeof MODIFIER_FAMILIES)[number];

const FAMILY_BY_CODE_PREFIX: Array<[string, ModifierFamily]> = [
  ["Control", "control"],
  ["Alt", "alt"],
  ["Meta", "meta"],
  ["Shift", "shift"],
];

/** Семейство модификатора по KeyboardEvent.code, null для обычных клавиш. */
export function modifierFamily(code: string): ModifierFamily | null {
  for (const [prefix, family] of FAMILY_BY_CODE_PREFIX) {
    if (code.startsWith(prefix)) return family;
  }
  return null;
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

const CANONICAL_MODIFIER_CODE: Record<ModifierFamily, string> = {
  control: "ControlLeft",
  alt: "AltLeft",
  shift: "ShiftLeft",
  meta: "MetaLeft",
};

/** Канонический (левый) код семейства — левая и правая клавиши считаются одним биндом. */
export function canonicalModifierCode(family: ModifierFamily): string {
  return CANONICAL_MODIFIER_CODE[family];
}

/**
 * Нормализует триггер: код одиночного модификатора приводится к левому
 * варианту семейства, у него выставляется только собственный флаг.
 */
export function normalizeTrigger(trigger: KeybindTrigger): KeybindTrigger {
  const family = modifierFamily(trigger.code);
  if (!family || !isModifierCode(trigger.code)) return trigger;
  return {
    code: canonicalModifierCode(family),
    control: family === "control",
    alt: family === "alt",
    shift: family === "shift",
    meta: family === "meta",
  };
}

/** Триггер на одиночный модификатор (без обычной клавиши). */
export function isModifierOnlyTrigger(trigger: KeybindTrigger): boolean {
  return isModifierCode(trigger.code);
}

export function sameTrigger(left: KeybindTrigger, right: KeybindTrigger): boolean {
  // Нормализация сводит левый/правый варианты модификатора к одному коду,
  // поэтому дальше достаточно строгого сравнения.
  const a = normalizeTrigger(left);
  const b = normalizeTrigger(right);
  return a.code === b.code
    && a.control === b.control && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;
}
