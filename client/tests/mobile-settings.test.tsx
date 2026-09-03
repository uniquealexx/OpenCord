import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSettingsScreen } from "@/mobile/screens/settings-screen";
import { dictionaryFor, type Dictionary } from "@/lib/i18n";
import { runBackHandlers } from "@/platform/native-shell";
import { createDefaultState } from "@/shared/state";

// Без <I18nRoot> useI18n() отдаёт русский словарь — это задокументированный
// fallback модуля i18n, на который опирается остальной набор тестов.
const t = (): Dictionary => dictionaryFor("ru");

function renderSettings(overrides: Partial<React.ComponentProps<typeof MobileSettingsScreen>> = {}): void {
  render(
    <MobileSettingsScreen
      preferences={createDefaultState().preferences}
      confirmReset={false}
      onClose={vi.fn()}
      onPreferences={vi.fn()}
      onRequestReset={vi.fn()}
      onCancelReset={vi.fn()}
      onReset={vi.fn()}
      {...overrides}
    />,
  );
}

describe("mobile settings screen", () => {
  beforeEach(() => {
    window.openCord = {
      identity: {
        getOrCreate: vi.fn(async () => ({ publicKey: "public-key", fingerprint: "AA:BB", discriminator: "1234" })),
        reset: vi.fn(async () => ({ publicKey: "next-key", fingerprint: "CC:DD", discriminator: "5678" })),
        signChallenge: vi.fn(),
      },
    } as unknown as Window["openCord"];
  });

  afterEach(cleanup);

  it("shows sections as a list instead of one long form", () => {
    renderSettings();
    expect(screen.getByRole("heading", { name: t().settings.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t().settings.appearance) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t().settings.voice) })).toBeInTheDocument();
    // Пока раздел не открыт, его элементы управления не занимают место на экране.
    expect(screen.queryByRole("radio", { name: t().settings.pushToTalk })).not.toBeInTheDocument();
  });

  it("opens a section and returns from it with the header button", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("button", { name: new RegExp(t().settings.voice) }));
    expect(screen.getByRole("radio", { name: t().settings.voiceActivation })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t().common.back }));
    await waitFor(() => expect(screen.queryByRole("radio", { name: t().settings.voiceActivation })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: t().settings.title })).toBeInTheDocument();
  });

  it("shows the theme mode and color scheme and saves choices", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    renderSettings({ onPreferences });

    const appearance = screen.getByRole("button", { name: new RegExp(t().settings.appearance) });
    const firstGroup = appearance.closest("section");
    expect(firstGroup).not.toBeNull();
    const links = within(firstGroup!).getAllByRole("button");
    expect(links[0]).toBe(appearance);
    expect(links[1]).toBe(screen.getByRole("button", { name: new RegExp(t().settings.themeMode) }));
    expect(links[2]).toBe(screen.getByRole("button", { name: new RegExp(t().settings.colorTheme) }));

    await user.click(links[1]!);
    expect(screen.getByRole("radiogroup", { name: t().settings.themeMode })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: t().settings.colorTheme })).toBeInTheDocument();
    // jsdom без matchMedia: системная тема считается тёмной, слайдер виден.
    expect(screen.getByRole("slider", { name: t().settings.darkShade })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: t().settings.themeModeNames.light }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ themeMode: "light" }));
    await user.click(screen.getByRole("radio", { name: t().settings.colorThemeNames.sunset }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ colorTheme: "sunset" }));
  });

  it("lets the Android back button leave a section without closing settings", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSettings({ onClose });

    await user.click(screen.getByRole("button", { name: new RegExp(t().settings.language) }));
    expect(screen.getByRole("radio", { name: "English" })).toBeInTheDocument();

    // Внутри раздела «Назад» поднимает на оглавление…
    expect(runBackHandlers()).toBe(true);
    await waitFor(() => expect(screen.getByRole("heading", { name: t().settings.title })).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();

    // …а на оглавлении настройки уже не перехватывают событие.
    expect(runBackHandlers()).toBe(false);
  });

  it("applies a choice from a section without leaving it", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    renderSettings({ onPreferences });

    await user.click(screen.getByRole("button", { name: new RegExp(t().settings.voice) }));
    await user.click(screen.getByRole("radio", { name: t().settings.pushToTalk }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ voiceInputMode: "push-to-talk" }));
  });

  it("replaces the section list with a confirmation before a destructive reset", () => {
    renderSettings({ confirmReset: true });
    expect(screen.getByText(t().settings.resetConfirm)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t().settings.language) })).not.toBeInTheDocument();
  });
});
