"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Track } from "livekit-client";
import { useI18n } from "@/lib/i18n";
import { MicrophoneTrackProcessor } from "@/shared/rnnoise-processor";
import type { ClientPreferences } from "@/shared/state";

export type MicrophoneTestStatus = "idle" | "starting" | "listening" | "error";

export interface AudioSettings {
  /** Устройства ввода и вывода; список обновляется при подключении гарнитуры. */
  devices: MediaDeviceInfo[];
  status: MicrophoneTestStatus;
  error: string | null;
  /** Живой поток проверки микрофона — источник для индикатора уровня. */
  stream: MediaStream | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Проверка микрофона и список аудиоустройств.
 *
 * Вынесено из `settings-dialog.tsx`, потому что мобильный экран настроек
 * (`src/mobile/screens/settings-screen.tsx`) должен вести себя ровно так же:
 * та же обработка шума, та же смена устройства на лету, то же освобождение
 * потока при закрытии. Дублировать это второй раз означало бы гарантированное
 * расхождение поведения между платформами.
 *
 * `active` — открыт ли экран настроек: пока он закрыт, устройства не
 * перечисляются. Поток микрофона освобождается при размонтировании; если экран
 * остаётся смонтированным и просто скрывается, вызывающий код обязан вызвать
 * `stop()` сам — иначе микрофон останется занятым.
 */
export function useAudioSettings(preferences: ClientPreferences, active: boolean): AudioSettings {
  const { t } = useI18n();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [status, setStatus] = useState<MicrophoneTestStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generationRef = useRef(0);
  const deviceIdRef = useRef<string | null>(null);
  const processorRef = useRef<{ processor: MicrophoneTrackProcessor; context: AudioContext } | null>(null);

  const release = useCallback((): void => {
    generationRef.current += 1;
    deviceIdRef.current = null;
    const processorEntry = processorRef.current;
    processorRef.current = null;
    if (processorEntry) {
      void processorEntry.processor.destroy().catch(() => undefined);
      void processorEntry.context.close().catch(() => undefined);
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStream(null);
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
  }, []);

  const stop = useCallback((): void => {
    release();
    setStatus("idle");
  }, [release]);

  const rebuildProcessor = useCallback(async (enableRnnoise: boolean): Promise<void> => {
    const entry = processorRef.current;
    processorRef.current = null;
    if (entry) {
      void entry.processor.destroy().catch(() => undefined);
      void entry.context.close().catch(() => undefined);
    }
    const activeStream = streamRef.current;
    const audio = audioRef.current;
    if (!activeStream || !audio) return;
    let playback = activeStream;
    if (typeof AudioContext !== "undefined") {
      const context = new AudioContext();
      const processor = new MicrophoneTrackProcessor({ enableRnnoise });
      try {
        const track = activeStream.getAudioTracks()[0];
        if (!track) throw new Error(t.settings.noAudioTrack);
        await processor.init({ kind: Track.Kind.Audio, track, audioContext: context });
        processor.setGateOpen(true);
        void context.resume().catch(() => undefined);
        const processed = processor.processedTrack;
        if (processed) {
          processorRef.current = { processor, context };
          playback = new MediaStream([processed]);
        }
      } catch {
        void context.close().catch(() => undefined);
      }
    }
    audio.srcObject = playback;
  }, [t]);

  const audioConstraints = useCallback((): MediaTrackConstraints => ({
    deviceId: preferences.voiceInputDeviceId ? { exact: preferences.voiceInputDeviceId } : undefined,
    channelCount: 1,
    echoCancellation: preferences.echoCancellation,
    noiseSuppression: preferences.noiseSuppression,
    autoGainControl: preferences.autoGainControl,
  }), [preferences.autoGainControl, preferences.echoCancellation, preferences.noiseSuppression, preferences.voiceInputDeviceId]);

  const start = useCallback(async (): Promise<void> => {
    stop();
    setError(null);
    setStatus("starting");
    const generation = generationRef.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t.settings.micUnavailable);
      const captured = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints() });
      if (generation !== generationRef.current) {
        for (const track of captured.getTracks()) track.stop();
        return;
      }
      streamRef.current = captured;
      deviceIdRef.current = preferences.voiceInputDeviceId ?? null;
      setStream(captured);
      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      await rebuildProcessor(preferences.noiseSuppression);
      const outputAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
      if (preferences.voiceOutputDeviceId) {
        if (!outputAudio.setSinkId) throw new Error(t.settings.outputUnsupported);
        await outputAudio.setSinkId(preferences.voiceOutputDeviceId);
      }
      await audio.play();
      setStatus("listening");
      void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => undefined);
    } catch (failure) {
      if (generation !== generationRef.current) return;
      stop();
      setStatus("error");
      setError(failure instanceof Error ? failure.message : t.settings.micStartFailed);
    }
  }, [audioConstraints, preferences.noiseSuppression, preferences.voiceInputDeviceId, preferences.voiceOutputDeviceId, rebuildProcessor, stop, t]);

  const recapture = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    const previous = streamRef.current;
    if (!previous) return;
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints() });
      if (generation !== generationRef.current) {
        for (const track of captured.getTracks()) track.stop();
        return;
      }
      for (const track of previous.getTracks()) track.stop();
      streamRef.current = captured;
      deviceIdRef.current = preferences.voiceInputDeviceId ?? null;
      setStream(captured);
      if (audioRef.current) await rebuildProcessor(preferences.noiseSuppression);
    } catch (failure) {
      if (generation !== generationRef.current) return;
      stop();
      setStatus("error");
      setError(failure instanceof Error ? failure.message : t.settings.micSwitchFailed);
    }
  }, [audioConstraints, preferences.noiseSuppression, preferences.voiceInputDeviceId, rebuildProcessor, stop, t]);

  // Настройки обработки и устройства меняются прямо во время прослушивания.
  useEffect(() => {
    if (status !== "listening") return;
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) {
      void track.applyConstraints({
        channelCount: 1,
        echoCancellation: preferences.echoCancellation,
        noiseSuppression: preferences.noiseSuppression,
        autoGainControl: preferences.autoGainControl,
      }).catch(() => undefined);
    }
    const outputAudio = audioRef.current as (HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (outputAudio?.setSinkId) void outputAudio.setSinkId(preferences.voiceOutputDeviceId ?? "").catch(() => undefined);
    if (processorRef.current?.processor.enableRnnoise !== preferences.noiseSuppression) void rebuildProcessor(preferences.noiseSuppression);
    if ((preferences.voiceInputDeviceId ?? null) !== deviceIdRef.current) void recapture();
  }, [preferences.autoGainControl, preferences.echoCancellation, preferences.noiseSuppression, preferences.voiceInputDeviceId, preferences.voiceOutputDeviceId, rebuildProcessor, recapture, status]);

  useEffect(() => release, [release]);

  useEffect(() => {
    if (!active || !navigator.mediaDevices) return;
    const refresh = (): void => { void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([])); };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [active]);

  return { devices, status, error, stream, start, stop };
}
