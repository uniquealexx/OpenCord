"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { en, type Dictionary } from "./en";
import { ru } from "./ru";
import { zh } from "./zh";
import { DEFAULT_LANGUAGE, LANGUAGE_HTML_LANG, LANGUAGE_LOCALES, type Language } from "./languages";

export type { Dictionary };
export { DEFAULT_LANGUAGE, LANGUAGE_LABELS, LANGUAGE_LOCALES, LANGUAGES, type Language } from "./languages";

export const dictionaries: Record<Language, Dictionary> = { en, ru, zh };

export function dictionaryFor(language: Language): Dictionary {
  return dictionaries[language];
}

/** Язык для кода вне React-дерева (хуки, служебные функции, ошибки в момент вызова). */
let activeLanguage: Language = DEFAULT_LANGUAGE;
const languageListeners = new Set<() => void>();

export function getActiveLanguage(): Language {
  return activeLanguage;
}

/** Синхронизирует глобальный язык из настроек. Вызывается из ClientApp при загрузке состояния. */
export function setActiveLanguage(language: Language): void {
  if (activeLanguage === language) return;
  activeLanguage = language;
  for (const listener of languageListeners) listener();
}

function subscribeLanguage(listener: () => void): () => void {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export interface I18nValue {
  language: Language;
  t: Dictionary;
  /** Локаль BCP 47 для Intl.DateTimeFormat и регистро-зависимого поиска. */
  locale: string;
}

/**
 * Значение по умолчанию — русский словарь: компоненты, отрендеренные без <I18nRoot>
 * (в unit-тестах), сохраняют поведение существующего русскоязычного набора тестов.
 * В приложении page.tsx всегда оборачивает дерево в <I18nRoot>, поэтому этот
 * fallback в продакшене не используется.
 */
const I18nContext = createContext<I18nValue>({ language: "ru", t: ru, locale: LANGUAGE_LOCALES.ru });

/**
 * Корневой провайдер языка. Читает глобальный язык через useSyncExternalStore,
 * чтобы язык можно было менять из любой точки приложения.
 */
export function I18nRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  const language = useSyncExternalStore(subscribeLanguage, getActiveLanguage, getActiveLanguage);
  const value = useMemo<I18nValue>(() => ({ language, t: dictionaries[language], locale: LANGUAGE_LOCALES[language] }), [language]);
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_HTML_LANG[language];
  }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** Словарь для кода вне React-дерева — берёт язык на момент вызова. */
export function currentDictionary(): Dictionary {
  return dictionaries[getActiveLanguage()];
}
