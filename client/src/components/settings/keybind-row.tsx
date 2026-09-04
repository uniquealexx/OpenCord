"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatTrigger, isBindableKey, triggerFromKeyboardEvent } from "@/lib/keybinds";
import { KEYBIND_MODES, sameTrigger, type Keybind, type KeybindAction, type KeybindMode } from "@/shared/keybinds";

export function KeybindRow({ action, title, hint, bind, conflict, onCapture, onClear }: {
  action: KeybindAction;
  title: string;
  hint: string;
  bind: Keybind | null | undefined;
  conflict: Keybind | null | undefined;
  onCapture: (bind: Keybind) => void;
  onClear: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [mode, setMode] = useState<KeybindMode>(bind?.mode ?? "toggle");
  const [capturing, setCapturing] = useState(false);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    if (!capturing) return;
    // Пока ловим клавишу, глушим действия биндов в main — иначе нажатие уже
    // назначенной комбинации сработало бы прямо в момент назначения.
    void window.openCord?.keybinds?.setCaptureMode(true);
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") { setCapturing(false); return; }
      if (!isBindableKey(event)) return;
      onCapture({ trigger: triggerFromKeyboardEvent(event), mode: modeRef.current });
      setCapturing(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      void window.openCord?.keybinds?.setCaptureMode(false);
      window.removeEventListener("keydown", onKeyDown, true);
    };
    // onCapture приходит из диалога и меняется при каждом рендере; реф не нужен,
    // т.к. эффект перезапускается только при смене capturing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const changeMode = (next: KeybindMode): void => {
    setMode(next);
    if (bind) onCapture({ ...bind, mode: next });
  };

  const conflicted = Boolean(bind && conflict && sameTrigger(bind.trigger, conflict.trigger));

  return (
    <div className="rounded-xl border border-white/7 bg-white/[.025] p-3" data-testid={`keybind-row-${action}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-300">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1">
          {KEYBIND_MODES.map((value) => (
            <button key={value} type="button" aria-pressed={mode === value} onClick={() => changeMode(value)}
              className={mode === value ? "rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white" : "rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:text-slate-200"}>
              {value === "toggle" ? t.settings.keybindModeToggle : t.settings.keybindModeHold}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        {capturing ? (
          <span role="status" className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold text-violet-200">{t.settings.keybindListening}</span>
        ) : bind ? (
          <span className={cn("min-w-16 rounded-lg px-3 py-2 text-center text-sm font-bold", conflicted ? "bg-amber-400/10 text-amber-200" : "bg-violet-400/10 text-violet-200")}>{formatTrigger(bind.trigger)}</span>
        ) : (
          <span className="text-xs text-slate-500">{t.settings.keybindUnbound}</span>
        )}
        <div className="flex items-center gap-2">
          {!capturing && bind && <Button variant="secondary" size="sm" onClick={onClear}>{t.settings.keybindClear}</Button>}
          <Button variant={capturing ? "danger" : "secondary"} size="sm" onClick={() => setCapturing((current) => !current)}>{capturing ? t.settings.keybindCancel : t.settings.keybindBindAction}</Button>
        </div>
      </div>
      {conflicted && <p className="mt-2 text-xs text-amber-300">{t.settings.keybindConflict}</p>}
    </div>
  );
}
