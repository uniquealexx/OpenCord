// Выбор платформенного моста.
//
// В Electron renderer мост window.openCord устанавливает preload (desktop).
// В Capacitor-оболочке (Android WebView) мост отсутствует, и его подставляет
// installPlatformBridge() — мобильная реализация из ./mobile-bridge.
// В обычном браузере/тестах мост не устанавливается: приложение остаётся
// в демо-режиме без доступа к сети (существующее поведение).

import { Capacitor } from "@capacitor/core";
import type { OpenCordBridge } from "@/shared/bridge";
import { createMobileBridge } from "./mobile-bridge";
import { installNativeShell } from "./native-shell";

export function isMobilePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function installPlatformBridge(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.openCord) return; // desktop preload уже установил мост
  if (!isMobilePlatform()) return;
  // Отступы, клавиатура и кнопка «Назад» приходят из MainActivity через этот объект.
  installNativeShell();
  // Мобильный мост намеренно не реализует desktop-only поверхности (window, deployment,
  // screenShare, updates): renderer читает их через window.openCord?.<field> и получает undefined.
  window.openCord = createMobileBridge() as OpenCordBridge;
}
