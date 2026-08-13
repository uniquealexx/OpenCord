import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultState } from "@/shared/state";
import { useVoiceSession } from "@/hooks/use-voice-session";

// LiveKit's Room.getLocalDevices() without a kind acquires the camera when any
// device label is hidden, so the webcam briefly turned on after joining a voice
// channel. The hook must enumerate devices by explicit audio kind only.
const { getLocalDevices } = vi.hoisted(() => ({
  getLocalDevices: vi.fn(async (kind?: string): Promise<MediaDeviceInfo[]> => {
    if (kind === "audioinput") return [{ deviceId: "mic", kind: "audioinput", label: "Микрофон", groupId: "mic-group" } as MediaDeviceInfo];
    if (kind === "audiooutput") return [{ deviceId: "speaker", kind: "audiooutput", label: "Динамики", groupId: "speaker-group" } as MediaDeviceInfo];
    return [{ deviceId: "camera", kind: "videoinput", label: "", groupId: "camera-group" } as MediaDeviceInfo];
  }),
}));

vi.mock("livekit-client", () => ({
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor" },
  LocalVideoTrack: class {},
  Room: class { static getLocalDevices = getLocalDevices; },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
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

describe("voice device enumeration", () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  let deviceChangeListeners: Array<() => void> = [];

  beforeEach(() => {
    getLocalDevices.mockClear();
    deviceChangeListeners = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        addEventListener: vi.fn((type: string, listener: () => void) => { if (type === "devicechange") deviceChangeListeners.push(listener); }),
        removeEventListener: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("enumerates only audio device kinds and never triggers a camera request", async () => {
    const { result } = renderHook(() => useVoiceSession(null, createDefaultState().preferences, vi.fn()));

    for (const listener of deviceChangeListeners) await act(async () => listener());

    expect(getLocalDevices).toHaveBeenCalledWith("audioinput");
    expect(getLocalDevices).toHaveBeenCalledWith("audiooutput");
    expect(getLocalDevices).not.toHaveBeenCalledWith();
    expect(result.current.inputDevices).toEqual([{ deviceId: "mic", kind: "audioinput", label: "Микрофон", groupId: "mic-group" }]);
    expect(result.current.outputDevices).toEqual([{ deviceId: "speaker", kind: "audiooutput", label: "Динамики", groupId: "speaker-group" }]);
  });
});
