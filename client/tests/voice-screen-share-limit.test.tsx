import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultState } from "@/shared/state";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { currentDictionary } from "@/lib/i18n";

/**
 * Разрешение демонстрации выбирает клиент, и в токене LiveKit ограничить его нечем,
 * поэтому предел, заданный владельцем сервера, применяется по факту публикации: сервер
 * глушит слишком большую дорожку. Оставленная после этого «идущей» демонстрация
 * выглядела бы работающей, ничего не передавая, — клиент обязан её остановить.
 */
const { roomHandlers, setScreenShareEnabled } = vi.hoisted(() => ({
  roomHandlers: new Map<string, (...args: unknown[]) => void>(),
  setScreenShareEnabled: vi.fn(async () => undefined),
}));

vi.mock("livekit-client", () => ({
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor" },
  LocalVideoTrack: class {},
  Room: class {
    static getLocalDevices = vi.fn(async () => []);
    localParticipant = { identity: "me", setScreenShareEnabled, setMicrophoneEnabled: vi.fn(async () => null), getTrackPublication: vi.fn(() => undefined) };
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

describe("server-side screen share limit", () => {
  it("stops the local screen share and explains why when the server mutes it", async () => {
    const onError = vi.fn();
    renderHook(() => useVoiceSession(authorization, createDefaultState().preferences, onError));
    await waitFor(() => expect(roomHandlers.has("trackMuted")).toBe(true));

    await act(async () => {
      roomHandlers.get("trackMuted")?.({ source: "screen_share" }, { identity: "me" });
    });

    expect(setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(onError).toHaveBeenCalledWith(currentDictionary().voiceErrors.screenShareBlocked);
  });

  it("ignores a muted microphone and a remote participant's muted screen share", async () => {
    const onError = vi.fn();
    setScreenShareEnabled.mockClear();
    renderHook(() => useVoiceSession(authorization, createDefaultState().preferences, onError));
    await waitFor(() => expect(roomHandlers.has("trackMuted")).toBe(true));

    await act(async () => {
      // Собственный микрофон: обычная заглушка, к демонстрации отношения не имеет.
      roomHandlers.get("trackMuted")?.({ source: "microphone" }, { identity: "me" });
      // Чужая демонстрация: останавливать её не наше дело.
      roomHandlers.get("trackMuted")?.({ source: "screen_share" }, { identity: "someone-else" });
    });

    expect(setScreenShareEnabled).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
