"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { DARK_SHADES, THEME_MODES, type DarkShade, type ThemeMode } from "@/shared/state";

const MODE_META: Record<ThemeMode, { icon: typeof Moon; swatch: React.ReactNode }> = {
  system: {
    icon: Monitor,
    swatch: (
      <span aria-hidden="true" className="flex size-full overflow-hidden rounded-[5px]">
        <span className="h-full flex-1 bg-[#e9ebf1]" />
        <span className="h-full flex-1 bg-[#212327]" />
      </span>
    ),
  },
  dark: {
    icon: Moon,
    swatch: (
      <span aria-hidden="true" className="relative flex size-full items-end gap-1 overflow-hidden rounded-[5px] bg-[#212327] p-1.5">
        <span className="h-full w-2 rounded-sm bg-[#2b2d32]" />
        <span className="h-3 flex-1 rounded-sm bg-[#405fe8]" />
      </span>
    ),
  },
  light: {
    icon: Sun,
    swatch: (
      <span aria-hidden="true" className="relative flex size-full items-end gap-1 overflow-hidden rounded-[5px] bg-[#e9ebf1] p-1.5">
        <span className="h-full w-2 rounded-sm bg-[#ffffff] shadow-[0_0_0_1px_rgb(20_24_32/.08)]" />
        <span className="h-3 flex-1 rounded-sm bg-[#405fe8]" />
      </span>
    ),
  },
};

/**
 * Выбор глобальной темы: системная / тёмная / светлая.
 * Дизайн карточек повторяет ThemeSelector (цветовые схемы), блок ставится выше него.
 */
export function ThemeModeSelector({
  value,
  label,
  labels,
  onChange,
  className,
}: {
  value: ThemeMode;
  label: string;
  labels: Record<ThemeMode, string>;
  onChange: (mode: ThemeMode) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid grid-cols-3 gap-2", className)}>
      {THEME_MODES.map((mode) => {
        const selected = value === mode;
        const meta = MODE_META[mode];
        const Icon = meta.icon;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labels[mode]}
            onClick={() => onChange(mode)}
            className={cn(
              "group relative flex min-h-16 flex-col items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
              selected
                ? "border-violet-400/50 bg-violet-400/10 text-violet-100 ring-1 ring-violet-400/20"
                : "border-white/[.07] bg-white/[.025] text-slate-300 hover:border-white/[.14] hover:bg-white/[.045]",
            )}
          >
            <span
              aria-hidden="true"
              className="relative flex size-10 shrink-0 items-stretch overflow-hidden rounded-lg border border-white/10 p-0 shadow-[inset_0_1px_rgba(255,255,255,.06)]"
            >
              {meta.swatch}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{labels[mode]}</span>
            </span>
            {selected && <Check aria-hidden="true" className="absolute right-1.5 top-1.5 size-3.5 text-violet-300" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Яркость тёмной темы: Туман / Ночь / Мрак (по умолчанию Ночь — текущие цвета).
 * Слайдер на 3 позиции + кликабельные подписи, как просили. Показывается только
 * когда эффективное оформление тёмное (явный выбор или системная тёмная).
 */
export function DarkShadeSlider({
  value,
  label,
  labels,
  hint,
  onChange,
  className,
}: {
  value: DarkShade;
  label: string;
  labels: Record<DarkShade, string>;
  hint?: string;
  onChange: (shade: DarkShade) => void;
  className?: string;
}): React.ReactElement {
  const index = Math.max(0, DARK_SHADES.indexOf(value));
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        <span className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-1.5 text-center text-xs font-bold text-violet-200">
          {labels[value]}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={labels[value]}
        min={0}
        max={DARK_SHADES.length - 1}
        step={1}
        value={index}
        onChange={(event) => {
          const next = DARK_SHADES[Number(event.target.value)];
          if (next) onChange(next);
        }}
        className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15"
      />
      <div className="mt-1.5 grid grid-cols-3" role="group" aria-label={label}>
        {DARK_SHADES.map((shade) => (
          <button
            key={shade}
            type="button"
            aria-pressed={value === shade}
            onClick={() => onChange(shade)}
            className={cn(
              "rounded-md px-1 py-1 text-[11px] font-medium transition",
              value === shade ? "text-violet-200" : "text-slate-500 hover:text-slate-200",
              shade === "mist" && "text-left",
              shade === "night" && "text-center",
              shade === "abyss" && "text-right",
            )}
          >
            {labels[shade]}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}
