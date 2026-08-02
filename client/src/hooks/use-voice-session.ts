"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionQuality, Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import type { ClientPreferences } from "@/shared/state";

export type VoiceSessionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";
export interface VoiceAuthorization { channelId: string; endpoint: string; token: string; expiresAt: string }

export interface VoiceSession {
  status: VoiceSessionStatus;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  activeSpeakerIds: string[];
  quality: "excellent" | "good" | "poor" | "unknown";
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  setMuted(value: boolean): Promise<void>;
  setDeafened(value: boolean): Promise<void>;
  setInputDevice(deviceId: string | null): Promise<void>;
  setOutputDevice(deviceId: string | null): Promise<void>;
  leave(): Promise<void>;
}

export function useVoiceSession(authorization: VoiceAuthorization | null, preferences: ClientPreferences, onError: (message: string) => void): VoiceSession {
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const preferencesRef = useRef(preferences);
  const muteBeforeDeafenRef = useRef(false);
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
  const [quality, setQuality] = useState<VoiceSession["quality"]>("unknown");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const apply = async (): Promise<void> => {
      try {
        if (preferences.voiceInputDeviceId) await room.switchActiveDevice("audioinput", preferences.voiceInputDeviceId);
        if (preferences.voiceOutputDeviceId) await room.switchActiveDevice("audiooutput", preferences.voiceOutputDeviceId);
      } catch {
        onError("Выбранное аудиоустройство недоступно — используется системное устройство");
        try { await room.switchActiveDevice("audioinput", "default"); } catch { /* Browser chooses its default input. */ }
        try { await room.switchActiveDevice("audiooutput", "default"); } catch { /* Browser chooses its default output. */ }
      }
    };
    void apply();
  }, [onError, preferences.voiceInputDeviceId, preferences.voiceOutputDeviceId]);

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const devices = await Room.getLocalDevices();
      setInputDevices(devices.filter((device) => device.kind === "audioinput"));
      setOutputDevices(devices.filter((device) => device.kind === "audiooutput"));
    } catch { /* Device enumeration is unavailable before a media permission prompt. */ }
  }, []);

  const disposeRoom = useCallback(async (): Promise<void> => {
    const room = roomRef.current;
    roomRef.current = null;
    for (const element of audioElementsRef.current) { element.pause(); element.remove(); }
    audioElementsRef.current = [];
    if (room) room.disconnect();
    setChannelId(null);
    setActiveSpeakerIds([]);
    setQuality("unknown");
  }, []);

  useEffect(() => {
    const listener = (): void => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", listener);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", listener);
  }, [refreshDevices]);

  useEffect(() => {
    if (!authorization) return;
    let cancelled = false;
    const connect = async (): Promise<void> => {
      await disposeRoom();
      if (cancelled) return;
      setStatus("connecting");
      const currentPreferences = preferencesRef.current;
      const room = new Room({ audioCaptureDefaults: {
        deviceId: currentPreferences.voiceInputDeviceId ?? undefined,
        channelCount: 1,
        echoCancellation: currentPreferences.echoCancellation,
        noiseSuppression: currentPreferences.noiseSuppression,
        autoGainControl: currentPreferences.autoGainControl,
      } });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach() as HTMLMediaElement;
        element.autoplay = true;
        element.hidden = true;
        element.dataset.opencordLivekit = "true";
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const element of track.detach() as HTMLMediaElement[]) {
          audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
          element.remove();
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setActiveSpeakerIds(speakers.map((speaker) => speaker.identity)));
      room.on(RoomEvent.ConnectionQualityChanged, (nextQuality) => setQuality(nextQuality === ConnectionQuality.Excellent ? "excellent" : nextQuality === ConnectionQuality.Good ? "good" : nextQuality === ConnectionQuality.Poor ? "poor" : "unknown"));
      room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => setStatus("connected"));
      room.on(RoomEvent.Disconnected, () => { if (!cancelled) { setStatus("idle"); setChannelId(null); } });
      try {
        await room.connect(authorization.endpoint, authorization.token);
        if (cancelled || roomRef.current !== room) return;
        if (currentPreferences.voiceOutputDeviceId) await room.switchActiveDevice("audiooutput", currentPreferences.voiceOutputDeviceId);
        const ptt = currentPreferences.voiceInputMode === "push-to-talk";
        await room.localParticipant.setMicrophoneEnabled(!ptt);
        setMutedState(ptt);
        setDeafenedState(false);
        setChannelId(authorization.channelId);
        setStatus("connected");
        await refreshDevices();
      } catch (error) {
        if (!cancelled) { setStatus("error"); onError(error instanceof Error ? `Не удалось подключиться к голосовому каналу: ${error.message}` : "Не удалось подключиться к голосовому каналу"); }
      }
    };
    void connect();
    return () => { cancelled = true; };
  }, [authorization, disposeRoom, onError, refreshDevices]);

  const setIncomingAudioMuted = useCallback((value: boolean): void => {
    for (const element of document.querySelectorAll<HTMLMediaElement>("audio[data-opencord-livekit='true']")) element.muted = value;
  }, []);

  const setMuted = useCallback(async (value: boolean): Promise<void> => {
    if (!value && deafened) {
      setIncomingAudioMuted(false);
      muteBeforeDeafenRef.current = false;
      setDeafenedState(false);
    }
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!value);
    setMutedState(value);
  }, [deafened, setIncomingAudioMuted]);

  useEffect(() => {
    if (preferences.voiceInputMode !== "push-to-talk" || status !== "connected") return;
    const shouldIgnore = (target: EventTarget | null): boolean => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    const down = (event: KeyboardEvent): void => {
      if (event.code !== preferences.pushToTalkKey || event.repeat || shouldIgnore(event.target)) return;
      event.preventDefault();
      void setMuted(false);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code !== preferences.pushToTalkKey) return;
      void setMuted(true);
    };
    const blur = (): void => { void setMuted(true); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [preferences.pushToTalkKey, preferences.voiceInputMode, setMuted, status]);

  const setDeafened = useCallback(async (value: boolean): Promise<void> => {
    setIncomingAudioMuted(value);
    if (value) {
      muteBeforeDeafenRef.current = muted;
      await setMuted(true);
    } else if (!muteBeforeDeafenRef.current) {
      await setMuted(false);
    }
    setDeafenedState(value);
  }, [muted, setIncomingAudioMuted, setMuted]);
  const setInputDevice = useCallback(async (deviceId: string | null): Promise<void> => {
    const room = roomRef.current;
    if (!room || !deviceId) return;
    await room.switchActiveDevice("audioinput", deviceId);
  }, []);
  const setOutputDevice = useCallback(async (deviceId: string | null): Promise<void> => {
    const room = roomRef.current;
    if (!room || !deviceId) return;
    await room.switchActiveDevice("audiooutput", deviceId);
  }, []);
  const leave = useCallback(async (): Promise<void> => { setStatus("idle"); await disposeRoom(); }, [disposeRoom]);

  return { status, channelId, muted, deafened, activeSpeakerIds, quality, inputDevices, outputDevices, setMuted, setDeafened, setInputDevice, setOutputDevice, leave };
}
