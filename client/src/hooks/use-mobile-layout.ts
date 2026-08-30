"use client";

import { useEffect, useState } from "react";
import { isMobilePlatform } from "@/platform";

/**
 * Ниже этой ширины интерфейс переключается на телефонную раскладку: одна колонка,
 * навигация в выдвижных панелях. Значение совпадает с Tailwind-точкой `md`, поэтому
 * утилиты `max-md:` в разметке и логика здесь переключаются одновременно.
 *
 * Десктопное окно Electron не опускается ниже 1040px (`electron/main.ts`), так что
 * на десктопе раскладка не меняется; браузерный превью и планшеты получают ту же
 * мобильную вёрстку, что и Android.
 */
export const MOBILE_LAYOUT_MAX_WIDTH = 768;

export function shouldUseMobileLayout(width: number, nativeMobile: boolean): boolean {
  return nativeMobile || width < MOBILE_LAYOUT_MAX_WIDTH;
}

/** Телефонная раскладка: нативная Android-оболочка либо узкое окно. Реагирует на поворот экрана. */
export function useMobileLayout(): boolean {
  // Стартуем с десктопного значения: статический экспорт Next.js рендерит разметку
  // без доступа к window, и расхождение гидрации ломало бы первый кадр.
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const apply = (): void => setMobile(shouldUseMobileLayout(window.innerWidth, isMobilePlatform()));
    apply();
    // matchMedia отсутствует в jsdom и в очень старых WebView — там достаточно resize.
    const query = window.matchMedia?.(`(max-width: ${MOBILE_LAYOUT_MAX_WIDTH - 1}px)`);
    query?.addEventListener("change", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      query?.removeEventListener("change", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return mobile;
}
