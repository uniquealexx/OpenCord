"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { clamp01, FALLBACK_ACCENT_COLOR, hexToHsv, hsvToHex, normalizeHexColor, PRESET_ACCENT_COLORS, type HsvColor } from "@/lib/accent-color";
import { cn } from "@/lib/utils";

const HUE_GRADIENT = "linear-gradient(to bottom, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";
const CUSTOM_SWATCH_GRADIENT = "conic-gradient(from 180deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";

/**
 * Сетка пресетов с квадратом «свой цвет» и HSV-поповером. Общий элемент
 * кастомизации профиля: так оформлены и акцент превью, и свечение ника.
 */
export function ColorSwatchPicker({ value, onChange, groupLabel, customLabel, extra }: { value: string; onChange: (color: string) => void; groupLabel: string; customLabel: string; extra?: React.ReactNode }): React.ReactElement {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const knownPresets = PRESET_ACCENT_COLORS.includes(value.toLowerCase() as (typeof PRESET_ACCENT_COLORS)[number]);
  return (
    <div role="radiogroup" aria-label={groupLabel} className="relative flex flex-wrap items-center gap-2.5">
      {PRESET_ACCENT_COLORS.map((color) => {
        const selected = value.toLowerCase() === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t.profile.accentColorPreset(color)}
            title={t.profile.accentColorPreset(color)}
            onClick={() => onChange(color)}
            className={cn(
              "grid size-8 place-items-center rounded-full transition duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70",
              selected ? "ring-2 ring-white/85 ring-offset-2 ring-offset-panel" : "ring-1 ring-white/15 hover:ring-white/40",
            )}
            style={{ backgroundColor: color }}
          >
            {selected && <Check className="size-4 text-[#fff] drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]" />}
          </button>
        );
      })}
      {/* Свой цвет: открывает пикер из квадрата насыщенности и полосы тона. */}
      <button
        type="button"
        aria-label={customLabel}
        aria-expanded={pickerOpen}
        title={customLabel}
        onClick={() => setPickerOpen((open) => !open)}
        className={cn(
          "relative grid size-8 place-items-center overflow-hidden rounded-full transition duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70",
          pickerOpen || !knownPresets ? "ring-2 ring-white/85 ring-offset-2 ring-offset-panel" : "ring-1 ring-white/15 hover:ring-white/40",
        )}
        style={{ background: CUSTOM_SWATCH_GRADIENT }}
      >
        {!knownPresets && <Check className="size-4 text-[#fff] drop-shadow-[0_1px_2px_rgba(0,0,0,.8)]" />}
      </button>
      {extra}
      {pickerOpen && <AccentColorPopover value={value} onSelect={onChange} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

export function AccentColorPicker({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <ColorSwatchPicker
        value={value ?? FALLBACK_ACCENT_COLOR}
        onChange={onChange}
        groupLabel={t.profile.accentColor}
        customLabel={t.profile.accentColorCustom}
        extra={value && (
          <button
            type="button"
            aria-label={t.profile.accentColorReset}
            title={t.profile.accentColorReset}
            onClick={() => onChange(null)}
            className="grid size-8 place-items-center rounded-full border border-white/[.07] bg-white/[.025] text-slate-400 transition hover:scale-105 hover:bg-white/[.05] hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      />
      <p className="text-[11px] leading-4 text-slate-500">{t.profile.accentColorHint}</p>
    </div>
  );
}

/** Пикер в духе графических редакторов: квадрат S/V, вертикальный тон, поле HEX. */
function AccentColorPopover({ value, onSelect, onClose }: { value: string; onSelect: (color: string) => void; onClose: () => void }): React.ReactElement {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const committed = useRef(value);

  useEffect(() => {
    // Внешняя смена значения (пресет, сброс) синхронизирует пикер, если пользователь
    // не тащит курсор по квадрату прямо сейчас.
    if (value !== committed.current) {
      committed.current = value;
      setHsv(hexToHsv(value));
      setHexDraft(null);
    }
  }, [value]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  function select(next: HsvColor): void {
    setHsv(next);
    const hex = hsvToHex(next);
    committed.current = hex;
    setHexDraft(null);
    onSelect(hex);
  }

  function trackPointer(event: React.PointerEvent<HTMLDivElement>, pick: (rect: DOMRect, x: number, y: number) => HsvColor): void {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    select(pick(rect, event.clientX, event.clientY));
  }

  function movePointer(event: React.PointerEvent<HTMLDivElement>, pick: (rect: DOMRect, x: number, y: number) => HsvColor): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    select(pick(rect, event.clientX, event.clientY));
  }

  const pickSquare = (rect: DOMRect, x: number, y: number): HsvColor => ({
    h: hsv.h,
    s: clamp01((x - rect.left) / rect.width),
    v: 1 - clamp01((y - rect.top) / rect.height),
  });
  const pickHue = (rect: DOMRect, _x: number, y: number): HsvColor => ({ h: clamp01((y - rect.top) / rect.height) * 360, s: hsv.s, v: hsv.v });

  async function copy(): Promise<void> {
    const hex = hexDraft ?? hsvToHex(hsv);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch { /* поле остаётся доступным для ручного копирования */ }
  }

  const hex = hexDraft ?? hsvToHex(hsv);
  return (
    <div ref={popoverRef} className="absolute right-0 top-11 z-30 w-[236px] rounded-xl border border-white/10 bg-panel p-3 shadow-[0_18px_50px_rgba(0,0,0,.5)]" data-testid="accent-color-popover">
      <div className="flex gap-2.5">
        <div
          role="slider"
          aria-label={t.profile.accentColorSaturation}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={hex}
          tabIndex={0}
          className="relative h-[136px] flex-1 cursor-crosshair touch-none rounded-lg border border-white/10"
          style={{ background: `linear-gradient(to top, #000000, rgba(0,0,0,0)), linear-gradient(to right, #ffffff, hsl(${hsv.h} 100% 50%))` }}
          onPointerDown={(event) => trackPointer(event, pickSquare)}
          onPointerMove={(event) => movePointer(event, pickSquare)}
        >
          <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,.7)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hsvToHex(hsv) }} />
        </div>
        <div
          role="slider"
          aria-label={t.profile.accentColorHue}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuemin={0}
          aria-valuemax={360}
          tabIndex={0}
          className="relative h-[136px] w-3.5 cursor-pointer touch-none rounded-full border border-white/10"
          style={{ background: HUE_GRADIENT }}
          onPointerDown={(event) => trackPointer(event, pickHue)}
          onPointerMove={(event) => movePointer(event, pickHue)}
        >
          <span className="pointer-events-none absolute h-2 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,.7)]" style={{ left: "50%", top: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h} 100% 50%)` }} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={hex}
          onChange={(event) => {
            const draft = event.target.value;
            setHexDraft(draft);
            const normalized = normalizeHexColor(draft);
            if (normalized) {
              committed.current = normalized;
              setHsv(hexToHsv(normalized));
              onSelect(normalized);
            }
          }}
          onBlur={() => setHexDraft(null)}
          maxLength={7}
          spellCheck={false}
          aria-label={t.profile.accentColorHex}
          className="h-8 flex-1 bg-black/30 font-mono text-xs"
        />
        <button
          type="button"
          aria-label={t.profile.accentColorCopy}
          title={t.profile.accentColorCopy}
          onClick={() => void copy()}
          className="grid size-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
        >
          {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
