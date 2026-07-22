"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { ru } from "@/lib/i18n/ru";

export function TitleBar(): React.ReactElement {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const bridge = window.openCord?.window;
    if (!bridge) return;
    void bridge.isMaximized().then(setMaximized);
    return bridge.onMaximizedChange(setMaximized);
  }, []);

  return (
    <header className="titlebar-drag flex h-10 shrink-0 items-center justify-between border-b border-white/[0.055] bg-[#080a10] pl-4 select-none">
      <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wide text-slate-400">
        <span className="grid size-5 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-cyan-400 text-[10px] font-black text-white shadow-[0_0_18px_rgba(124,92,255,.35)]">O</span>
        {ru.appName}
        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">{ru.prototype}</span>
      </div>
      <div className="titlebar-no-drag flex h-full">
        <WindowButton label={ru.window.minimize} onClick={() => void window.openCord?.window.minimize()}><Minus className="size-4" /></WindowButton>
        <WindowButton label={maximized ? ru.window.restore : ru.window.maximize} onClick={() => void window.openCord?.window.toggleMaximize().then(setMaximized)}>{maximized ? <Square className="size-3" /> : <Maximize2 className="size-3.5" />}</WindowButton>
        <WindowButton label={ru.window.close} danger onClick={() => void window.openCord?.window.close()}><X className="size-4" /></WindowButton>
      </div>
    </header>
  );
}

function WindowButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return <button aria-label={label} title={label} onClick={onClick} className={`grid h-full w-12 place-items-center text-slate-500 transition ${danger ? "hover:bg-red-500 hover:text-white" : "hover:bg-white/8 hover:text-slate-100"}`}>{children}</button>;
}
