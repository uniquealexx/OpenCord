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
