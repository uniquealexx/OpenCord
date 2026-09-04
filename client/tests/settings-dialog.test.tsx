import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog";
import { createDefaultState } from "@/shared/state";

describe("SettingsDialog microphone test", () => {
  const stopTrack = vi.fn();
  const applyConstraints = vi.fn(async () => undefined);
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ stop: stopTrack, applyConstraints }] }) as unknown as MediaStream);
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  beforeEach(() => {
    stopTrack.mockClear();
    applyConstraints.mockClear();
    getUserMedia.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    window.openCord = {
      identity: {
        getOrCreate: vi.fn(async () => ({ publicKey: "public-key", fingerprint: "fingerprint", discriminator: "1234" })),
        signChallenge: vi.fn(async () => "signature"),
        reset: vi.fn(async () => ({ publicKey: "new-public-key", fingerprint: "new-fingerprint", discriminator: "9999" })),
      },
    } as unknown as NonNullable<typeof window.openCord>;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
    delete window.openCord;
  });

  it("plays the selected microphone locally and releases it when stopped", async () => {
    const user = userEvent.setup();
    const preferences = createDefaultState().preferences;
    render(<SettingsDialog preferences={preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Прослушать" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Микрофон воспроизводится");
    expect(getUserMedia).toHaveBeenCalledWith({
      video: false,
      audio: expect.objectContaining({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
    });

    await user.click(screen.getByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows and saves a manual microphone threshold when automatic sensitivity is disabled", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    const preferences = createDefaultState().preferences;
    const props = { open: true, confirmReset: false, onOpenChange: vi.fn(), onPreferences, onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={preferences} {...props} />);

    await user.click(screen.getByRole("switch", { name: "Автоматическая чувствительность" }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ automaticInputSensitivity: false }));

    const manualPreferences = { ...preferences, automaticInputSensitivity: false };
    view.rerender(<SettingsDialog preferences={manualPreferences} {...props} />);
    const slider = screen.getByRole("slider", { name: "Ручная чувствительность микрофона" });
    expect(slider).toHaveValue("-45");
    fireEvent.change(slider, { target: { value: "-42" } });
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ automaticInputSensitivity: false, manualInputSensitivityDb: -42 }));
  });

  it("shows an available client update and starts download explicitly", async () => {
    const user = userEvent.setup();
    const download = vi.fn(async () => ({ status: "downloading", currentVersion: "0.1.0-beta.1", channel: "beta", version: "0.2.0-beta.1", percent: 0 }) as const);
    window.openCord!.updates = {
      getState: vi.fn(async () => ({ status: "available", currentVersion: "0.1.0-beta.1", channel: "beta", version: "0.2.0-beta.1", releaseUrl: "https://github.com/uniquealexx/OpenCord/releases/tag/v0.2.0-beta.1", sizeBytes: 10485760 }) as const),
      check: vi.fn(),
      download,
      install: vi.fn(),
      onStateChange: vi.fn(() => () => undefined),
    };
    render(<SettingsDialog preferences={createDefaultState().preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Скачать обновление" }));
    expect(download).toHaveBeenCalledOnce();
    expect(screen.getByText(/0\.2\.0-beta\.1/u)).toBeInTheDocument();
  });

  it("shows the theme mode above the color schemes and saves both", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    render(<SettingsDialog preferences={createDefaultState().preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={onPreferences} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);

    const modeGroup = screen.getByRole("radiogroup", { name: "Тема" });
    expect(within(modeGroup).getAllByRole("radio")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: "Светлая" }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ themeMode: "light" }));

    const schemeGroup = screen.getByRole("radiogroup", { name: "Цветовая схема" });
    expect(within(schemeGroup).getAllByRole("radio")).toHaveLength(6);
    await user.click(screen.getByRole("radio", { name: "Океан" }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ colorTheme: "ocean" }));
  });

  it("shows the dark brightness slider only for the dark appearance", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    const preferences = createDefaultState().preferences;
    const props = { open: true, confirmReset: false, onOpenChange: vi.fn(), onPreferences, onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={preferences} {...props} />);

    // jsdom без matchMedia: системная тема считается тёмной, слайдер виден.
    const slider = screen.getByRole("slider", { name: "Яркость тёмной темы" });
    expect(slider).toHaveValue("1");
    expect(slider).toHaveAttribute("aria-valuetext", "Ночь");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ darkShade: "abyss" }));

    await user.click(screen.getByRole("button", { name: "Туман" }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ darkShade: "mist" }));

    view.rerender(<SettingsDialog preferences={{ ...preferences, themeMode: "light" }} {...props} />);
    expect(screen.queryByRole("slider", { name: "Яркость тёмной темы" })).not.toBeInTheDocument();
  });

  it("toggles RNNoise noise suppression from the voice section", async () => {
    const user = userEvent.setup();
    const onPreferences = vi.fn();
    const preferences = createDefaultState().preferences;
    const props = { open: true, confirmReset: false, onOpenChange: vi.fn(), onPreferences, onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={preferences} {...props} />);

    const toggle = screen.getByRole("switch", { name: "Шумоподавление микрофона (RNNoise)" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ noiseSuppression: false }));

    view.rerender(<SettingsDialog preferences={{ ...preferences, noiseSuppression: false }} {...props} />);
    expect(screen.getByRole("switch", { name: "Шумоподавление микрофона (RNNoise)" })).toHaveAttribute("aria-checked", "false");
  });

  it("requests the microphone with noise suppression disabled when the preference is off", async () => {
    const user = userEvent.setup();
    const preferences = { ...createDefaultState().preferences, noiseSuppression: false };
    render(<SettingsDialog preferences={preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Прослушать" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Микрофон воспроизводится");
    expect(getUserMedia).toHaveBeenCalledWith({
      video: false,
      audio: expect.objectContaining({ channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true }),
    });
  });

  it("keeps the microphone test running while audio preferences change", async () => {
    const user = userEvent.setup();
    const preferences = createDefaultState().preferences;
    const props = { open: true, confirmReset: false, onOpenChange: vi.fn(), onPreferences: vi.fn(), onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={preferences} {...props} />);

    await user.click(screen.getByRole("button", { name: "Прослушать" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Микрофон воспроизводится");
    expect(stopTrack).not.toHaveBeenCalled();

    view.rerender(<SettingsDialog preferences={{ ...preferences, noiseSuppression: false }} {...props} />);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Микрофон воспроизводится");
    expect(applyConstraints).toHaveBeenLastCalledWith(expect.objectContaining({ channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true }));

    view.rerender(<SettingsDialog preferences={{ ...preferences, noiseSuppression: false, voiceInputDeviceId: "mic-2" }} {...props} />);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: false, audio: expect.objectContaining({ deviceId: { exact: "mic-2" }, noiseSuppression: false }) });
    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("Микрофон воспроизводится");

    await user.click(screen.getByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalledTimes(2));
  });

  it("shows the live level meter and threshold marker only in manual sensitivity mode", () => {
    const preferences = createDefaultState().preferences;
    const props = { open: true, confirmReset: false, onOpenChange: vi.fn(), onPreferences: vi.fn(), onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={preferences} {...props} />);
    expect(screen.queryByRole("meter", { name: "Уровень микрофона" })).not.toBeInTheDocument();

    view.rerender(<SettingsDialog preferences={{ ...preferences, automaticInputSensitivity: false }} {...props} />);
    expect(screen.getByRole("meter", { name: "Уровень микрофона" })).toBeInTheDocument();
    expect(screen.getByTestId("mic-level-threshold").style.left).toBe("50%");
    expect(screen.getByTestId("mic-level-fill").style.width).toBe("0%");
  });

  it("copies the public key for manual server installation", async () => {
    const writeText = vi.fn(async () => undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      render(<SettingsDialog preferences={createDefaultState().preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);
      await user.click(await screen.findByRole("button", { name: "Скопировать публичный ключ" }));
      expect(writeText).toHaveBeenCalledWith("public-key");
      expect(await screen.findByText("Скопировано")).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("shows the tag discriminator and reports a new one after the identity reset", async () => {
    const user = userEvent.setup();
    const onIdentityReset = vi.fn();
    render(<SettingsDialog preferences={createDefaultState().preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} onIdentityReset={onIdentityReset} />);

    expect(await screen.findByText("#1234")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сменить ключи" }));
    const confirmButtons = await screen.findAllByRole("button", { name: "Сменить ключи" });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    await screen.findByText("#9999");
    expect(onIdentityReset).toHaveBeenCalledWith(expect.objectContaining({ discriminator: "9999" }));
  });
});

describe("SettingsDialog global keybinds", () => {
  beforeEach(() => {
    window.openCord = {
      identity: {
        getOrCreate: vi.fn(async () => ({ publicKey: "public-key", fingerprint: "fingerprint", discriminator: "1234" })),
        signChallenge: vi.fn(async () => "signature"),
        reset: vi.fn(async () => ({ publicKey: "new-public-key", fingerprint: "new-fingerprint", discriminator: "9999" })),
      },
      keybinds: {
        apply: vi.fn(async () => undefined),
        setCaptureMode: vi.fn(async () => undefined),
        onAction: vi.fn(() => () => undefined),
      },
    } as unknown as NonNullable<typeof window.openCord>;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.openCord;
  });

  function renderDialog(preferences = createDefaultState().preferences, onPreferences = vi.fn()) {
    render(<SettingsDialog preferences={preferences} open confirmReset={false} onOpenChange={vi.fn()} onPreferences={onPreferences} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);
    return onPreferences;
  }

  it("assigns a keybind from the captured key press", () => {
    const onPreferences = renderDialog();
    const row = screen.getByTestId("keybind-row-mute");
    fireEvent.click(within(row).getByRole("button", { name: "Назначить" }));
    expect(window.openCord?.keybinds?.setCaptureMode).toHaveBeenCalledWith(true);
    fireEvent.keyDown(window, { code: "KeyM", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false });
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({
      keybinds: expect.objectContaining({
        mute: { trigger: { code: "KeyM", control: true, alt: false, shift: false, meta: false }, mode: "toggle" },
      }),
    }));
  });

  it("Escape cancels capture and clear removes the bind", () => {
    const preferences = createDefaultState().preferences;
    preferences.keybinds = { mute: { trigger: { code: "KeyM", control: false, alt: false, shift: false, meta: false }, mode: "toggle" }, deafen: null };
    const onPreferences = renderDialog(preferences);
    const row = screen.getByTestId("keybind-row-mute");
    fireEvent.click(within(row).getByRole("button", { name: "Назначить" }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(onPreferences).not.toHaveBeenCalled();
    expect(screen.getByText("M")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Сбросить" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ keybinds: { mute: null, deafen: null } }));
  });

  it("switches the mode and updates the existing bind", () => {
    const preferences = createDefaultState().preferences;
    preferences.keybinds = { mute: { trigger: { code: "KeyM", control: true, alt: false, shift: false, meta: false }, mode: "toggle" }, deafen: null };
    const onPreferences = renderDialog(preferences);
    const row = screen.getByTestId("keybind-row-mute");
    fireEvent.click(within(row).getByRole("button", { name: "Удержание" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({
      keybinds: expect.objectContaining({ mute: { trigger: { code: "KeyM", control: true, alt: false, shift: false, meta: false }, mode: "hold" } }),
    }));
  });

  it("shows the conflict warning for duplicate triggers", () => {
    const preferences = createDefaultState().preferences;
    const trigger = { code: "KeyM", control: false, alt: false, shift: false, meta: false };
    preferences.keybinds = { mute: { trigger, mode: "toggle" }, deafen: { trigger, mode: "hold" } };
    renderDialog(preferences);
    expect(screen.getAllByText("Эта комбинация уже занята другим действием")).toHaveLength(2);
  });

  it("renders both action rows in the default dialog", () => {
    // Санити: обе строки присутствуют в дефолтном диалоге.
    renderDialog();
    expect(screen.getByTestId("keybind-row-mute")).toBeInTheDocument();
    expect(screen.getByTestId("keybind-row-deafen")).toBeInTheDocument();
  });
});
