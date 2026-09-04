"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Keyboard, Pencil, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { liveModifierParts, splitTriggerParts, triggerFromKeyboardEvent } from "@/lib/keybinds";
import {
  KEYBIND_MODES,
  canonicalModifierCode,
  isModifierCode,
  modifierFamily,
  normalizeTrigger,
  sameTrigger,
  type Keybind,
  type KeybindAction,
  type KeybindMode,
  type ModifierFamily,
} from "@/shared/keybinds";

interface LiveModifiers { control: boolean; alt: boolean; shift: boolean; meta: boolean }
const NO_MODIFIERS: LiveModifiers = { control: false, alt: false, shift: false, meta: false };

function KeyCaps({ parts, tone }: { parts: string[]; tone: "violet" | "amber" }): React.ReactElement {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 && <span aria-hidden className="text-[11px] font-bold text-slate-600">+</span>}
          <kbd className={cn(
            "rounded-md border px-1.5 py-0.5 font-sans text-xs font-semibold shadow-[0_2px_4px_rgba(0,0,0,.35)]",
            tone === "amber"
              ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
              : "border-white/12 bg-white/[.07] text-slate-100",
          )}>{part}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function KeybindRow({ action, title, hint, icon: Icon, bind, conflict, onCapture, onClear }: {
  action: KeybindAction;
  title: string;
  hint: string;
  icon: LucideIcon;
  bind: Keybind | null | undefined;
  conflict: Keybind | null | undefined;
  onCapture: (bind: Keybind) => void;
  onClear: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [mode, setMode] = useState<KeybindMode>(bind?.mode ?? "toggle");
  const [capturing, setCapturing] = useState(false);
  const [live, setLive] = useState<LiveModifiers>(NO_MODIFIERS);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; });
  const sessionRef = useRef<{ families: Set<ModifierFamily>; hadKey: boolean }>({ families: new Set(), hadKey: false });

  useEffect(() => {
    if (!capturing) return;
    // Пока ловим клавишу, глушим действия биндов в main — иначе нажатие уже
    // назначенной комбинации сработало бы прямо в момент назначения.
    // (Сброс сессии захвата — в startCapture, здесь только подписки.)
    void window.openCord?.keybinds?.setCaptureMode(true);
    const finish = (next: Keybind): void => {
      onCaptureRef.current(next);
      setCapturing(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") { setCapturing(false); return; }
      const family = modifierFamily(event.code);
      if (family && isModifierCode(event.code)) {
        // Модификатор пока не фиксируем: ждём либо обычную клавишу (комбо),
        // либо отпускание в одиночку (бинд на сам модификатор).
        sessionRef.current.families.add(family);
        setLive({ control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
        return;
      }
      sessionRef.current.hadKey = true;
      finish({ trigger: normalizeTrigger(triggerFromKeyboardEvent(event)), mode: modeRef.current });
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      const family = modifierFamily(event.code);
      if (!family || !isModifierCode(event.code)) return;
      const next: LiveModifiers = { control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      setLive(next);
      // Одиночный модификатор: обычных клавиш не было, за сессию нажат только
      // он и после отпускания ничего не зажато — назначаем его самого.
      const session = sessionRef.current;
      const alone = !session.hadKey && session.families.size === 1 && session.families.has(family)
        && !next.control && !next.alt && !next.shift && !next.meta;
      if (alone) {
        finish({
          trigger: {
            code: canonicalModifierCode(family),
            control: family === "control",
            alt: family === "alt",
            shift: family === "shift",
            meta: family === "meta",
          },
          mode: modeRef.current,
        });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      void window.openCord?.keybinds?.setCaptureMode(false);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [capturing]);

  const changeMode = (next: KeybindMode): void => {
    setMode(next);
    if (bind) onCapture({ ...bind, mode: next });
  };

  const conflicted = Boolean(bind && conflict && sameTrigger(bind.trigger, conflict.trigger));
  const liveParts = liveModifierParts(live);

  const toggleCapture = (): void => {
    if (capturing) { setCapturing(false); return; }
    sessionRef.current = { families: new Set(), hadKey: false };
    setLive(NO_MODIFIERS);
    setCapturing(true);
  };

  return (
    <div
      data-testid={`keybind-row-${action}`}
      className={cn(
        "rounded-xl border p-3 transition-colors",
        capturing
          ? "border-violet-400/40 bg-violet-400/[.06] shadow-[0_0_0_1px_rgba(167,139,250,.25),0_8px_24px_-12px_rgba(139,92,246,.5)]"
          : conflicted
            ? "border-amber-300/25 bg-amber-300/[.04]"
            : "border-white/7 bg-white/[.025]",
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          conflicted ? "bg-amber-300/10 text-amber-200" : "bg-violet-400/10 text-violet-200",
        )}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200">{title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>
        </div>
        <div role="group" aria-label={title} className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-black/25 p-1 ring-1 ring-inset ring-white/8">
          {KEYBIND_MODES.map((value) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
              className={mode === value
                ? "rounded-md bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(139,92,246,.45)]"
                : "rounded-md px-3 py-1.5 text-xs text-slate-500 transition-colors hover:text-slate-200"}>
              {value === "toggle" ? t.settings.keybindModeToggle : t.settings.keybindModeHold}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-black/25 px-3 py-2 ring-1 ring-inset ring-white/8">
        {capturing ? (
          <span role="status" className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-violet-400" />
            </span>
            {liveParts.length > 0
              ? <KeyCaps parts={[...liveParts, "…"]} tone="violet" />
              : <span className="text-sm text-violet-200">{t.settings.keybindListening}</span>}
          </span>
        ) : bind ? (
          <KeyCaps parts={splitTriggerParts(bind.trigger)} tone={conflicted ? "amber" : "violet"} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Keyboard className="size-3.5" />{t.settings.keybindUnbound}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!capturing && bind && (
            <Button variant="ghost" size="sm" aria-label={t.settings.keybindClear} title={t.settings.keybindClear} onClick={onClear}>
              <X className="size-4" />
            </Button>
          )}
          <Button variant={capturing ? "danger" : "secondary"} size="sm" onClick={toggleCapture}>
            {!capturing && <Pencil className="size-3.5" />}
            {capturing ? t.settings.keybindCancel : t.settings.keybindBindAction}
          </Button>
        </div>
      </div>
      {capturing && <p className="mt-2 text-[11px] leading-4 text-slate-500">{t.settings.keybindAloneHint}</p>}
      {conflicted && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-300"><TriangleAlert className="size-3.5" />{t.settings.keybindConflict}</p>}
    </div>
  );
}
