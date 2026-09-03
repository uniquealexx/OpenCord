"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_THEMES, type ColorTheme } from "@/shared/state";

const THEME_PREVIEWS: Record<ColorTheme, { canvas: string; panel: string; accent: string; secondary: string }> = {
  midnight: { canvas: "#212327", panel: "#2b2d32", accent: "#405fe8", secondary: "#176fae" },
  amethyst: { canvas: "#211f29", panel: "#302b39", accent: "#7c3aed", secondary: "#a82bb5" },
  ocean: { canvas: "#172326", panel: "#24353a", accent: "#0f766e", secondary: "#126f89" },
  forest: { canvas: "#1d241f", panel: "#2c382f", accent: "#26734d", secondary: "#657d28" },
  sunset: { canvas: "#29211e", panel: "#3a2f2a", accent: "#ad4029", secondary: "#966a05" },
  rose: { canvas: "#271f25", panel: "#392d36", accent: "#a43b65", secondary: "#875bc3" },
};

export function ThemeSelector({
  value,
  label,
  labels,
  onChange,
  className,
}: {
  value: ColorTheme;
  label: string;
  labels: Record<ColorTheme, string>;
  onChange: (theme: ColorTheme) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
      {COLOR_THEMES.map((theme) => {
        const selected = value === theme;
        const preview = THEME_PREVIEWS[theme];
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={labels[theme]}
            onClick={() => onChange(theme)}
            className={cn(
              "group relative flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
              selected
                ? "border-violet-400/50 bg-violet-400/10 text-violet-100 ring-1 ring-violet-400/20"
                : "border-white/[.07] bg-white/[.025] text-slate-300 hover:border-white/[.14] hover:bg-white/[.045]",
            )}
          >
            <span
              aria-hidden="true"
              className="relative flex size-10 shrink-0 items-end gap-1 overflow-hidden rounded-lg border border-white/10 p-1.5 shadow-[inset_0_1px_rgba(255,255,255,.06)]"
              style={{ backgroundColor: preview.canvas }}
            >
              <span className="h-full w-2 rounded-sm" style={{ backgroundColor: preview.panel }} />
              <span className="h-3 flex-1 rounded-sm" style={{ backgroundColor: preview.accent }} />
              <span className="h-5 w-1.5 rounded-sm" style={{ backgroundColor: preview.secondary }} />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{labels[theme]}</span>
            {selected && <Check aria-hidden="true" className="absolute right-1.5 top-1.5 size-3.5 text-violet-300" />}
          </button>
        );
      })}
    </div>
  );
}
