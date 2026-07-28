import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
