import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApp } from "@/components/client-app";
import { MOBILE_LAYOUT_MAX_WIDTH, shouldUseMobileLayout } from "@/hooks/use-mobile-layout";
import { applyInsets, applyKeyboardHeight, installNativeShell, registerBackHandler, runBackHandlers, setExitHintHandler } from "@/platform/native-shell";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { fireEvent } from "@testing-library/react";
import { createDefaultState, type PersistedClientState } from "@/shared/state";

function readyState(): PersistedClientState {
  const state: PersistedClientState = {
    ...createDefaultState(),
    onboardingComplete: true,
    profile: { id: "local-user", username: "lina", discriminator: "1234", bio: "", avatar: null, banner: null, memberBackground: null, createdAt: new Date().toISOString() },
  };
  state.servers = [{
    id: "test-server",
    name: "Тестовый сервер",
    address: null,
    accent: "#7c5cff",
    maxAttachmentBytes: 10 * 1024 * 1024,
    channels: [
      { id: "welcome", serverId: "test-server", name: "добро-пожаловать", kind: "text", description: "Начните знакомство", participantLimit: null, slowmodeSeconds: 0 },
      { id: "voice", serverId: "test-server", name: "Гостиная", kind: "voice", description: "Голосовой канал", participantLimit: 25, slowmodeSeconds: 0 },
    ],
    members: [],
  }];
  state.messages = [{ id: "welcome-message", channelId: "welcome", authorId: "member", authorName: "Мира", authorColor: "#7c5cff", content: "Тестовое сообщение", createdAt: new Date().toISOString() }];
  state.activeServerId = "test-server";
  state.activeChannelId = "welcome";
  return state;
}

/** Сужает окно до телефонного и сообщает об этом подписчикам resize. */
function useNarrowViewport(width = 390): void {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

describe("mobile layout", () => {
  beforeEach(() => {
    window.openCord = {
      window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onMaximizedChange: vi.fn(() => () => undefined) },
      storage: { load: vi.fn(async () => readyState()), save: vi.fn(async (state: PersistedClientState) => state), reset: vi.fn(async () => createDefaultState()) },
      identity: { getOrCreate: vi.fn(async () => ({ publicKey: "test-public-key-test-public-key-test-public-key", fingerprint: "test", discriminator: "1234" })), signChallenge: vi.fn(async () => "s".repeat(64)), reset: vi.fn() },
      attachments: { selectAndUpload: vi.fn(async () => null), uploadFile: vi.fn(), download: vi.fn(async () => true), preview: vi.fn(async () => ""), setLatencySensitive: vi.fn(async () => undefined) },
    } as unknown as Window["openCord"];
  });

  afterEach(() => {
    cleanup();
    window.innerWidth = 1024;
    setExitHintHandler(null);
  });

  it("switches to the phone layout only below the breakpoint or on the native shell", () => {
    expect(shouldUseMobileLayout(MOBILE_LAYOUT_MAX_WIDTH - 1, false)).toBe(true);
    expect(shouldUseMobileLayout(MOBILE_LAYOUT_MAX_WIDTH, false)).toBe(false);
    // Планшет в Android-оболочке шире точки перелома, но раскладка всё равно мобильная.
    expect(shouldUseMobileLayout(1280, true)).toBe(true);
  });

  it("hides the channel column behind a drawer and opens it from the header", async () => {
    const user = userEvent.setup();
    useNarrowViewport();
    render(<ClientApp />);

    const openChannels = await screen.findByRole("button", { name: "Открыть каналы" });
    // До открытия панель отодвинута за экран, поэтому чат занимает всю ширину.
    const drawer = document.querySelector("main > div.z-40");
    expect(drawer?.className).toContain("-translate-x-full");

    await user.click(openChannels);
    await waitFor(() => expect(document.querySelector("main > div.z-40")?.className).toContain("translate-x-0"));
    expect(openChannels).toHaveAttribute("aria-pressed", "true");
  });

  it("gives the Android back button the topmost layer first and reports when nothing is left", async () => {
    const user = userEvent.setup();
    useNarrowViewport();
    render(<ClientApp />);

    const openChannels = await screen.findByRole("button", { name: "Открыть каналы" });
    await user.click(openChannels);
    await waitFor(() => expect(openChannels).toHaveAttribute("aria-pressed", "true"));

    // Первое «Назад» закрывает панель, второе возвращает к списку каналов.
    expect(runBackHandlers()).toBe(true);
    await waitFor(() => expect(openChannels).toHaveAttribute("aria-pressed", "false"));
    expect(runBackHandlers()).toBe(true);
    await waitFor(() => expect(openChannels).toHaveAttribute("aria-pressed", "true"));
  });

  it("runs back handlers from the innermost layer outwards and stops after one handles it", () => {
    const calls: string[] = [];
    const removeOuter = registerBackHandler(() => {
      calls.push("outer");
      return true;
    });
    const removeInner = registerBackHandler(() => {
      calls.push("inner");
      return true;
    });
    expect(runBackHandlers()).toBe(true);
    expect(calls).toEqual(["inner"]);

    removeInner();
    expect(runBackHandlers()).toBe(true);
    expect(calls).toEqual(["inner", "outer"]);

    removeOuter();
    expect(runBackHandlers()).toBe(false);
  });

  it("publishes system insets and the keyboard height as CSS variables", () => {
    applyInsets(24, 48, 0, 0);
    applyKeyboardHeight(320);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--android-inset-top")).toBe("24px");
    expect(root.style.getPropertyValue("--android-inset-bottom")).toBe("48px");
    expect(root.style.getPropertyValue("--android-keyboard-height")).toBe("320px");
    expect(root.dataset.keyboard).toBe("open");

    applyKeyboardHeight(0);
    expect(root.dataset.keyboard).toBe("closed");
    // Отрицательные и нечисловые значения не должны ломать вёрстку.
    applyInsets(-10, Number.NaN, 0, 0);
    expect(root.style.getPropertyValue("--android-inset-top")).toBe("0px");
    expect(root.style.getPropertyValue("--android-inset-bottom")).toBe("0px");
  });

  it("exposes the native shell entry points the Android activity calls", () => {
    installNativeShell();
    const hint = vi.fn();
    setExitHintHandler(hint);
    window.__opencordNative?.exitHint();
    expect(hint).toHaveBeenCalledOnce();
    expect(typeof window.__opencordNative?.back).toBe("function");
    expect(typeof window.__opencordNative?.setInsets).toBe("function");
  });
});

describe("mobile bottom sheet", () => {
  // Настоящее touch-событие всегда несёт и touches, и changedTouches; Radix
  // (react-remove-scroll) читает именно changedTouches, поэтому в тесте нужны оба.
  function touchAt(clientY: number): { touches: { clientX: number; clientY: number }[]; changedTouches: { clientX: number; clientY: number }[] } {
    const point = { clientX: 0, clientY };
    return { touches: [point], changedTouches: [point] };
  }

  function renderSheet(onOpenChange = vi.fn()): { onOpenChange: ReturnType<typeof vi.fn>; sheet: HTMLElement } {
    window.innerWidth = 390;
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-label="sheet">
          <p>содержимое</p>
        </DialogContent>
      </Dialog>,
    );
    return { onOpenChange, sheet: screen.getByRole("dialog") };
  }

  afterEach(() => {
    cleanup();
    window.innerWidth = 1024;
    applyKeyboardHeight(0);
    applyInsets(0, 0, 0, 0);
    applyKeyboardHeight(0);
  });

  it("closes when the sheet is pulled far enough down", () => {
    const { onOpenChange, sheet } = renderSheet();
    fireEvent.touchStart(sheet, touchAt(100));
    fireEvent.touchMove(sheet, touchAt(260));
    fireEvent.touchEnd(sheet, touchAt(260));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open after a short pull and springs back", () => {
    const { onOpenChange, sheet } = renderSheet();
    fireEvent.touchStart(sheet, touchAt(100));
    fireEvent.touchMove(sheet, touchAt(140));
    fireEvent.touchEnd(sheet, touchAt(140));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("leaves the gesture alone on a desktop-width window", () => {
    const onOpenChange = vi.fn();
    window.innerWidth = 1280;
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-label="dialog"><p>содержимое</p></DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.touchStart(dialog, touchAt(100));
    fireEvent.touchMove(dialog, touchAt(400));
    fireEvent.touchEnd(dialog, touchAt(400));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("takes the keyboard height from the hidden part of the visual viewport", () => {
    const root = document.documentElement;
    applyKeyboardHeight(300);
    expect(root.style.getPropertyValue("--android-keyboard-height")).toBe("300px");
    expect(root.dataset.keyboard).toBe("open");

    // Система сама ужала окно под клавиатуру — скрытой части нет, и смещать
    // вёрстку второй раз нельзя.
    applyKeyboardHeight(0);
    expect(root.style.getPropertyValue("--android-keyboard-height")).toBe("0px");
    expect(root.dataset.keyboard).toBe("closed");

    // Мелкое изменение вьюпорта клавиатурой не считается.
    applyKeyboardHeight(40);
    expect(root.style.getPropertyValue("--android-keyboard-height")).toBe("0px");
  });
});
