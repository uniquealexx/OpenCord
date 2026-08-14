/** Поддерживаемые языки интерфейса клиента. Порядок = порядок в селекторе настроек. */
export const LANGUAGES = ["en", "ru", "zh"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/** Название языка на его собственном языке — не переводится в словарях. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  ru: "Русский",
  zh: "中文",
};

/** Локаль BCP 47 для Intl-форматирования дат, чисел и регистро-зависимого поиска. */
export const LANGUAGE_LOCALES: Record<Language, string> = {
  en: "en-US",
  ru: "ru",
  zh: "zh-CN",
};

/** Атрибут lang для <html>. */
export const LANGUAGE_HTML_LANG: Record<Language, string> = {
  en: "en",
  ru: "ru",
  zh: "zh-CN",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}
