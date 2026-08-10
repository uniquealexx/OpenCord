import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog";
import { createDefaultState } from "@/shared/state";

describe("SettingsDialog microphone test", () => {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }) as unknown as MediaStream);
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  beforeEach(() => {
    stopTrack.mockClear();
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
        getOrCreate: vi.fn(async () => ({ publicKey: "public-key", fingerprint: "fingerprint" })),
        signChallenge: vi.fn(async () => "signature"),
        reset: vi.fn(async () => ({ publicKey: "new-public-key", fingerprint: "new-fingerprint" })),
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
});
