import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultState, type ClientPreferences, type VoiceParticipantSettings } from "@/shared/state";
import { useVoiceSession } from "@/hooks/use-voice-session";

/**
 * Заглушки и громкость применяются к элементам, созданным самой сессией. Раньше они
 * разыскивались через `document.querySelectorAll` по атрибуту `data-opencord-livekit`,
 * то есть состояние голосового соединения читалось из DOM: под управление попал бы любой
 * элемент с подходящей разметкой, а имя участника бралось из `dataset`, который сессия
 * не создавала.
 */
const { roomHandlers } = vi.hoisted(() => ({ roomHandlers: new Map<string, (...args: unknown[]) => void>() }));

vi.mock("livekit-client", () => ({
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor" },
  LocalVideoTrack: class {},
  Room: class {
    static getLocalDevices = vi.fn(async () => []);
    localParticipant = { identity: "me", setScreenShareEnabled: vi.fn(async () => undefined), setMicrophoneEnabled: vi.fn(async () => null), getTrackPublication: vi.fn(() => undefined) };
    remoteParticipants = new Map();
    on(event: string, handler: (...args: unknown[]) => void): this { roomHandlers.set(event, handler); return this; }
    async connect(): Promise<void> { /* соединение в тесте не нужно */ }
    disconnect(): void { /* no-op */ }
    switchActiveDevice = vi.fn(async () => undefined);
  },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    TrackMuted: "trackMuted",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    LocalTrackUnpublished: "localTrackUnpublished",
    ConnectionQualityChanged: "connectionQualityChanged",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
  },
  Track: { Kind: { Audio: "audio", Video: "video" }, Source: { Microphone: "microphone", ScreenShare: "screen_share" } },
  VideoQuality: { HIGH: "high" },
  createAudioAnalyser: vi.fn(() => { throw new Error("unavailable"); }),
}));

const authorization = { channelId: "channel-1", endpoint: "wss://voice.example.test", token: "token", expiresAt: new Date(Date.now() + 60_000).toISOString() };

const renderConnectedSession = async (preferences: ClientPreferences = createDefaultState().preferences, onSettingsChange?: (settings: VoiceParticipantSettings) => void) => {
  // Настройки и обработчики создаются один раз: новая ссылка на каждый рендер
  // перезапускала бы эффект подключения бесконечно.
  const onError = vi.fn();
  const hook = renderHook(() => useVoiceSession(authorization, preferences, onError, onSettingsChange));
  await waitFor(() => expect(hook.result.current.status).toBe("connected"));
  return hook;
};

/** Подписка на микрофон участника так, как её выполняет LiveKit: элемент создаёт сама сессия. */
const subscribeMicrophone = async (identity: string): Promise<HTMLMediaElement> => {
  const element = document.createElement("audio");
  await act(async () => {
    roomHandlers.get("trackSubscribed")?.({ kind: "audio", attach: () => element }, { kind: "audio", source: "microphone", setSubscribed: vi.fn() }, { identity });
  });
  return element;
};

/** Чужой элемент с той же разметкой: сессия его не создавала и трогать не должна. */
const plantForeignElement = (identity: string): HTMLMediaElement => {
  const element = document.createElement("audio");
  element.dataset.opencordLivekit = "true";
  element.dataset.opencordParticipantId = identity;
  document.body.appendChild(element);
  return element;
};

afterEach(() => {
  document.querySelectorAll("audio").forEach((element) => element.remove());
});

describe("audio elements owned by the voice session", () => {
  it("turns incoming audio back on when the microphone is enabled while deafened", async () => {
    const { result } = await renderConnectedSession();
    const remoteAudio = await subscribeMicrophone("them");

    await act(async () => { await result.current.setDeafened(true); });
    expect(result.current).toMatchObject({ muted: true, deafened: true });
    expect(remoteAudio.muted).toBe(true);

    await act(async () => { await result.current.setMuted(false); });
    expect(result.current).toMatchObject({ muted: false, deafened: false });
    expect(remoteAudio.muted).toBe(false);
  });

  it("mutes one remote participant locally and preserves it across deafen toggles", async () => {
    const { result } = await renderConnectedSession();
    const first = await subscribeMicrophone("first-user");
    const second = await subscribeMicrophone("second-user");

    act(() => result.current.setParticipantMuted("first-user", true));
    expect(result.current.locallyMutedParticipantIds).toEqual(["first-user"]);
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(false);

    await act(async () => { await result.current.setDeafened(true); });
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(true);
    await act(async () => { await result.current.setDeafened(false); });
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(false);

    act(() => result.current.setParticipantMuted("first-user", false));
    expect(result.current.locallyMutedParticipantIds).toEqual([]);
    expect(first.muted).toBe(false);
  });

  it("changes only the selected participant volume and clamps the value", async () => {
    const { result } = await renderConnectedSession();
    const first = await subscribeMicrophone("first-user");
    const second = await subscribeMicrophone("second-user");

    act(() => result.current.setParticipantVolume("first-user", 0.35));
    expect(result.current.participantVolumes).toEqual({ "first-user": 0.35 });
    expect(first.volume).toBe(0.35);
    expect(second.volume).toBe(1);

    act(() => result.current.setParticipantVolume("first-user", 2));
    expect(result.current.participantVolumes).toEqual({});
    expect(first.volume).toBe(1);
  });

  it("restores participant audio settings after a new hook instance", async () => {
    const onSettingsChange = vi.fn();
    const firstHook = await renderConnectedSession(createDefaultState().preferences, onSettingsChange);
    act(() => firstHook.result.current.setParticipantMuted("remote-user", true));
    act(() => firstHook.result.current.setParticipantVolume("remote-user", 0.4));
    const savedSettings = (onSettingsChange.mock.calls.at(-1)?.[0] ?? {}) as VoiceParticipantSettings;
    expect(savedSettings).toEqual({ "remote-user": { muted: true, volume: 0.4 } });
    firstHook.unmount();

    await renderConnectedSession({ ...createDefaultState().preferences, voiceParticipantSettings: savedSettings });
    const remoteAudio = await subscribeMicrophone("remote-user");
    expect(remoteAudio.muted).toBe(true);
    expect(remoteAudio.volume).toBe(0.4);
  });

  it("leaves alone an audio element the session did not create", async () => {
    const { result } = await renderConnectedSession();
    const foreign = plantForeignElement("them");
    const owned = await subscribeMicrophone("them");

    await act(async () => { await result.current.setDeafened(true); });
    expect(owned.muted).toBe(true);
    expect(foreign.muted).toBe(false);

    act(() => result.current.setParticipantVolume("them", 0.5));
    expect(owned.volume).toBe(0.5);
    expect(foreign.volume).toBe(1);

    // И обратное: состоянием сессии чужой элемент нельзя расглушить.
    foreign.muted = true;
    await act(async () => { await result.current.setDeafened(false); });
    expect(owned.muted).toBe(false);
    expect(foreign.muted).toBe(true);
  });

  it("stops owning elements after leaving the channel", async () => {
    const { result } = await renderConnectedSession();
    const remoteAudio = await subscribeMicrophone("them");
    expect(remoteAudio.isConnected).toBe(true);

    await act(async () => { await result.current.leave(); });
    expect(remoteAudio.isConnected).toBe(false);

    await act(async () => { await result.current.setDeafened(true); });
    expect(remoteAudio.muted).toBe(false);
  });
});
