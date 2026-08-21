"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COLOR_SWATCHES = [
  "#4d6bfe", "#58b0ff", "#22d3ee", "#2dd4bf", "#34d399", "#84cc16",
  "#fbbf24", "#fb923c", "#f87171", "#fb7185", "#e879f9", "#c084fc",
  "#8b5cf6", "#6366f1", "#64748b", "#94a3b8", "#f8fafc", "#d6d3d1",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

export function ColorPicker({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const validDraft = HEX_COLOR.test(draft);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function updateDraft(nextValue: string): void {
    const next = !nextValue ? "" : nextValue.startsWith("#") ? nextValue : `#${nextValue}`;
    setDraft(next.slice(0, 7));
    if (HEX_COLOR.test(next)) onChange(next.toLowerCase());
  }

  function toggleOpen(): void {
    if (!open) setDraft(value);
    setOpen((current) => !current);
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={toggleOpen} className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-2.5 text-xs text-slate-300 transition hover:border-white/20 hover:bg-white/[.065] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60">
        <span className="size-5 rounded-full ring-1 ring-white/25" style={{ backgroundColor: value }} />
        <Palette className="size-3.5 text-slate-500" />
        <span className="font-mono text-[11px] uppercase text-slate-400">{value}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="glass-clear mt-2 w-full max-w-sm rounded-2xl p-3 shadow-[0_20px_65px_rgba(0,0,0,.42)]">
          <div className="mb-3 flex items-center gap-2">
            <span className="size-8 rounded-xl ring-1 ring-white/20" style={{ backgroundColor: value }} />
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-slate-200">{label}</p><p className="font-mono text-[10px] uppercase text-slate-500">{value}</p></div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-white"><X className="size-3.5" /></button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {COLOR_SWATCHES.map((color) => (
              <button key={color} type="button" aria-label={color} aria-pressed={value.toLowerCase() === color} onClick={() => { onChange(color); setDraft(color); }} className={cn("relative grid aspect-square min-w-0 place-items-center rounded-xl border transition hover:scale-105", value.toLowerCase() === color ? "border-white/70 ring-2 ring-white/15" : "border-white/10 hover:border-white/35")} style={{ backgroundColor: color }}>
                {value.toLowerCase() === color && <Check className={cn("size-3.5", color === "#f8fafc" || color === "#d6d3d1" ? "text-slate-800" : "text-white")} />}
              </button>
            ))}
          </div>
          <label className="mt-3 grid gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">
            HEX
            <Input aria-label={`${label} HEX`} value={draft} onChange={(event) => updateDraft(event.target.value)} maxLength={7} spellCheck={false} className={cn("h-9 bg-black/10 font-mono uppercase", !validDraft && "border-red-400/50 text-red-200")} />
          </label>
        </div>
      )}
    </div>
  );
}
