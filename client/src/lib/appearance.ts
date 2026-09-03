"use client";

import { useEffect, useState } from "react";
import type { ThemeMode } from "@/shared/state";

export type EffectiveAppearance = "dark" | "light";

/** Эффективное оформление: явный выбор или слежение за системой. */
export function resolveAppearance(themeMode: ThemeMode, systemDark: boolean): EffectiveAppearance {
  if (themeMode === "dark") return "dark";
  if (themeMode === "light") return "light";
  return systemDark ? "dark" : "light";
}

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Тема ОС через matchMedia. Кросс-платформенно: Windows/macOS/Linux в Electron
 * (Chromium), Android WebView и браузеры — нативный код не нужен.
 * Фолбэк — тёмная: сохраняет текущий вид там, где ОС тему не сообщает
 * (некоторые Linux-окружения, SSR, тесты без matchMedia).
 */
export function getSystemDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/** Живое слежение за темой ОС: переключение в системе применяется сразу. */
export function useSystemDark(): boolean {
  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    // Старые WebView без MediaQueryList.addEventListener.
    if (typeof query.addListener === "function") {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);
  return systemDark;
}
