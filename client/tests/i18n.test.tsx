import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Onboarding } from "@/components/onboarding";
import { SettingsDialog } from "@/components/settings-dialog";
import { dictionaries, I18nRoot, setActiveLanguage, useI18n } from "@/lib/i18n";
import { createDefaultState, parsePersistedState } from "@/shared/state";

function LanguageProbe(): React.ReactElement {
  const { language, t } = useI18n();
  return <p data-testid="probe">{language}: {t.onboarding.title}</p>;
}

afterEach(() => {
  setActiveLanguage("en");
  cleanup();
});

describe("i18n", () => {
  it("switches the active dictionary when the language changes", () => {
    setActiveLanguage("en");
    const { unmount } = render(<I18nRoot><LanguageProbe /></I18nRoot>);
    expect(screen.getByTestId("probe")).toHaveTextContent("Welcome to OpenCord");
    act(() => setActiveLanguage("zh"));
    expect(screen.getByTestId("probe")).toHaveTextContent("欢迎使用 OpenCord");
    act(() => setActiveLanguage("ru"));
    expect(screen.getByTestId("probe")).toHaveTextContent("Добро пожаловать в OpenCord");
    unmount();
  });

  it("updates the html lang attribute from the active language", () => {
    document.documentElement.lang = "en";
    const { unmount } = render(<I18nRoot><LanguageProbe /></I18nRoot>);
    act(() => setActiveLanguage("zh"));
    expect(document.documentElement.lang).toBe("zh-CN");
    unmount();
  });

  it("keeps all dictionaries structurally identical to the canonical English one", () => {
    const keyPaths = (value: unknown, prefix = ""): string[] => {
      if (typeof value !== "object" || value === null) return [prefix];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
    };
    const canonical = keyPaths(dictionaries.en).sort();
    expect(keyPaths(dictionaries.ru).sort()).toEqual(canonical);
    expect(keyPaths(dictionaries.zh).sort()).toEqual(canonical);
  });

  it("defaults new installations to English and migrates stored states without a language to English", () => {
    expect(createDefaultState().preferences.language).toBe("en");
    const legacyState = createDefaultState();
    delete (legacyState.preferences as Partial<typeof legacyState.preferences>).language;
    expect(parsePersistedState(legacyState).preferences.language).toBe("en");
  });

  it("switches the onboarding screen with the active language", () => {
    setActiveLanguage("en");
    const { unmount } = render(<I18nRoot><Onboarding language="en" onLanguageChange={setActiveLanguage} onComplete={vi.fn()} /></I18nRoot>);
    expect(screen.getByRole("heading", { name: "Welcome to OpenCord" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Display name")).toBeInTheDocument();
    act(() => setActiveLanguage("zh"));
    expect(screen.getByRole("heading", { name: "欢迎使用 OpenCord" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("显示名称")).toBeInTheDocument();
    unmount();
  });

  it("selects the language from the settings dialog", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    const preferences = createDefaultState().preferences;
    render(<SettingsDialog preferences={preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={onPreferences} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);
    // Вне провайдера компоненты используют русский словарь по умолчанию.
    expect(screen.getByText("Язык")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "中文" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ language: "zh" }));
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
    await user.click(screen.getByRole("button", { name: "Русский" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ language: "ru" }));
  });
});
