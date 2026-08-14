"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function TitleBar(): React.ReactElement | null {
  const [maximized, setMaximized] = useState(false);
  const [available, setAvailable] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const bridge = window.openCord?.window;
    if (!bridge) return;
    void bridge.isMaximized().then((value) => {
      setMaximized(value);
      setAvailable(true);
    });
    return bridge.onMaximizedChange(setMaximized);
  }, []);

  // Заголовок окна нужен только в Electron; в мобильной оболочке и в браузере
  // моста нет. Условие после первого эффекта, чтобы серверная разметка и гидрация совпадали.
  if (!available) return null;

  return (
    <header className="titlebar-drag flex h-10 shrink-0 items-center justify-between border-b border-white/[0.06] bg-rail pl-4 select-none">
      <div className="flex items-center gap-2.5 text-xs font-medium tracking-wide text-slate-400">
        <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-[10px] font-bold text-white">O</span>
        {t.appName}
        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">{t.prototype}</span>
      </div>
      <div className="titlebar-no-drag flex h-full">
        <WindowButton label={t.window.minimize} onClick={() => void window.openCord?.window.minimize()}><Minus className="size-4" /></WindowButton>
        <WindowButton label={maximized ? t.window.restore : t.window.maximize} onClick={() => void window.openCord?.window.toggleMaximize().then(setMaximized)}>{maximized ? <Square className="size-3" /> : <Maximize2 className="size-3.5" />}</WindowButton>
        <WindowButton label={t.window.close} danger onClick={() => void window.openCord?.window.close()}><X className="size-4" /></WindowButton>
      </div>
    </header>
  );
}

function WindowButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return <button aria-label={label} title={label} onClick={onClick} className={`grid h-full w-12 place-items-center text-slate-500 transition ${danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-white/8 hover:text-slate-100"}`}>{children}</button>;
}
