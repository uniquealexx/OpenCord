"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionQuality, Room, RoomEvent, Track, createAudioAnalyser, type LocalAudioTrack, type RemoteAudioTrack, type RemoteParticipant, type RemoteTrack } from "livekit-client";
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

const VOICE_ACTIVITY_ON_THRESHOLD = 0.012;
const VOICE_ACTIVITY_OFF_THRESHOLD = 0.007;
const VOICE_ACTIVITY_RELEASE_SAMPLES = 3;
const VOICE_ACTIVITY_SAMPLE_INTERVAL_MS = 20;

export function createResponsiveVoiceActivityGate(onChange: (speaking: boolean) => void): { sample(volume: number): void; reset(): void } {
  let speaking = false;
  let quietSamples = 0;
  return {
    sample(volume): void {
      if (!speaking) {
        if (volume < VOICE_ACTIVITY_ON_THRESHOLD) return;
        speaking = true;
        quietSamples = 0;
        onChange(true);
        return;
      }
      if (volume >= VOICE_ACTIVITY_OFF_THRESHOLD) {
        quietSamples = 0;
        return;
      }
      quietSamples += 1;
      if (quietSamples < VOICE_ACTIVITY_RELEASE_SAMPLES) return;
      speaking = false;
      quietSamples = 0;
      onChange(false);
    },
    reset(): void {
      quietSamples = 0;
      if (!speaking) return;
      speaking = false;
      onChange(false);
    },
  };
}

function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function mergeResponsiveSpeakerIds(liveKitSpeakerIds: Iterable<string>, responsiveStates: Iterable<{ identity: string; speaking: boolean }>): string[] {
  const states = [...responsiveStates];
  const responsiveIdentities = new Set(states.map((state) => state.identity));
  const next = new Set([...liveKitSpeakerIds].filter((identity) => !responsiveIdentities.has(identity)));
  for (const state of states) if (state.speaking) next.add(state.identity);
  return [...next].sort();
}

export function useVoiceSession(authorization: VoiceAuthorization | null, preferences: ClientPreferences, onError: (message: string) => void): VoiceSession {
  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const preferencesRef = useRef(preferences);
  const muteBeforeDeafenRef = useRef(false);
  const liveKitSpeakerIdsRef = useRef<Set<string>>(new Set());
  const responsiveDetectorsRef = useRef<Map<LocalAudioTrack | RemoteAudioTrack, { identity: string; speaking: boolean; stop: () => void }>>(new Map());
  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
  const [quality, setQuality] = useState<VoiceSession["quality"]>("unknown");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);

  const publishActiveSpeakers = useCallback((): void => {
    const ids = mergeResponsiveSpeakerIds(liveKitSpeakerIdsRef.current, responsiveDetectorsRef.current.values());
    setActiveSpeakerIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
  }, []);

  const stopResponsiveDetector = useCallback((track: LocalAudioTrack | RemoteAudioTrack): void => {
    const detector = responsiveDetectorsRef.current.get(track);
    if (!detector) return;
    responsiveDetectorsRef.current.delete(track);
    detector.stop();
    publishActiveSpeakers();
  }, [publishActiveSpeakers]);

  const startResponsiveDetector = useCallback((track: LocalAudioTrack | RemoteAudioTrack, identity: string): void => {
    stopResponsiveDetector(track);
    try {
      const { analyser, cleanup } = createAudioAnalyser(track, { fftSize: 256, smoothingTimeConstant: 0 });
      const samples = new Float32Array(analyser.fftSize);
      const detector = { identity, speaking: false, stop: (): void => undefined };
      const gate = createResponsiveVoiceActivityGate((speaking) => {
        detector.speaking = speaking;
        publishActiveSpeakers();
      });
      const interval = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        gate.sample(calculateRms(samples));
      }, VOICE_ACTIVITY_SAMPLE_INTERVAL_MS);
      detector.stop = (): void => {
        window.clearInterval(interval);
        gate.reset();
        void cleanup().catch(() => undefined);
      };
      responsiveDetectorsRef.current.set(track, detector);
    } catch {
      // ActiveSpeakersChanged remains the fallback where Web Audio is unavailable.
    }
  }, [publishActiveSpeakers, stopResponsiveDetector]);

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
    for (const detector of responsiveDetectorsRef.current.values()) detector.stop();
    responsiveDetectorsRef.current.clear();
    liveKitSpeakerIdsRef.current.clear();
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
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication, participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        startResponsiveDetector(track as RemoteAudioTrack, participant.identity);
        const element = track.attach() as HTMLMediaElement;
        element.autoplay = true;
        element.hidden = true;
        element.dataset.opencordLivekit = "true";
        document.body.appendChild(element);
        audioElementsRef.current.push(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) stopResponsiveDetector(track as RemoteAudioTrack);
        for (const element of track.detach() as HTMLMediaElement[]) {
          audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
          element.remove();
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        liveKitSpeakerIdsRef.current = new Set(speakers.map((speaker) => speaker.identity));
        publishActiveSpeakers();
      });
      room.on(RoomEvent.ConnectionQualityChanged, (nextQuality) => setQuality(nextQuality === ConnectionQuality.Excellent ? "excellent" : nextQuality === ConnectionQuality.Good ? "good" : nextQuality === ConnectionQuality.Poor ? "poor" : "unknown"));
      room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => setStatus("connected"));
      room.on(RoomEvent.Disconnected, () => { if (!cancelled) { setStatus("idle"); setChannelId(null); } });
      try {
        await room.connect(authorization.endpoint, authorization.token);
        if (cancelled || roomRef.current !== room) return;
        if (currentPreferences.voiceOutputDeviceId) await room.switchActiveDevice("audiooutput", currentPreferences.voiceOutputDeviceId);
        const ptt = currentPreferences.voiceInputMode === "push-to-talk";
        const microphonePublication = await room.localParticipant.setMicrophoneEnabled(!ptt);
        if (microphonePublication?.audioTrack) startResponsiveDetector(microphonePublication.audioTrack, room.localParticipant.identity);
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
  }, [authorization, disposeRoom, onError, publishActiveSpeakers, refreshDevices, startResponsiveDetector, stopResponsiveDetector]);

  const setIncomingAudioMuted = useCallback((value: boolean): void => {
    for (const element of document.querySelectorAll<HTMLMediaElement>("audio[data-opencord-livekit='true']")) element.muted = value;
  }, []);

  const setMuted = useCallback(async (value: boolean): Promise<void> => {
    if (!value && deafened) {
      setIncomingAudioMuted(false);
      muteBeforeDeafenRef.current = false;
      setDeafenedState(false);
    }
    const room = roomRef.current;
    const microphonePublication = await room?.localParticipant.setMicrophoneEnabled(!value);
    if (!value && microphonePublication?.audioTrack && room) startResponsiveDetector(microphonePublication.audioTrack, room.localParticipant.identity);
    if (value) {
      const microphoneTrack = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (microphoneTrack) {
        const detector = responsiveDetectorsRef.current.get(microphoneTrack);
        if (detector?.speaking) { detector.speaking = false; publishActiveSpeakers(); }
      }
    }
    setMutedState(value);
  }, [deafened, publishActiveSpeakers, setIncomingAudioMuted, startResponsiveDetector]);

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
    const microphoneTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (microphoneTrack) startResponsiveDetector(microphoneTrack, room.localParticipant.identity);
  }, [startResponsiveDetector]);
  const setOutputDevice = useCallback(async (deviceId: string | null): Promise<void> => {
    const room = roomRef.current;
    if (!room || !deviceId) return;
    await room.switchActiveDevice("audiooutput", deviceId);
  }, []);
  const leave = useCallback(async (): Promise<void> => { setStatus("idle"); await disposeRoom(); }, [disposeRoom]);

  return { status, channelId, muted, deafened, activeSpeakerIds, quality, inputDevices, outputDevices, setMuted, setDeafened, setInputDevice, setOutputDevice, leave };
}
