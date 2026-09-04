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

/** Клавиши-модификаторы сами по себе биндами не становятся — их состояние учитывается. */
export const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "ShiftLeft", "ShiftRight"]);

export function sameTrigger(left: KeybindTrigger, right: KeybindTrigger): boolean {
  return left.code === right.code && left.control === right.control && left.alt === right.alt && left.shift === right.shift && left.meta === right.meta;
}
