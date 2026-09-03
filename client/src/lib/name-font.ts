import type { CSSProperties } from "react";
import { NAME_FONT_VALUES, type NameFont } from "@opencord/shared";
import { nameGlowStyle } from "./accent-color";

export { NAME_FONT_VALUES };
export type { NameFont };
/**
 * Шрифт ника: отрисовывается только CSS, текст username не меняется. Пиксель и
 * готика — локальные woff2 из public/fonts (см. @font-face в globals.css),
 * остальное — системные стеки без новых файлов. Декору letter-spacing хватает,
 * чтобы мелкий пиксельный и готический текст не слипался; truncate и layout
 * мест отображения не затрагиваются.
 */
export function nameFontStyle(font: NameFont | null | undefined): CSSProperties {
  switch (font) {
    case "pixel":
      return { fontFamily: '"OpenCord Pixel", Inter, ui-sans-serif, system-ui, sans-serif', letterSpacing: "0.04em" };
    case "gothic":
      return { fontFamily: '"OpenCord Gothic", Georgia, "Times New Roman", serif', letterSpacing: "0.02em" };
    case "italic":
      return { fontStyle: "italic" };
    case "mono":
      return { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' };
    case "serif":
      return { fontFamily: 'Georgia, "Times New Roman", serif' };
    default:
      return {};
  }
}

/**
 * Полный стиль ника: шрифт плюс мягкое свечение, если оно задано. Возвращает
 * undefined без кастомизации, чтобы не плодить пустые style-атрибуты.
 */
export function nicknameStyle(font: NameFont | null | undefined, glow: string | null | undefined): CSSProperties | undefined {
  const style: CSSProperties = { ...nameFontStyle(font) };
  if (glow) Object.assign(style, nameGlowStyle(glow));
  return Object.keys(style).length ? style : undefined;
}
