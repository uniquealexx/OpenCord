// Утилиты акцентного цвета превью профиля: пресеты, формат HEX без альфы и
// преобразования HSV для собственного пикера. Формат хранения — #rrggbb
// (строчные), как требует profileAccentColorSchema в протоколе.

import type { CSSProperties } from "react";

export const PRESET_ACCENT_COLORS = ["#4d6bfe", "#58b0ff", "#8fa5ff", "#7c3aed", "#a43b65", "#e11d63", "#ad4029", "#f59e0b", "#26734d", "#34d399", "#0f766e", "#94a3b8"] as const;

export const FALLBACK_ACCENT_COLOR = "#7c3aed";

/** Альфа стекла карточки с акцентом: заметно, но не перекрикивает контент. */
export const ACCENT_GLASS_ALPHA = "73";

export function accentGlassBackground(accentColor: string): string {
  return `${accentColor}${ACCENT_GLASS_ALPHA}`;
}

/**
 * Порог относительной яркости (WCAG), выше которого акцент считается светлым:
 * на такой заливке белый текст теряет читаемость, и палитра карточки
 * переключается на тёмный текст.
 */
export const BRIGHT_ACCENT_LUMINANCE = 0.35;

export function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return 0;
  const int = parseInt(match[1]!, 16);
  const channel = (shift: number): number => {
    const raw = ((int >> shift) & 255) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function isBrightAccent(hex: string): boolean {
  return relativeLuminance(hex) > BRIGHT_ACCENT_LUMINANCE;
}

export interface AccentCardPalette {
  heading: string;
  soft: string;
  muted: string;
  icon: string;
  code: string;
  boxBg: string;
  boxBorder: string;
  badgeText: string;
  badgeBg: string;
  badgeBorder: string;
}

/**
 * Палитра текста карточки превью. Без акцента — текущий вид стекла. На тёмном
 * акценте вторичный текст ярче обычного (slate-400 плохо читается сквозь
 * заливку), на светлом — весь текст тёмный.
 */
export function accentCardPalette(accentColor: string | null): AccentCardPalette {
  if (!accentColor) return { heading: "#ffffff", soft: "#cbd5e1", muted: "#94a3b8", icon: "rgba(196, 181, 253, .7)", code: "rgba(196, 181, 253, .9)", boxBg: "rgba(0, 0, 0, .15)", boxBorder: "rgba(255, 255, 255, .06)", badgeText: "#ddd6fe", badgeBg: "rgba(167, 139, 250, .1)", badgeBorder: "rgba(196, 181, 253, .15)" };
  if (isBrightAccent(accentColor)) return { heading: "#0f172a", soft: "#1e293b", muted: "#334155", icon: "#6d28d9", code: "#5b21b6", boxBg: "rgba(15, 23, 42, .08)", boxBorder: "rgba(15, 23, 42, .14)", badgeText: "#4c1d95", badgeBg: "rgba(124, 58, 237, .16)", badgeBorder: "rgba(91, 33, 182, .3)" };
  return { heading: "#ffffff", soft: "#f1f5f9", muted: "#e2e8f0", icon: "rgba(221, 214, 254, .75)", code: "rgba(221, 214, 254, .95)", boxBg: "rgba(0, 0, 0, .2)", boxBorder: "rgba(255, 255, 255, .08)", badgeText: "#ddd6fe", badgeBg: "rgba(139, 92, 246, .16)", badgeBorder: "rgba(196, 181, 253, .25)" };
}

export function accentCardStyle(accentColor: string | null): CSSProperties {
  const palette = accentCardPalette(accentColor);
  return {
    "--pv-heading": palette.heading,
    "--pv-soft": palette.soft,
    "--pv-muted": palette.muted,
    "--pv-icon": palette.icon,
    "--pv-code": palette.code,
    "--pv-box-bg": palette.boxBg,
    "--pv-box-border": palette.boxBorder,
    "--pv-badge-text": palette.badgeText,
    "--pv-badge-bg": palette.badgeBg,
    "--pv-badge-border": palette.badgeBorder,
  } as CSSProperties;
}

/**
 * Мягкое статичное свечение ника: два слоя тени — узкий плотный ореол у букв и
 * широкий рассеянный, поэтому свечение читается как «дымка», а не как обводка.
 */
export function nameGlowStyle(color: string): CSSProperties {
  return { textShadow: `0 0 4px ${color}8c, 0 0 12px ${color}59` };
}

export interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const channel = (offset: number): string => {
    const k = (offset + h / 60) % 6;
    const value = v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

export function hexToHsv(hex: string): HsvColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return { h: 0, s: 0, v: 0 };
  const int = parseInt(match[1]!, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** Приводит ввод пользователя (#abc-подобные формы отбрасываем) к каноничному #rrggbb. */
export function normalizeHexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
