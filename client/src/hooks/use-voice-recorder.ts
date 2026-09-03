"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceRecorderStatus = "idle" | "recording" | "ready";
export type VoiceRecorderError = "unavailable" | "denied" | "failed" | "too-large";

export interface RecordedVoice {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  truncated: boolean;
}

const CANDIDATE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg"] as const;

type MediaRecorderLike = {
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  state: string;
  start(): void;
  stop(): void;
};

function mediaRecorderConstructor(): (new (stream: MediaStream, options?: { mimeType?: string }) => MediaRecorderLike) | null {
  const candidate = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  return typeof candidate === "function" ? (candidate as new (stream: MediaStream, options?: { mimeType?: string }) => MediaRecorderLike) : null;
}

/** Первый поддерживаемый браузером MIME-тип записи либо null (MediaRecorder недоступен). */
export function pickVoiceMimeType(): string | null {
  const constructor = mediaRecorderConstructor();
  if (!constructor) return null;
  const isSupported = (constructor as unknown as { isTypeSupported?: (type: string) => boolean }).isTypeSupported;
  if (typeof isSupported !== "function") return CANDIDATE_MIME_TYPES[0];
  for (const mimeType of CANDIDATE_MIME_TYPES) {
    try {
      if (isSupported.call(constructor, mimeType)) return mimeType;
    } catch { /* пробуем следующий */ }
  }
  return null;
}

export function voiceFileExtension(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  return "webm";
}

export function voiceFileName(mimeType: string, now: Date = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
  return `voice-message-${stamp}.${voiceFileExtension(mimeType)}`;
}

export interface VoiceRecorderOptions {
  maxSeconds?: number;
  maxBytes?: number | null;
}

export interface VoiceRecorder {
  status: VoiceRecorderStatus;
  seconds: number;
  audio: RecordedVoice | null;
  error: VoiceRecorderError | null;
  supported: boolean;
  start(): Promise<void>;
  stop(): void;
  reset(): void;
}

export function useVoiceRecorder(options: VoiceRecorderOptions = {}): VoiceRecorder {
  const { maxSeconds = 300, maxBytes = null } = options;
  const [status, setStatus] = useState<VoiceRecorderStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<RecordedVoice | null>(null);
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  const recorderRef = useRef<MediaRecorderLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const truncatedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTracks = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
    if (capTimerRef.current !== null) { clearTimeout(capTimerRef.current); capTimerRef.current = null; }
  }, []);

  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    recorderRef.current = null;
    stopTracks();
    clearTimers();
  }, [stopTracks, clearTimers]);

  const start = useCallback(async () => {
    const constructor = mediaRecorderConstructor();
    const mimeType = pickVoiceMimeType();
    const media = navigator.mediaDevices;
    if (!constructor || !mimeType || !media?.getUserMedia) {
      setError("unavailable");
      return;
    }
    setError(null);
    setAudio(null);
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({ audio: true });
    } catch (error) {
      setError(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "failed");
      return;
    }
    chunksRef.current = [];
    truncatedRef.current = false;
    startedAtRef.current = Date.now();
    const recorder = new constructor(stream, { mimeType });
    recorderRef.current = recorder;
    streamRef.current = stream;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      clearTimers();
      stopTracks();
      recorderRef.current = null;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1_000));
      if (maxBytes !== null && blob.size > maxBytes) {
        setError("too-large");
        setStatus("idle");
        return;
      }
      setAudio({ blob, mimeType, durationSeconds, truncated: truncatedRef.current });
      setStatus("ready");
    };
    setSeconds(0);
    setStatus("recording");
    recorder.start();
    timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1_000)), 250);
    capTimerRef.current = setTimeout(() => {
      truncatedRef.current = true;
      try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    }, maxSeconds * 1_000);
  }, [maxSeconds, maxBytes, clearTimers, stopTracks]);

  const stop = useCallback(() => {
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    recorderRef.current = null;
    stopTracks();
    setAudio(null);
    setError(null);
    setSeconds(0);
    setStatus("idle");
  }, [clearTimers, stopTracks]);

  return { status, seconds, audio, error, supported: mediaRecorderConstructor() !== null, start, stop, reset };
}
