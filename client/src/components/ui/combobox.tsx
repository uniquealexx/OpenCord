"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";

/** Выпадающий комбобокс в стиле панели поиска: кнопка с иконкой и список опций. */
export function Combobox({ label, value, placeholder, icon: Icon, options, onChange, disabled = false, clearable = true, className }: { label: string; value: string; placeholder: string; icon: typeof User; options: { value: string; label: string; style?: CSSProperties }[]; onChange: (value: string) => void; disabled?: boolean; clearable?: boolean; className?: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (nextValue: string): void => { onChange(nextValue); setOpen(false); };
  return <div ref={rootRef} className={cn("relative min-w-0", className)}>
    <button type="button" role="combobox" aria-label={label} aria-controls={listboxId} aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={() => setOpen((current) => !current)} className={cn("flex h-10 w-full min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-xs shadow-[inset_0_1px_rgba(255,255,255,.025)] transition disabled:pointer-events-none disabled:opacity-45", open ? "border-violet-400/45 bg-raised ring-2 ring-violet-400/10" : "border-white/[.08] bg-panel hover:border-white/[.14] hover:bg-raised")}>
      <Icon className={cn("size-3.5 shrink-0", open ? "text-violet-300" : "text-slate-500")} />
      <span className={cn("min-w-0 flex-1 truncate", selected ? "text-slate-200" : "text-slate-500")} style={selected?.style}>{selected?.label ?? placeholder}</span>
      <ChevronDown className={cn("size-3.5 shrink-0 text-slate-600 transition-transform", open && "rotate-180 text-violet-300")} />
    </button>
    {open && <div id={listboxId} role="listbox" aria-label={label} className="glass absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-52 overflow-y-auto rounded-xl p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.5)]">
      {(clearable ? [{ value: "", label: placeholder }, ...options] : options).map((option) => <button key={option.value || "all"} type="button" role="option" aria-selected={option.value === value} onClick={() => choose(option.value)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition", option.value === value ? "bg-violet-400/14 text-violet-100" : "text-slate-400 hover:bg-white/[.05] hover:text-white")}><span className="min-w-0 flex-1 truncate" style={option.style}>{option.label}</span>{option.value === value && <Check className="size-3.5 shrink-0 text-violet-300" />}</button>)}
    </div>}
  </div>;
}
