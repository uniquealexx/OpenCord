import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog";
import { createDefaultState, DEFAULT_PUSH_TO_TALK_KEY, parsePersistedState } from "@/shared/state";
import type { LocalProfile } from "@/shared/state";

const testProfile: LocalProfile = {
  id: "local-user",
  username: "lina",
  discriminator: "1234",
  bio: "",
  avatar: null,
  banner: null,
  memberBackground: null,
  createdAt: "2026-08-07T00:00:00.000Z",
};

describe("push-to-talk persisted preferences", () => {
  it("defaults to voice activation with KeyV", () => {
    const state = createDefaultState();
    expect(state.preferences.voiceInputMode).toBe("voice");
    expect(state.preferences.pushToTalkKey).toBe("KeyV");
    expect(DEFAULT_PUSH_TO_TALK_KEY).toBe("KeyV");
  });

  it("fills voice and PTT defaults for states saved before the fields existed", () => {
    const state = createDefaultState();
    const olderPreferences = { ...state.preferences } as Partial<typeof state.preferences>;
    delete olderPreferences.voiceInputMode;
    delete olderPreferences.voiceInputDeviceId;
    delete olderPreferences.voiceOutputDeviceId;
    delete olderPreferences.pushToTalkKey;
    delete olderPreferences.echoCancellation;
    delete olderPreferences.noiseSuppression;
    delete olderPreferences.autoGainControl;
    const upgraded = parsePersistedState({ ...state, preferences: olderPreferences });
    expect(upgraded.preferences.voiceInputMode).toBe("voice");
    expect(upgraded.preferences.voiceInputDeviceId).toBeNull();
    expect(upgraded.preferences.voiceOutputDeviceId).toBeNull();
    expect(upgraded.preferences.pushToTalkKey).toBe("KeyV");
    expect(upgraded.preferences.echoCancellation).toBe(true);
    expect(upgraded.preferences.noiseSuppression).toBe(true);
    expect(upgraded.preferences.autoGainControl).toBe(true);
  });

  it("persists a remapped PTT key and accepts non-letter codes", () => {
    const state = createDefaultState();
    expect(parsePersistedState({ ...state, preferences: { ...state.preferences, pushToTalkKey: "Space" } }).preferences.pushToTalkKey).toBe("Space");
    expect(parsePersistedState({ ...state, preferences: { ...state.preferences, voiceInputMode: "push-to-talk", pushToTalkKey: "CapsLock" } }).preferences).toMatchObject({
      voiceInputMode: "push-to-talk",
      pushToTalkKey: "CapsLock",
    });
  });

  it("rejects malformed PTT keys", () => {
    const state = createDefaultState();
    expect(() => parsePersistedState({ ...state, preferences: { ...state.preferences, pushToTalkKey: "" } })).toThrow();
    expect(() => parsePersistedState({ ...state, preferences: { ...state.preferences, pushToTalkKey: "KeyV;drop" } })).toThrow();
  });
});

describe("SettingsDialog push-to-talk", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream),
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

  function renderVoice(preferences = createDefaultState().preferences, onPreferences = vi.fn()) {
    render(<SettingsDialog preferences={preferences} profile={testProfile} open confirmReset={false} initialPage="voice" onOpenChange={vi.fn()} onPreferences={onPreferences} onSaveProfile={vi.fn()} onRequestReset={vi.fn()} onCancelReset={vi.fn()} onReset={vi.fn()} />);
    return onPreferences;
  }

  it("toggles the voice input mode and shows the PTT key only in push-to-talk", async () => {
    const user = userEvent.setup();
    const onPreferences = renderVoice();

    expect(screen.queryByTestId("ptt-key-row")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Push-to-talk" }));
    expect(onPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ voiceInputMode: "push-to-talk" }));

    const pttPreferences = { ...createDefaultState().preferences, voiceInputMode: "push-to-talk" as const };
    cleanup();
    renderVoice(pttPreferences);
    expect(screen.getByTestId("ptt-key-row")).toBeInTheDocument();
    expect(screen.getByText("V")).toBeInTheDocument();
  });

  it("captures a new PTT key from the pressed key", () => {
    const pttPreferences = { ...createDefaultState().preferences, voiceInputMode: "push-to-talk" as const };
    const onPreferences = renderVoice(pttPreferences);
    const row = screen.getByTestId("ptt-key-row");
    fireEvent.click(within(row).getByRole("button", { name: "Изменить" }));
    expect(within(row).getByRole("status")).toHaveTextContent("Нажмите клавишу");
    fireEvent.keyDown(window, { code: "KeyK" });
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ pushToTalkKey: "KeyK" }));
  });

  it("cancels PTT capture on Escape and resets to the default key", async () => {
    const user = userEvent.setup();
    const pttPreferences = { ...createDefaultState().preferences, voiceInputMode: "push-to-talk" as const, pushToTalkKey: "KeyK" };
    const onPreferences = renderVoice(pttPreferences);
    const row = screen.getByTestId("ptt-key-row");

    fireEvent.click(within(row).getByRole("button", { name: "Изменить" }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(onPreferences).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: "Сбросить" }));
    expect(onPreferences).toHaveBeenCalledWith(expect.objectContaining({ pushToTalkKey: "KeyV" }));
  });

  it("explains on the sensitivity page that the VAD threshold is inactive in push-to-talk", () => {
    const props = { open: true, confirmReset: false, initialPage: "sensitivity" as const, profile: testProfile, onOpenChange: vi.fn(), onPreferences: vi.fn(), onSaveProfile: vi.fn(), onRequestReset: vi.fn(), onCancelReset: vi.fn(), onReset: vi.fn() };
    const view = render(<SettingsDialog preferences={createDefaultState().preferences} {...props} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    view.rerender(<SettingsDialog preferences={{ ...createDefaultState().preferences, voiceInputMode: "push-to-talk" }} {...props} />);
    expect(screen.getByRole("note")).toHaveTextContent("микрофон открывается клавишей");
  });
});
