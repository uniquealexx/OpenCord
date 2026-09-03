"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionQuality, LocalVideoTrack, Room, RoomEvent, Track, VideoQuality, createAudioAnalyser, type LocalAudioTrack, type RemoteAudioTrack, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type RemoteVideoTrack } from "livekit-client";
import type { ClientPreferences, VoiceParticipantSettings } from "@/shared/state";
import { MicrophoneTrackProcessor } from "@/shared/rnnoise-processor";
import { currentDictionary } from "@/lib/i18n";
import { setVoiceSoundOutputDevice } from "@/lib/voice-sounds";

export type VoiceSessionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";
export interface VoiceAuthorization { channelId: string; endpoint: string; token: string; expiresAt: string }
export interface ScreenShareSettings { width: number; height: number; frameRate: 15 | 30 | 60; maxBitrate: number; includeAudio: boolean; contentHint: "detail" | "motion" }
export type ScreenShareStream =
  | { participantIdentity: string; participantName: string; local: true; track: LocalVideoTrack }
  | { participantIdentity: string; participantName: string; local: false; track: RemoteVideoTrack };

export interface VoiceSession {
  status: VoiceSessionStatus;
  channelId: string | null;
  muted: boolean;
  deafened: boolean;
  activeSpeakerIds: string[];
  quality: "excellent" | "good" | "poor" | "unknown";
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  screenShares: ScreenShareStream[];
  isScreenSharing: boolean;
  locallyMutedParticipantIds: string[];
  participantVolumes: Record<string, number>;
  setMuted(value: boolean): Promise<void>;
  setDeafened(value: boolean): Promise<void>;
  setParticipantMuted(participantIdentity: string, value: boolean): void;
  setParticipantVolume(participantIdentity: string, value: number): void;
  setInputDevice(deviceId: string | null): Promise<void>;
  setOutputDevice(deviceId: string | null): Promise<void>;
  startScreenShare(settings: ScreenShareSettings): Promise<void>;
  stopScreenShare(): Promise<void>;
  leave(): Promise<void>;
}

const VOICE_ACTIVITY_INITIAL_NOISE_FLOOR = 0.0015;
const VOICE_ACTIVITY_MIN_NOISE_FLOOR = 0.0005;
const VOICE_ACTIVITY_MAX_NOISE_FLOOR = 0.04;
const VOICE_ACTIVITY_MIN_ON_THRESHOLD = 0.0045;
const VOICE_ACTIVITY_MAX_ON_THRESHOLD = 0.08;
const VOICE_ACTIVITY_ON_NOISE_MULTIPLIER = 2.5;
const VOICE_ACTIVITY_ON_MARGIN = 0.003;
const VOICE_ACTIVITY_OFF_NOISE_MULTIPLIER = 1.6;
const VOICE_ACTIVITY_OFF_MARGIN = 0.0015;
const VOICE_ACTIVITY_RELEASE_SAMPLES = 4;
const VOICE_ACTIVITY_SAMPLE_INTERVAL_MS = 20;
// Прогрев после появления трека: первые ~300 мс (15 сэмплов) гейт калибрует шумовой пол,
// не открываясь, чтобы фоновый шум комнаты не «залипал» индикатор сразу после подключения
// или анмута. Очень громкий сигнал (речь вплотную к микрофону) открывает гейт и в прогреве.
const VOICE_ACTIVITY_WARMUP_SAMPLES = 15;
const VOICE_ACTIVITY_WARMUP_LOUD_RMS = 0.02;
// Медленный крип шумового пола вверх при ОТКРЫТОМ гейте, но только на негромких уровнях:
// устойчивый фоновый шум (вентилятор, улица) со временем поднимает порог выше себя, закрывает
// гейт и гасит рамку, а громкая речь (выше потолка) пол не меняет — длинная фраза не обрывается.
const VOICE_ACTIVITY_CREEP_CEILING_RMS = 0.02;
const VOICE_ACTIVITY_CREEP_RATE = 0.005;

export interface VoiceActivityCalibration {
  noiseFloor: number;
  openThreshold: number;
  closeThreshold: number;
}

export interface VoiceActivityGateOptions {
  automatic?: boolean;
  manualThresholdDb?: number;
}

export function decibelsToRms(decibels: number): number {
  return 10 ** (Math.min(-10, Math.max(-80, decibels)) / 20);
}

export function createResponsiveVoiceActivityGate(onChange: (speaking: boolean) => void, onCalibration?: (calibration: VoiceActivityCalibration) => void, options: VoiceActivityGateOptions = {}): { sample(volume: number): void; reset(): void; calibration(): VoiceActivityCalibration } {
  let speaking = false;
  let quietSamples = 0;
  let noiseFloor = VOICE_ACTIVITY_INITIAL_NOISE_FLOOR;
  let warmupSamples = 0;
  let lastCalibration: VoiceActivityCalibration | null = null;
  const automatic = options.automatic ?? true;

  const calibration = (): VoiceActivityCalibration => {
    if (!automatic) {
      const openThreshold = decibelsToRms(options.manualThresholdDb ?? -45);
      return { noiseFloor: 0, openThreshold, closeThreshold: openThreshold * 0.72 };
    }
    const openThreshold = Math.min(VOICE_ACTIVITY_MAX_ON_THRESHOLD, Math.max(VOICE_ACTIVITY_MIN_ON_THRESHOLD, noiseFloor * VOICE_ACTIVITY_ON_NOISE_MULTIPLIER + VOICE_ACTIVITY_ON_MARGIN));
    return {
      noiseFloor,
      openThreshold,
      closeThreshold: Math.min(openThreshold * 0.78, Math.max(VOICE_ACTIVITY_MIN_ON_THRESHOLD * 0.55, noiseFloor * VOICE_ACTIVITY_OFF_NOISE_MULTIPLIER + VOICE_ACTIVITY_OFF_MARGIN)),
    };
  };

  const publishCalibration = (): VoiceActivityCalibration => {
    const next = calibration();
    if (!lastCalibration || Math.abs(lastCalibration.noiseFloor - next.noiseFloor) >= 0.0001 || Math.abs(lastCalibration.openThreshold - next.openThreshold) >= 0.0001) {
      lastCalibration = next;
      onCalibration?.(next);
    }
    return next;
  };

  const calibrateNoiseFloor = (volume: number, openThreshold: number): void => {
    if (volume > openThreshold) return;
    const boundedVolume = Math.min(VOICE_ACTIVITY_MAX_NOISE_FLOOR, Math.max(VOICE_ACTIVITY_MIN_NOISE_FLOOR, volume));
    const rate = boundedVolume < noiseFloor ? 0.14 : 0.025;
    noiseFloor += (boundedVolume - noiseFloor) * rate;
  };

  const creepNoiseFloor = (volume: number): void => {
    if (volume > VOICE_ACTIVITY_CREEP_CEILING_RMS) return; // громкая речь: пол не трогаем
    const boundedVolume = Math.max(VOICE_ACTIVITY_MIN_NOISE_FLOOR, volume);
    if (boundedVolume <= noiseFloor) return;
    noiseFloor += (boundedVolume - noiseFloor) * VOICE_ACTIVITY_CREEP_RATE;
  };

  return {
    sample(volume): void {
      const inWarmup = automatic && warmupSamples < VOICE_ACTIVITY_WARMUP_SAMPLES;
      if (inWarmup) warmupSamples += 1;
      const current = publishCalibration();
      if (speaking) {
        if (volume >= current.closeThreshold) {
          quietSamples = 0;
          if (automatic) creepNoiseFloor(volume);
          return;
        }
        quietSamples += 1;
        if (quietSamples < VOICE_ACTIVITY_RELEASE_SAMPLES) return;
        speaking = false;
        quietSamples = 0;
        onChange(false);
        if (automatic) calibrateNoiseFloor(volume, current.openThreshold);
        publishCalibration();
        return;
      }
      if (inWarmup && volume < VOICE_ACTIVITY_WARMUP_LOUD_RMS) {
        // Прогрев: калибруем шумовой пол по фону, не открываясь на шум комнаты.
        calibrateNoiseFloor(volume, Number.POSITIVE_INFINITY);
        return;
      }
      if (automatic) calibrateNoiseFloor(volume, current.openThreshold);
      const calibrated = publishCalibration();
      if (volume < calibrated.openThreshold) return;
      speaking = true;
      quietSamples = 0;
      onChange(true);
    },
    reset(): void {
      quietSamples = 0;
      if (!speaking) return;
      speaking = false;
      onChange(false);
    },
    calibration,
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

export function requestHighestScreenShareQuality(publication: Pick<RemoteTrackPublication, "setEnabled" | "setVideoQuality">): void {
  publication.setEnabled(true);
  publication.setVideoQuality(VideoQuality.HIGH);
}

export interface MicrophoneProcessingResult {
  processor: MicrophoneTrackProcessor | null;
  suppression: "enhanced" | "standard" | "off";
  /** Сырой трек захвата ДО установки процессора: после setProcessor mediaStreamTrack заменяется обработанным (загейтованным) треком. */
  rawMediaStreamTrack: MediaStreamTrack | null;
}

export async function configureMicrophoneProcessing(track: LocalAudioTrack, preferences: Pick<ClientPreferences, "noiseSuppression" | "echoCancellation" | "autoGainControl">): Promise<MicrophoneProcessingResult> {
  const currentProcessor = track.getProcessor();
  if (currentProcessor) await track.stopProcessor();
  try { await track.mediaStreamTrack.applyConstraints({ echoCancellation: preferences.echoCancellation, autoGainControl: preferences.autoGainControl }); } catch { /* The device may not expose these constraints. */ }
  // Сырой трек фиксируем до setProcessor: после установки процессора track.mediaStreamTrack
  // указывает на выход MediaStreamAudioDestinationNode (загейтованный сигнал), по которому
  // нельзя измерять активность — иначе гейт замкнётся на собственную тишину.
  const rawMediaStreamTrack = track.mediaStreamTrack;
  const installProcessor = async (enableRnnoise: boolean): Promise<MicrophoneTrackProcessor | null> => {
    try {
      const processor = new MicrophoneTrackProcessor({ enableRnnoise });
      await track.setProcessor(processor);
      return processor;
    } catch {
      return null;
    }
  };
  if (preferences.noiseSuppression) {
    try {
      try { await track.mediaStreamTrack.applyConstraints({ noiseSuppression: false }); } catch { /* Avoid stacking two suppressors where supported. */ }
      const processor = await installProcessor(true);
      if (!processor) throw new Error("Processor installation failed");
      return { processor, suppression: "enhanced", rawMediaStreamTrack };
    } catch (error) {
      console.warn("OpenCord RNNoise processor is unavailable; using standard WebRTC noise suppression", error);
      try { await track.mediaStreamTrack.applyConstraints({ noiseSuppression: true }); } catch { /* Capture defaults remain the fallback. */ }
      const processor = await installProcessor(false);
      return { processor, suppression: "standard", rawMediaStreamTrack };
    }
  }
  try { await track.mediaStreamTrack.applyConstraints({ noiseSuppression: false }); } catch { /* The device may not expose this constraint. */ }
  const processor = await installProcessor(false);
  return { processor, suppression: "off", rawMediaStreamTrack };
}

export function useVoiceSession(authorization: VoiceAuthorization | null, preferences: ClientPreferences, onError: (message: string) => void, onParticipantAudioSettingsChange?: (settings: VoiceParticipantSettings) => void): VoiceSession {
  const roomRef = useRef<Room | null>(null);
  const localGateProcessorRef = useRef<MicrophoneTrackProcessor | null>(null);
  const localMicRawTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  /**
   * Кому принадлежит звуковой элемент. Раньше заглушки и громкость применялись по одному лишь
   * атрибуту `data-opencord-livekit`, а имя участника читалось из `dataset`: состояние
   * голосового соединения бралось из DOM, то есть под управление сессии попадал бы любой
   * элемент с подходящей разметкой и с любым назначенным ему именем. Разметка теперь только
   * сужает поиск, а принадлежность и участника решает эта таблица, которую заполняет сама
   * сессия при подписке на дорожку.
   */
  const audioOwnersRef = useRef<WeakMap<HTMLMediaElement, string>>(new WeakMap());
  const preferencesRef = useRef(preferences);
  const onParticipantAudioSettingsChangeRef = useRef(onParticipantAudioSettingsChange);
  const muteBeforeDeafenRef = useRef(false);
  const deafenedRef = useRef(false);
  // stopScreenShare объявлен ниже эффекта подключения, поэтому обработчик берёт его через ref.
  const stopScreenShareRef = useRef<(() => Promise<void>) | null>(null);
  const participantAudioSettingsRef = useRef<VoiceParticipantSettings>(preferences.voiceParticipantSettings);
  const appliedParticipantAudioSettingsRef = useRef("");
  const locallyMutedParticipantIdsRef = useRef<Set<string>>(new Set(Object.entries(preferences.voiceParticipantSettings).filter(([, setting]) => setting.muted).map(([identity]) => identity)));
  const participantVolumesRef = useRef<Map<string, number>>(new Map(Object.entries(preferences.voiceParticipantSettings).filter(([, setting]) => setting.volume !== 1).map(([identity, setting]) => [identity, setting.volume])));
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
  const [screenShares, setScreenShares] = useState<ScreenShareStream[]>([]);
  const [locallyMutedParticipantIds, setLocallyMutedParticipantIds] = useState<string[]>(
    Object.entries(preferences.voiceParticipantSettings)
      .filter(([, setting]) => setting.muted)
      .map(([identity]) => identity)
      .sort(),
  );
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(
    Object.fromEntries(
      Object.entries(preferences.voiceParticipantSettings)
        .filter(([, setting]) => setting.volume !== 1)
        .map(([identity, setting]) => [identity, setting.volume]),
    ),
  );

  const ownedAudioElements = useCallback((): { element: HTMLMediaElement; participantIdentity: string }[] => {
    const owners = audioOwnersRef.current;
    return [...document.querySelectorAll<HTMLMediaElement>("audio[data-opencord-livekit='true']")].flatMap((element) => {
      const participantIdentity = owners.get(element);
      return participantIdentity === undefined ? [] : [{ element, participantIdentity }];
    });
  }, []);

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

  const startResponsiveDetector = useCallback((track: LocalAudioTrack | RemoteAudioTrack, identity: string, rawMediaStreamTrack: MediaStreamTrack | null = null): void => {
    stopResponsiveDetector(track);
    try {
      // Анализатор слушает СЫРОЙ трек захвата: у локального трека после setProcessor
      // mediaStreamTrack заменяется обработанным (загейтованным) сигналом — измерять по нему
      // активность нельзя, иначе гейт замыкается на собственную тишину и не открывается.
      const analysedTrack = rawMediaStreamTrack ?? track.mediaStreamTrack;
      const { analyser, cleanup } = createAudioAnalyser({ mediaStreamTrack: analysedTrack } as LocalAudioTrack, { fftSize: 256, smoothingTimeConstant: 0 });
      const samples = new Float32Array(analyser.fftSize);
      const detector = { identity, speaking: false, stop: (): void => undefined };
      const localPreferences = identity === roomRef.current?.localParticipant.identity ? preferencesRef.current : null;
      const pushToTalk = localPreferences?.voiceInputMode === "push-to-talk";
      const gateController = localPreferences ? { setOpen: (open: boolean): void => localGateProcessorRef.current?.setGateOpen(open) } : null;
      const gate = createResponsiveVoiceActivityGate((speaking) => {
        detector.speaking = speaking;
        publishActiveSpeakers();
        gateController?.setOpen(pushToTalk ? true : speaking);
      }, undefined, localPreferences ? { automatic: localPreferences.automaticInputSensitivity, manualThresholdDb: localPreferences.manualInputSensitivityDb } : undefined);
      gateController?.setOpen(pushToTalk ? true : false);
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

  const configureLocalMicrophone = useCallback(async (track: LocalAudioTrack): Promise<MicrophoneProcessingResult> => {
    const result = await configureMicrophoneProcessing(track, preferencesRef.current);
    localGateProcessorRef.current = result.processor;
    localMicRawTrackRef.current = result.rawMediaStreamTrack;
    if (result.processor) {
      const detector = responsiveDetectorsRef.current.get(track);
      const pushToTalk = preferencesRef.current.voiceInputMode === "push-to-talk";
      result.processor.setGateOpen(pushToTalk || Boolean(detector?.speaking));
    }
    return result;
  }, []);

  useEffect(() => { preferencesRef.current = preferences; }, [preferences]);
  useEffect(() => { onParticipantAudioSettingsChangeRef.current = onParticipantAudioSettingsChange; }, [onParticipantAudioSettingsChange]);
  useEffect(() => {
    const settings = preferences.voiceParticipantSettings;
    const serialized = JSON.stringify(settings);
    if (appliedParticipantAudioSettingsRef.current === serialized) return;
    appliedParticipantAudioSettingsRef.current = serialized;
    participantAudioSettingsRef.current = settings;
    locallyMutedParticipantIdsRef.current = new Set(Object.entries(settings).filter(([, setting]) => setting.muted).map(([identity]) => identity));
    participantVolumesRef.current = new Map(Object.entries(settings).filter(([, setting]) => setting.volume !== 1).map(([identity, setting]) => [identity, setting.volume]));
    const mutedIds = [...locallyMutedParticipantIdsRef.current].sort();
    const volumes = Object.fromEntries(participantVolumesRef.current);
    setLocallyMutedParticipantIds((current) => current.length === mutedIds.length && current.every((identity, index) => identity === mutedIds[index]) ? current : mutedIds);
    setParticipantVolumes((current) => {
      const entries = Object.entries(volumes);
      return Object.keys(current).length === entries.length && entries.every(([identity, volume]) => current[identity] === volume) ? current : volumes;
    });
    for (const { element, participantIdentity } of ownedAudioElements()) {
      const setting = settings[participantIdentity];
      element.muted = deafenedRef.current || Boolean(setting?.muted);
      element.volume = setting?.volume ?? 1;
    }
  }, [ownedAudioElements, preferences.voiceParticipantSettings]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const apply = async (): Promise<void> => {
      try {
        if (preferences.voiceInputDeviceId) await room.switchActiveDevice("audioinput", preferences.voiceInputDeviceId);
        if (preferences.voiceOutputDeviceId) await room.switchActiveDevice("audiooutput", preferences.voiceOutputDeviceId);
      } catch {
        onError(currentDictionary().voiceErrors.deviceUnavailable);
        try { await room.switchActiveDevice("audioinput", "default"); } catch { /* Browser chooses its default input. */ }
        try { await room.switchActiveDevice("audiooutput", "default"); } catch { /* Browser chooses its default output. */ }
      }
    };
    void apply();
  }, [onError, preferences.voiceInputDeviceId, preferences.voiceOutputDeviceId]);

  useEffect(() => {
    const room = roomRef.current;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!room || !track) return;
    void configureLocalMicrophone(track).then((processing) => {
      startResponsiveDetector(track, room.localParticipant.identity, processing.rawMediaStreamTrack);
    });
  }, [configureLocalMicrophone, preferences.noiseSuppression, startResponsiveDetector]);

  useEffect(() => {
    const track = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (!track) return;
    void track.mediaStreamTrack.applyConstraints({
      echoCancellation: preferences.echoCancellation,
      autoGainControl: preferences.autoGainControl,
    }).catch(() => undefined);
  }, [preferences.echoCancellation, preferences.autoGainControl]);

  useEffect(() => {
    const room = roomRef.current;
    const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (room && track) startResponsiveDetector(track, room.localParticipant.identity, localMicRawTrackRef.current);
  }, [preferences.automaticInputSensitivity, preferences.manualInputSensitivityDb, preferences.voiceInputMode, startResponsiveDetector]);

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      // Enumerate by explicit audio kind: a kindless Room.getLocalDevices()
      // call makes LiveKit request the camera to resolve hidden device labels,
      // which briefly turns on the webcam right after joining a voice channel.
      // Per-kind calls acquire only the microphone when a permission is missing.
      const [inputs, outputs] = await Promise.all([
        Room.getLocalDevices("audioinput"),
        Room.getLocalDevices("audiooutput"),
      ]);
      setInputDevices(inputs);
      setOutputDevices(outputs);
    } catch { /* Device enumeration is unavailable before a media permission prompt. */ }
  }, []);

  const disposeRoom = useCallback(async (): Promise<void> => {
    const room = roomRef.current;
    roomRef.current = null;
    localGateProcessorRef.current = null;
    for (const detector of responsiveDetectorsRef.current.values()) detector.stop();
    responsiveDetectorsRef.current.clear();
    liveKitSpeakerIdsRef.current.clear();
    for (const element of audioElementsRef.current) { element.pause(); element.remove(); audioOwnersRef.current.delete(element); }
    audioElementsRef.current = [];
    if (room) room.disconnect();
    setChannelId(null);
    setActiveSpeakerIds([]);
    setQuality("unknown");
    setScreenShares((current) => {
      for (const item of current) if (item.local) item.track.stop();
      return [];
    });
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
      const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: {
        deviceId: currentPreferences.voiceInputDeviceId ?? undefined,
        channelCount: 1,
        sampleRate: 48_000,
        echoCancellation: currentPreferences.echoCancellation,
        noiseSuppression: false,
        autoGainControl: currentPreferences.autoGainControl,
      } });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
          requestHighestScreenShareQuality(publication);
          setScreenShares((current) => [...current.filter((item) => item.participantIdentity !== participant.identity), { participantIdentity: participant.identity, participantName: participant.name || participant.identity, local: false, track: track as RemoteVideoTrack }]);
          return;
        }
        if (track.kind !== Track.Kind.Audio) return;
        // Присоединившийся к «оглохшему» клиенту участник подписывается автоматически:
        // отказываемся от дорожки сразу, иначе заглушка ушей перестала бы экономить трафик
        // ровно на тех, кто пришёл после её включения.
        if (deafenedRef.current) { publication.setSubscribed(false); return; }
        if (publication.source === Track.Source.Microphone) startResponsiveDetector(track as RemoteAudioTrack, participant.identity);
        const element = track.attach() as HTMLMediaElement;
        element.autoplay = true;
        element.hidden = true;
        // Пометка сужает поиск по документу; принадлежность решает audioOwnersRef.
        element.dataset.opencordLivekit = "true";
        element.muted = deafenedRef.current || locallyMutedParticipantIdsRef.current.has(participant.identity);
        element.volume = participantVolumesRef.current.get(participant.identity) ?? 1;
        document.body.appendChild(element);
        audioOwnersRef.current.set(element, participant.identity);
        audioElementsRef.current.push(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication, participant) => {
        if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
          setScreenShares((current) => current.filter((item) => item.participantIdentity !== participant.identity));
          for (const element of track.detach() as HTMLMediaElement[]) element.remove();
          return;
        }
        if (track.kind === Track.Kind.Audio) stopResponsiveDetector(track as RemoteAudioTrack);
        for (const element of track.detach() as HTMLMediaElement[]) {
          audioElementsRef.current = audioElementsRef.current.filter((item) => item !== element);
          audioOwnersRef.current.delete(element);
          element.remove();
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        liveKitSpeakerIdsRef.current = new Set(speakers.map((speaker) => speaker.identity));
        publishActiveSpeakers();
      });
      // Сервер вправе заглушить демонстрацию, кадр которой превышает предел, заданный
      // владельцем: разрешение выбирает клиент, и в токене LiveKit ограничить его нечем.
      // Молча оставленная «идущей» демонстрация выглядела бы работающей, ничего не передавая,
      // поэтому она останавливается здесь и пользователь получает объяснение.
      room.on(RoomEvent.TrackMuted, (publication, participant) => {
        if (participant.identity !== room.localParticipant.identity || publication.source !== Track.Source.ScreenShare) return;
        void stopScreenShareRef.current?.();
        onError(currentDictionary().voiceErrors.screenShareBlocked);
      });
      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) setScreenShares((current) => {
          for (const item of current) if (item.local) item.track.stop();
          return current.filter((item) => !item.local);
        });
      });
      room.on(RoomEvent.ConnectionQualityChanged, (nextQuality) => setQuality(nextQuality === ConnectionQuality.Excellent ? "excellent" : nextQuality === ConnectionQuality.Good ? "good" : nextQuality === ConnectionQuality.Poor ? "poor" : "unknown"));
      room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
      room.on(RoomEvent.Reconnected, () => setStatus("connected"));
      room.on(RoomEvent.Disconnected, () => { if (!cancelled) { setStatus("idle"); setChannelId(null); } });
      try {
        await room.connect(authorization.endpoint, authorization.token);
        if (cancelled || roomRef.current !== room) return;
        // Комната подключена: фиксируем статус и канал сразу — индикатор не должен зависеть
        // от последующей настройки микрофона (она бывает медленной или падает на конкретном устройстве).
        setChannelId(authorization.channelId);
        setStatus("connected");
        const ptt = currentPreferences.voiceInputMode === "push-to-talk";
        setMutedState(ptt);
        deafenedRef.current = false;
        setDeafenedState(false);
        try {
          if (currentPreferences.voiceOutputDeviceId) await room.switchActiveDevice("audiooutput", currentPreferences.voiceOutputDeviceId);
        } catch { /* Системное устройство вывода остаётся фолбэком. */ }
        try {
          const microphonePublication = await room.localParticipant.setMicrophoneEnabled(!ptt);
          if (microphonePublication?.audioTrack) {
            const processing = await configureLocalMicrophone(microphonePublication.audioTrack);
            startResponsiveDetector(microphonePublication.audioTrack, room.localParticipant.identity, processing.rawMediaStreamTrack);
          }
        } catch {
          // Пользователь остаётся в канале, но без микрофона: глушим и объясняем, а не валим статус.
          setMutedState(true);
          onError(currentDictionary().voiceErrors.micFailed);
        }
        await refreshDevices();
      } catch (error) {
        if (!cancelled) { setStatus("error"); onError(error instanceof Error ? currentDictionary().voiceErrors.joinFailed(error.message) : currentDictionary().voiceErrors.joinFailedGeneric); }
      }
    };
    void connect();
    return () => { cancelled = true; };
  }, [authorization, configureLocalMicrophone, disposeRoom, onError, publishActiveSpeakers, refreshDevices, startResponsiveDetector, stopResponsiveDetector]);

  /**
   * Заглушка ушей обязана прекращать ПРИЁМ звука, а не только выключать <audio>: выключенный
   * элемент лишь не воспроизводит уже полученный поток, дорожки остаются подписанными и голос
   * комнаты продолжает идти по сети. Помимо напрасного трафика это значит, что «оглохший»
   * клиент по-прежнему получает разговор — достаточно снять `muted` в отладчике, чтобы слушать
   * молча. Поэтому подписка снимается на самом деле, а `muted` остаётся мгновенной заглушкой
   * на те миллисекунды, пока отказ от дорожки доходит до сервера.
   */
  const setIncomingAudioSubscribed = useCallback((subscribed: boolean): void => {
    const room = roomRef.current;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind !== Track.Kind.Audio) continue;
        try { publication.setSubscribed(subscribed); } catch { /* Дорожка могла исчезнуть вместе с участником. */ }
      }
    }
  }, []);

  const setIncomingAudioMuted = useCallback((value: boolean): void => {
    for (const { element, participantIdentity } of ownedAudioElements()) {
      element.muted = value || locallyMutedParticipantIdsRef.current.has(participantIdentity);
    }
  }, [ownedAudioElements]);

  const setParticipantMuted = useCallback((participantIdentity: string, value: boolean): void => {
    const next = new Set(locallyMutedParticipantIdsRef.current);
    if (value) next.add(participantIdentity);
    else next.delete(participantIdentity);
    locallyMutedParticipantIdsRef.current = next;
    setLocallyMutedParticipantIds([...next].sort());
    const currentSetting = participantAudioSettingsRef.current[participantIdentity] ?? { muted: false, volume: 1 };
    const nextSettings = { ...participantAudioSettingsRef.current, [participantIdentity]: { ...currentSetting, muted: value } };
    if (!value && currentSetting.volume === 1) delete nextSettings[participantIdentity];
    participantAudioSettingsRef.current = nextSettings;
    onParticipantAudioSettingsChangeRef.current?.(nextSettings);
    for (const item of ownedAudioElements()) {
      if (item.participantIdentity === participantIdentity) item.element.muted = deafenedRef.current || value;
    }
  }, [ownedAudioElements]);

  const setParticipantVolume = useCallback((participantIdentity: string, value: number): void => {
    const normalized = Math.min(1, Math.max(0, value));
    const next = new Map(participantVolumesRef.current);
    if (normalized === 1) next.delete(participantIdentity);
    else next.set(participantIdentity, normalized);
    participantVolumesRef.current = next;
    setParticipantVolumes(Object.fromEntries([...next.entries()].sort(([left], [right]) => left.localeCompare(right))));
    const currentSetting = participantAudioSettingsRef.current[participantIdentity] ?? { muted: false, volume: 1 };
    const nextSettings = { ...participantAudioSettingsRef.current, [participantIdentity]: { ...currentSetting, volume: normalized } };
    if (!currentSetting.muted && normalized === 1) delete nextSettings[participantIdentity];
    participantAudioSettingsRef.current = nextSettings;
    onParticipantAudioSettingsChangeRef.current?.(nextSettings);
    for (const item of ownedAudioElements()) {
      if (item.participantIdentity === participantIdentity) item.element.volume = normalized;
    }
  }, [ownedAudioElements]);

  const setMuted = useCallback(async (value: boolean): Promise<void> => {
    if (!value && deafened) {
      setIncomingAudioMuted(false);
      setIncomingAudioSubscribed(true);
      muteBeforeDeafenRef.current = false;
      deafenedRef.current = false;
      setDeafenedState(false);
    }
    const room = roomRef.current;
    const microphonePublication = await room?.localParticipant.setMicrophoneEnabled(!value);
    if (!value && microphonePublication?.audioTrack && room) {
      const processing = await configureLocalMicrophone(microphonePublication.audioTrack);
      startResponsiveDetector(microphonePublication.audioTrack, room.localParticipant.identity, processing.rawMediaStreamTrack);
    }
    if (value) {
      const microphoneTrack = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
      if (microphoneTrack) {
        const detector = responsiveDetectorsRef.current.get(microphoneTrack);
        if (detector?.speaking) { detector.speaking = false; publishActiveSpeakers(); }
      }
    }
    setMutedState(value);
  }, [configureLocalMicrophone, deafened, publishActiveSpeakers, setIncomingAudioMuted, setIncomingAudioSubscribed, startResponsiveDetector]);

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
    deafenedRef.current = value;
    setIncomingAudioMuted(value);
    setIncomingAudioSubscribed(!value);
    if (value) {
      muteBeforeDeafenRef.current = muted;
      await setMuted(true);
    } else if (!muteBeforeDeafenRef.current) {
      await setMuted(false);
    }
    setDeafenedState(value);
  }, [muted, setIncomingAudioMuted, setIncomingAudioSubscribed, setMuted]);
  const setInputDevice = useCallback(async (deviceId: string | null): Promise<void> => {
    const room = roomRef.current;
    if (!room || !deviceId) return;
    await room.switchActiveDevice("audioinput", deviceId);
    const microphoneTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
    if (microphoneTrack) {
      const processing = await configureLocalMicrophone(microphoneTrack);
      startResponsiveDetector(microphoneTrack, room.localParticipant.identity, processing.rawMediaStreamTrack);
    }
  }, [configureLocalMicrophone, startResponsiveDetector]);
  const setOutputDevice = useCallback(async (deviceId: string | null): Promise<void> => {
    // Служебные звуки идут мимо LiveKit, через собственный AudioContext, — им
    // устройство надо передать отдельно, иначе они играют в наушники по умолчанию.
    setVoiceSoundOutputDevice(deviceId);
    const room = roomRef.current;
    if (!room || !deviceId) return;
    await room.switchActiveDevice("audiooutput", deviceId);
  }, []);
  const stopScreenShare = useCallback(async (): Promise<void> => {
    const room = roomRef.current;
    if (room) await room.localParticipant.setScreenShareEnabled(false);
    setScreenShares((current) => {
      for (const item of current) if (item.local) item.track.stop();
      return current.filter((item) => !item.local);
    });
  }, []);
  useEffect(() => { stopScreenShareRef.current = stopScreenShare; }, [stopScreenShare]);

  const startScreenShare = useCallback(async (settings: ScreenShareSettings): Promise<void> => {
    const room = roomRef.current;
    if (!room || status !== "connected") throw new Error(currentDictionary().voiceErrors.connectFirst);
    if (room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false);
    const captureOptions = {
      audio: settings.includeAudio,
      resolution: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
      contentHint: settings.contentHint,
      systemAudio: settings.includeAudio ? "include" as const : "exclude" as const,
    };
    const publishOptions = {
      simulcast: true,
      videoCodec: "vp8" as const,
      screenShareEncoding: { maxBitrate: settings.maxBitrate, maxFramerate: settings.frameRate, priority: "high" as const },
      degradationPreference: settings.contentHint === "motion" ? "maintain-framerate" as const : "maintain-resolution" as const,
    };
    const capturedTracks = await room.localParticipant.createScreenTracks(captureOptions);
    const capturedVideo = capturedTracks.find((item): item is LocalVideoTrack => item instanceof LocalVideoTrack);
    if (!capturedVideo) {
      for (const item of capturedTracks) item.stop();
      throw new Error(currentDictionary().voiceErrors.noVideoTrack);
    }
    void window.openCord?.screenShare?.report(`captured-video ${JSON.stringify({ readyState: capturedVideo.mediaStreamTrack.readyState, muted: capturedVideo.mediaStreamTrack.muted, enabled: capturedVideo.mediaStreamTrack.enabled, settings: capturedVideo.mediaStreamTrack.getSettings() })}`);
    // Keep the raw capture exclusively for local preview. Publish a clone so
    // WebRTC/simulcast cannot alter or suspend the preview's media source.
    const previewTrack = capturedVideo;
    const publishingVideo = new LocalVideoTrack(capturedVideo.mediaStreamTrack.clone());
    publishingVideo.source = Track.Source.ScreenShare;
    const publishingTracks = capturedTracks.map((item) => item === capturedVideo ? publishingVideo : item);
    const removeLocal = (): void => setScreenShares((current) => {
      previewTrack.stop();
      return current.filter((item) => !item.local);
    });
    previewTrack.mediaStreamTrack.addEventListener("ended", removeLocal, { once: true });
    setScreenShares((current) => {
      for (const item of current) if (item.local) item.track.stop();
      return [...current.filter((item) => !item.local), { participantIdentity: room.localParticipant.identity, participantName: room.localParticipant.name || currentDictionary().roles.you, local: true, track: previewTrack }];
    });
    try {
      await Promise.all(publishingTracks.map((item) => room.localParticipant.publishTrack(item, publishOptions)));
      void window.openCord?.screenShare?.report(`published-video ${JSON.stringify({ previewReadyState: previewTrack.mediaStreamTrack.readyState, previewMuted: previewTrack.mediaStreamTrack.muted, previewEnabled: previewTrack.mediaStreamTrack.enabled, publishReadyState: publishingVideo.mediaStreamTrack.readyState, publishMuted: publishingVideo.mediaStreamTrack.muted, publishEnabled: publishingVideo.mediaStreamTrack.enabled })}`);
    } catch (error) {
      previewTrack.stop();
      for (const item of publishingTracks) item.stop();
      setScreenShares((current) => current.filter((item) => !item.local));
      throw error;
    }
  }, [status]);
  const leave = useCallback(async (): Promise<void> => { setStatus("idle"); await disposeRoom(); }, [disposeRoom]);

  return { status, channelId, muted, deafened, activeSpeakerIds, quality, inputDevices, outputDevices, screenShares, isScreenSharing: screenShares.some((item) => item.local), locallyMutedParticipantIds, participantVolumes, setMuted, setDeafened, setParticipantMuted, setParticipantVolume, setInputDevice, setOutputDevice, startScreenShare, stopScreenShare, leave };
}
