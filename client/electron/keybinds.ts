import {
  MODIFIER_CODES,
  keybindMapSchema,
  type KeybindAction,
  type KeybindActionEvent,
  type KeybindMode,
  type KeybindMap,
  type KeybindTrigger,
} from "../src/shared/keybinds";

/** Событие глобального хука клавиатуры, приведённое к именам KeyboardEvent.code. */
export interface GlobalKey { code: string }

export interface KeybindHost {
  send(event: KeybindActionEvent): void;
  log?(message: string): void;
}

interface BoundAction { action: KeybindAction; trigger: KeybindTrigger; mode: KeybindMode }

/**
 * Переводит события глобального хука в семантические действия.
 * Модификаторы трекаем сами (набор полей событий хука зависит от платформы),
 * авто-повтор ОС давим по множеству зажатых клавиш.
 * Приватность: события клавиш используются ТОЛЬКО для сопоставления с биндами
 * и никуда, кроме этого процесса, не пишутся и не отправляются.
 */
export class KeybindManager {
  private bound: BoundAction[] = [];
  private pressed = new Set<string>();
  private modifiers = { control: false, alt: false, shift: false, meta: false };
  private held = new Set<KeybindAction>();
  private suppressed = false;

  constructor(private readonly host: KeybindHost) {}

  get isEmpty(): boolean { return this.bound.length === 0; }

  configure(map: KeybindMap | null | undefined): void {
    const next = keybindMapSchema.parse(map ?? {});
    this.releaseAll();
    this.pressed.clear();
    this.modifiers = { control: false, alt: false, shift: false, meta: false };
    this.bound = (["mute", "deafen"] as const).flatMap((action) => {
      const bind = next[action];
      return bind ? [{ action, trigger: bind.trigger, mode: bind.mode }] : [];
    });
  }

  /** Диалог настроек захватывает клавиши: состояние трекается, действия не отправляются. */
  setSuppressed(value: boolean): void {
    this.suppressed = value;
    if (value) this.releaseAll();
  }

  handleKeyDown(key: GlobalKey): void {
    if (MODIFIER_CODES.has(key.code)) { this.setModifier(key.code, true); return; }
    if (this.pressed.has(key.code)) return; // авто-повтор ОС
    this.pressed.add(key.code);
    if (this.suppressed) return;
    const bind = this.match(key.code);
    if (!bind) return;
    if (bind.mode === "hold") {
      if (this.held.has(bind.action)) return;
      this.held.add(bind.action);
    }
    this.host.send({ action: bind.action, mode: bind.mode, phase: "press" });
  }

  handleKeyUp(key: GlobalKey): void {
    if (MODIFIER_CODES.has(key.code)) { this.setModifier(key.code, false); return; }
    this.pressed.delete(key.code);
    if (this.suppressed) return;
    // Отпускание ищем по коду клавиши среди зажатых биндов: пользователь мог
    // отпустить модификатор раньше самой клавиши, и матч по триггеру бы сорвался.
    for (const action of [...this.held]) {
      const bind = this.bound.find((item) => item.action === action);
      if (bind?.trigger.code === key.code) {
        this.held.delete(action);
        this.host.send({ action, mode: bind.mode, phase: "release" });
      }
    }
  }

  /** Рендерер перезагрузился или бинды сменились — отпускаем зажатое, чтобы состояние не залипло. */
  releaseAll(): void {
    for (const action of [...this.held]) this.host.send({ action, mode: "hold", phase: "release" });
    this.held.clear();
  }

  private match(code: string): BoundAction | null {
    return this.bound.find((bind) => bind.trigger.code === code
      && bind.trigger.control === this.modifiers.control
      && bind.trigger.alt === this.modifiers.alt
      && bind.trigger.shift === this.modifiers.shift
      && bind.trigger.meta === this.modifiers.meta) ?? null;
  }

  private setModifier(code: string, down: boolean): void {
    const name = code.startsWith("Control") ? "control" : code.startsWith("Alt") ? "alt" : code.startsWith("Meta") ? "meta" : "shift";
    this.modifiers[name] = down;
  }
}

export interface GlobalKeybindHook {
  start(onKeyDown: (code: string) => void, onKeyUp: (code: string) => void): Promise<void>;
  stop(): Promise<void>;
}

type UiohookModule = typeof import("uiohook-napi");

// Имена UiohookKey → KeyboardEvent.code. Имена сверены с enum uiohook-napi 1.5.5:
// буквы — «A»…«Z» (не KeyA), цифры — «0»…«9», модификаторы Ctrl/Alt/Shift/Meta.
const NAMED_CODES: Record<string, string> = {
  Enter: "Enter", Backspace: "Backspace", Tab: "Tab", CapsLock: "CapsLock", Escape: "Escape", Space: "Space",
  PageUp: "PageUp", PageDown: "PageDown", End: "End", Home: "Home", Insert: "Insert", Delete: "Delete",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  PrintScreen: "PrintScreen", ScrollLock: "ScrollLock", NumLock: "NumLock",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  F13: "F13", F14: "F14", F15: "F15", F16: "F16", F17: "F17", F18: "F18", F19: "F19", F20: "F20", F21: "F21", F22: "F22", F23: "F23", F24: "F24",
  Semicolon: "Semicolon", Equal: "Equal", Comma: "Comma", Minus: "Minus", Period: "Period", Slash: "Slash",
  Backquote: "Backquote", BracketLeft: "BracketLeft", Backslash: "Backslash", BracketRight: "BracketRight", Quote: "Quote",
  Ctrl: "ControlLeft", CtrlRight: "ControlRight", Alt: "AltLeft", AltRight: "AltRight",
  Meta: "MetaLeft", MetaRight: "MetaRight", Shift: "ShiftLeft", ShiftRight: "ShiftRight",
  NumpadMultiply: "NumpadMultiply", NumpadAdd: "NumpadAdd", NumpadSubtract: "NumpadSubtract",
  NumpadDecimal: "NumpadDecimal", NumpadDivide: "NumpadDivide", NumpadEnter: "NumpadEnter",
  // Навигационные сканкоды цифровой клавиатуры при выключенном NumLock (Windows).
  NumpadInsert: "Numpad0", NumpadEnd: "Numpad1", NumpadArrowDown: "Numpad2", NumpadPageDown: "Numpad3",
  NumpadArrowLeft: "Numpad4", NumpadArrowRight: "Numpad6", NumpadHome: "Numpad7",
  NumpadArrowUp: "Numpad8", NumpadPageUp: "Numpad9", NumpadDelete: "NumpadDecimal",
};

function buildScancodeIndex(key: UiohookModule["UiohookKey"]): Map<number, string> {
  const index = new Map<number, string>();
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const scancode = key[letter as keyof typeof key];
    if (typeof scancode === "number") index.set(scancode, `Key${letter}`);
  }
  for (let digit = 0; digit <= 9; digit += 1) {
    const scancode = key[String(digit) as keyof typeof key];
    if (typeof scancode === "number") index.set(scancode, `Digit${digit}`);
  }
  for (let digit = 0; digit <= 9; digit += 1) {
    const scancode = key[`Numpad${digit}` as keyof typeof key];
    if (typeof scancode === "number") index.set(scancode, `Numpad${digit}`);
  }
  for (const [name, code] of Object.entries(NAMED_CODES)) {
    const scancode = key[name as keyof typeof key];
    if (typeof scancode === "number") index.set(scancode, code);
  }
  return index;
}

/** Пассивный глобальный хук: слушает клавиатуру, НЕ перехватывая события у других приложений. */
export function createUiohookHook(log?: (message: string) => void): GlobalKeybindHook {
  let module: UiohookModule | null = null;
  return {
    async start(onKeyDown, onKeyUp) {
      if (module) return;
      module = await import("uiohook-napi"); // динамически: юнит-тесты и бандл его не трогают
      const index = buildScancodeIndex(module.UiohookKey);
      module.uIOhook.on("keydown", (event) => {
        const code = index.get(event.keycode);
        if (code) onKeyDown(code);
      });
      module.uIOhook.on("keyup", (event) => {
        const code = index.get(event.keycode);
        if (code) onKeyUp(code);
      });
      module.uIOhook.start();
      log?.("global keybind hook started");
    },
    async stop() {
      if (!module) return;
      module.uIOhook.removeAllListeners();
      module.uIOhook.stop();
      module = null;
      log?.("global keybind hook stopped");
    },
  };
}

/** Владеет менеджером и хуком: применяет карту биндов, стартует/останавливает хук по необходимости. */
export class KeybindController {
  private readonly manager: KeybindManager;

  constructor(private readonly host: KeybindHost, private readonly hook: GlobalKeybindHook) {
    this.manager = new KeybindManager(host);
  }

  async configure(input: unknown): Promise<void> {
    const map = keybindMapSchema.parse(input ?? {});
    this.manager.configure(map);
    try {
      if (this.manager.isEmpty) await this.hook.stop();
      else await this.hook.start(
        (code) => this.manager.handleKeyDown({ code }),
        (code) => this.manager.handleKeyUp({ code }),
      );
    } catch (error) {
      // Без хука бинды просто не срабатывают; падать из-за этого нельзя.
      this.host.log?.(`global keybind hook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  setSuppressed(value: boolean): void { this.manager.setSuppressed(value); }

  async stop(): Promise<void> { await this.hook.stop(); }
}
