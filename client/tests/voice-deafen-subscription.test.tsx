import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultState } from "@/shared/state";
import { useVoiceSession } from "@/hooks/use-voice-session";

/**
 * Выключенный <audio> лишь не воспроизводит уже полученный поток: дорожки остаются
 * подписанными, голос комнаты продолжает идти по сети и доступен «оглохшему» клиенту.
 * Заглушка ушей обязана снимать подписку.
 */
const { roomHandlers, publications, remoteParticipantsMock } = vi.hoisted(() => {
  const publications = {
    microphone: { kind: "audio", source: "microphone", setSubscribed: vi.fn() },
    screenShareAudio: { kind: "audio", source: "screen_share_audio", setSubscribed: vi.fn() },
    screenShareVideo: { kind: "video", source: "screen_share", setSubscribed: vi.fn() },
  };
  return {
    roomHandlers: new Map<string, (...args: unknown[]) => void>(),
    publications,
    remoteParticipantsMock: new Map([["them", { identity: "them", trackPublications: new Map(Object.entries(publications)) }]]),
  };
});

vi.mock("livekit-client", () => ({
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor" },
  LocalVideoTrack: class {},
  Room: class {
    static getLocalDevices = vi.fn(async () => []);
    localParticipant = { identity: "me", setScreenShareEnabled: vi.fn(async () => undefined), setMicrophoneEnabled: vi.fn(async () => null), getTrackPublication: vi.fn(() => undefined) };
    remoteParticipants = remoteParticipantsMock;
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

const renderConnectedSession = async () => {
  // Настройки и обработчик ошибок создаются один раз: новая ссылка на каждый рендер
  // перезапускала бы эффект подключения бесконечно.
  const preferences = createDefaultState().preferences;
  const onError = vi.fn();
  const hook = renderHook(() => useVoiceSession(authorization, preferences, onError));
  await waitFor(() => expect(hook.result.current.status).toBe("connected"));
  return hook;
};

describe("deafening stops incoming audio", () => {
  beforeEach(() => {
    for (const publication of Object.values(publications)) publication.setSubscribed.mockClear();
    document.querySelectorAll("audio[data-opencord-livekit='true']").forEach((element) => element.remove());
  });

  it("unsubscribes from every remote audio track and subscribes back on undeafen", async () => {
    const { result } = await renderConnectedSession();

    await act(async () => { await result.current.setDeafened(true); });
    expect(publications.microphone.setSubscribed).toHaveBeenCalledWith(false);
    expect(publications.screenShareAudio.setSubscribed).toHaveBeenCalledWith(false);
    // Демонстрация экрана — не звук: заглушка ушей не должна гасить картинку.
    expect(publications.screenShareVideo.setSubscribed).not.toHaveBeenCalled();

    await act(async () => { await result.current.setDeafened(false); });
    expect(publications.microphone.setSubscribed).toHaveBeenLastCalledWith(true);
    expect(publications.screenShareAudio.setSubscribed).toHaveBeenLastCalledWith(true);
  });

  it("subscribes back when the microphone is enabled while deafened", async () => {
    const { result } = await renderConnectedSession();

    await act(async () => { await result.current.setDeafened(true); });
    await act(async () => { await result.current.setMuted(false); });
    expect(result.current.deafened).toBe(false);
    expect(publications.microphone.setSubscribed).toHaveBeenLastCalledWith(true);
  });

  it("refuses a track published by a participant who joins while deafened", async () => {
    const { result } = await renderConnectedSession();
    await act(async () => { await result.current.setDeafened(true); });

    const publication = { kind: "audio", source: "microphone", setSubscribed: vi.fn() };
    const track = { kind: "audio", attach: vi.fn(() => document.createElement("audio")) };
    await act(async () => {
      roomHandlers.get("trackSubscribed")?.(track, publication, { identity: "late-joiner" });
    });

    expect(publication.setSubscribed).toHaveBeenCalledWith(false);
    expect(track.attach).not.toHaveBeenCalled();
    expect(document.querySelectorAll("audio[data-opencord-livekit='true']")).toHaveLength(0);
  });
});
