"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, Headphones, KeyRound, LoaderCircle, Mic, RefreshCw, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type Language } from "@/lib/i18n";
import { createMicLevelMeter, decibelsToMeterPercent } from "@/lib/voice-level";
import { isMobilePlatform } from "@/platform";
import { MicrophoneTrackProcessor } from "@/shared/rnnoise-processor";
import { Track } from "livekit-client";
import { UI_SCALE_OPTIONS, type ClientPreferences } from "@/shared/state";
import type { ClientUpdateState } from "@/shared/updater";

export function SettingsDialog({ preferences, open, confirmReset, onOpenChange, onPreferences, onRequestReset, onCancelReset, onReset }: { preferences: ClientPreferences; open: boolean; confirmReset: boolean; onOpenChange: (open: boolean) => void; onPreferences: (preferences: ClientPreferences) => void; onRequestReset: () => void; onCancelReset: () => void; onReset: () => void }): React.ReactElement {
  const { t } = useI18n();
  const [identity, setIdentity] = useState<{ publicKey: string; fingerprint: string } | null>(null);
  const [identityStatus, setIdentityStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [publicKeyCopied, setPublicKeyCopied] = useState(false);
  const [publicKeyCopyFailed, setPublicKeyCopyFailed] = useState(false);
  const [identityReset, setIdentityReset] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneTestStatus, setMicrophoneTestStatus] = useState<"idle" | "starting" | "listening" | "error">("idle");
  const [microphoneTestError, setMicrophoneTestError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<ClientUpdateState | null>(null);
  const microphoneTestStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const microphoneTestGenerationRef = useRef(0);
  const microphoneTestDeviceIdRef = useRef<string | null>(null);
  const microphoneTestProcessorRef = useRef<{ processor: MicrophoneTrackProcessor; context: AudioContext } | null>(null);
  const [activeMicrophoneTestStream, setActiveMicrophoneTestStream] = useState<MediaStream | null>(null);

  const releaseMicrophoneTest = useCallback((): void => {
    microphoneTestGenerationRef.current += 1;
    microphoneTestDeviceIdRef.current = null;
    const processorEntry = microphoneTestProcessorRef.current;
    microphoneTestProcessorRef.current = null;
    if (processorEntry) {
      void processorEntry.processor.destroy().catch(() => undefined);
      void processorEntry.context.close().catch(() => undefined);
    }
    for (const track of microphoneTestStreamRef.current?.getTracks() ?? []) track.stop();
    microphoneTestStreamRef.current = null;
    setActiveMicrophoneTestStream(null);
    const audio = microphoneTestAudioRef.current;
    microphoneTestAudioRef.current = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
  }, []);

  const stopMicrophoneTest = useCallback((): void => {
    releaseMicrophoneTest();
    setMicrophoneTestStatus("idle");
  }, [releaseMicrophoneTest]);

  const rebuildMicrophoneTestProcessor = useCallback(async (enableRnnoise: boolean): Promise<void> => {
    const entry = microphoneTestProcessorRef.current;
    microphoneTestProcessorRef.current = null;
    if (entry) {
      void entry.processor.destroy().catch(() => undefined);
      void entry.context.close().catch(() => undefined);
    }
    const stream = microphoneTestStreamRef.current;
    const audio = microphoneTestAudioRef.current;
    if (!stream || !audio) return;
    let playback = stream;
    if (typeof AudioContext !== "undefined") {
      const context = new AudioContext();
      const processor = new MicrophoneTrackProcessor({ enableRnnoise });
      try {
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error(t.settings.noAudioTrack);
        await processor.init({ kind: Track.Kind.Audio, track, audioContext: context });
        processor.setGateOpen(true);
        void context.resume().catch(() => undefined);
        const processed = processor.processedTrack;
        if (processed) {
          microphoneTestProcessorRef.current = { processor, context };
          playback = new MediaStream([processed]);
        }
      } catch {
        void context.close().catch(() => undefined);
      }
    }
    audio.srcObject = playback;
  }, [t]);

  useEffect(() => {
    if (!open) return;
    void window.openCord?.identity.getOrCreate().then((value) => { setIdentity(value); setIdentityStatus("ready"); }).catch(() => { setIdentity(null); setIdentityStatus("unavailable"); });
  }, [open]);

  useEffect(() => {
    if (!open || !window.openCord?.updates) return;
    const updates = window.openCord.updates;
    void updates.getState().then(setUpdateState);
    return updates.onStateChange(setUpdateState);
  }, [open]);

  useEffect(() => releaseMicrophoneTest, [releaseMicrophoneTest]);

  async function startMicrophoneTest(): Promise<void> {
    stopMicrophoneTest();
    setMicrophoneTestError(null);
    setMicrophoneTestStatus("starting");
    const generation = microphoneTestGenerationRef.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(t.settings.micUnavailable);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: preferences.voiceInputDeviceId ? { exact: preferences.voiceInputDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: preferences.echoCancellation,
          noiseSuppression: preferences.noiseSuppression,
          autoGainControl: preferences.autoGainControl,
        },
      });
      if (generation !== microphoneTestGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      microphoneTestStreamRef.current = stream;
      microphoneTestDeviceIdRef.current = preferences.voiceInputDeviceId ?? null;
      setActiveMicrophoneTestStream(stream);
      const audio = new Audio();
      audio.autoplay = true;
      microphoneTestAudioRef.current = audio;
      await rebuildMicrophoneTestProcessor(preferences.noiseSuppression);
      const outputAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
      if (preferences.voiceOutputDeviceId) {
        if (!outputAudio.setSinkId) throw new Error(t.settings.outputUnsupported);
        await outputAudio.setSinkId(preferences.voiceOutputDeviceId);
      }
      await audio.play();
      setMicrophoneTestStatus("listening");
      void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => undefined);
    } catch (error) {
      if (generation !== microphoneTestGenerationRef.current) return;
      stopMicrophoneTest();
      setMicrophoneTestStatus("error");
      setMicrophoneTestError(error instanceof Error ? error.message : t.settings.micStartFailed);
    }
  }

  const recaptureMicrophoneTest = useCallback(async (): Promise<void> => {
    const generation = microphoneTestGenerationRef.current;
    const previousStream = microphoneTestStreamRef.current;
    if (!previousStream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: preferences.voiceInputDeviceId ? { exact: preferences.voiceInputDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: preferences.echoCancellation,
          noiseSuppression: preferences.noiseSuppression,
          autoGainControl: preferences.autoGainControl,
        },
      });
      if (generation !== microphoneTestGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      for (const track of previousStream.getTracks()) track.stop();
      microphoneTestStreamRef.current = stream;
      microphoneTestDeviceIdRef.current = preferences.voiceInputDeviceId ?? null;
      setActiveMicrophoneTestStream(stream);
      const audio = microphoneTestAudioRef.current;
      if (audio) await rebuildMicrophoneTestProcessor(preferences.noiseSuppression);
    } catch (error) {
      if (generation !== microphoneTestGenerationRef.current) return;
      stopMicrophoneTest();
      setMicrophoneTestStatus("error");
      setMicrophoneTestError(error instanceof Error ? error.message : t.settings.micSwitchFailed);
    }
  }, [preferences.autoGainControl, preferences.echoCancellation, preferences.noiseSuppression, preferences.voiceInputDeviceId, rebuildMicrophoneTestProcessor, stopMicrophoneTest, t]);

  useEffect(() => {
    if (microphoneTestStatus !== "listening") return;
    const stream = microphoneTestStreamRef.current;
    const audio = microphoneTestAudioRef.current;
    const track = stream?.getAudioTracks()[0];
    if (track) {
      void track.applyConstraints({
        channelCount: 1,
        echoCancellation: preferences.echoCancellation,
        noiseSuppression: preferences.noiseSuppression,
        autoGainControl: preferences.autoGainControl,
      }).catch(() => undefined);
    }
    const outputAudio = audio as (HTMLMediaElement & { setSinkId?: (deviceId: string) => Promise<void> }) | null;
    if (outputAudio?.setSinkId) void outputAudio.setSinkId(preferences.voiceOutputDeviceId ?? "").catch(() => undefined);
    if (microphoneTestProcessorRef.current?.processor.enableRnnoise !== preferences.noiseSuppression) void rebuildMicrophoneTestProcessor(preferences.noiseSuppression);
    const requestedDeviceId = preferences.voiceInputDeviceId ?? null;
    if (requestedDeviceId !== microphoneTestDeviceIdRef.current) void recaptureMicrophoneTest();
  }, [microphoneTestStatus, preferences.autoGainControl, preferences.echoCancellation, preferences.noiseSuppression, preferences.voiceInputDeviceId, preferences.voiceOutputDeviceId, rebuildMicrophoneTestProcessor, recaptureMicrophoneTest]);

  function updatePreferences(nextPreferences: ClientPreferences): void {
    onPreferences(nextPreferences);
  }

  useEffect(() => {
    if (!open || !navigator.mediaDevices) return;
    const refresh = (): void => { void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([])); };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [open]);

  function resetIdentity(): void {
    void window.openCord?.identity.reset().then((value) => { setIdentity(value); setIdentityStatus("ready"); setIdentityReset(false); setPublicKeyCopied(false); setPublicKeyCopyFailed(false); }).catch(() => { setIdentity(null); setIdentityStatus("unavailable"); });
  }

  async function copyPublicKey(): Promise<void> {
    if (!identity) return;
    setPublicKeyCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t.settings.clipboardUnavailable);
      await navigator.clipboard.writeText(identity.publicKey);
      setPublicKeyCopied(true);
    } catch {
      setPublicKeyCopyFailed(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) stopMicrophoneTest(); onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t.settings.title}</DialogTitle></DialogHeader>
        {!confirmReset ? <div className="space-y-6">
          <ClientUpdateSection state={updateState} />
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.appearance}</h3><div className="divide-y divide-white/6 rounded-2xl border border-white/7 bg-white/[.025]">
            <SettingRow title={t.settings.compact} hint={t.settings.compactHint}><Switch checked={preferences.compactMode} onCheckedChange={(value) => onPreferences({ ...preferences, compactMode: value })} /></SettingRow>
            <SettingRow title={t.settings.members}><Switch checked={preferences.showMemberList} onCheckedChange={(value) => onPreferences({ ...preferences, showMemberList: value })} /></SettingRow>
            <SettingRow title={t.settings.notifications}><Switch checked={preferences.notifications} onCheckedChange={(value) => onPreferences({ ...preferences, notifications: value })} /></SettingRow>
          </div></section>
          {isMobilePlatform() && <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.uiScale}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><div role="group" aria-label={t.settings.uiScale} className="grid grid-cols-4 gap-1 rounded-lg bg-white/[.04] p-1">{UI_SCALE_OPTIONS.map((scale) => <button key={scale} type="button" aria-pressed={preferences.uiScale === scale} onClick={() => updatePreferences({ ...preferences, uiScale: scale })} className={preferences.uiScale === scale ? "rounded-lg bg-violet-500 px-2 py-2 text-xs font-semibold text-white" : "rounded-lg px-2 py-2 text-xs text-slate-500 hover:text-slate-200"}>{Math.round(scale * 100)}%</button>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.uiScaleHint}</p></div></section>}
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.language}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><div role="group" aria-label={t.settings.language} className="grid grid-cols-3 gap-1 rounded-lg bg-white/[.04] p-1">{LANGUAGES.map((language: Language) => <button key={language} type="button" aria-pressed={preferences.language === language} onClick={() => updatePreferences({ ...preferences, language })} className={preferences.language === language ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200"}>{LANGUAGE_LABELS[language]}</button>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.languageHint}</p></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.voice}</h3><div className="space-y-3 rounded-2xl border border-white/7 bg-white/[.025] p-4"><div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1"><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "voice" })} className={preferences.voiceInputMode === "voice" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>{t.settings.voiceActivation}</button><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "push-to-talk" })} className={preferences.voiceInputMode === "push-to-talk" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>{t.settings.pushToTalk}</button></div><DeviceSelect label={t.settings.microphone} devices={devices.filter((device) => device.kind === "audioinput")} value={preferences.voiceInputDeviceId} onChange={(voiceInputDeviceId) => updatePreferences({ ...preferences, voiceInputDeviceId })} /><DeviceSelect label={t.settings.outputDevice} devices={devices.filter((device) => device.kind === "audiooutput")} value={preferences.voiceOutputDeviceId} onChange={(voiceOutputDeviceId) => updatePreferences({ ...preferences, voiceOutputDeviceId })} /><div className="overflow-hidden rounded-xl border border-white/7 bg-white/[.025]"><SettingRow title={t.settings.noiseSuppression} hint={t.settings.noiseSuppressionHint}><Switch aria-label={t.settings.noiseSuppression} checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow></div><div className="rounded-xl border border-violet-400/10 bg-violet-400/[.045] p-3"><div className="flex items-center gap-3"><div className={microphoneTestStatus === "listening" ? "grid size-9 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300" : "grid size-9 place-items-center rounded-xl bg-violet-400/10 text-violet-300"}>{microphoneTestStatus === "listening" ? <Headphones className="size-4" /> : <Mic className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">{t.settings.micTest}</p><p className="mt-0.5 text-xs text-slate-500">{t.settings.micTestHint}</p></div>{microphoneTestStatus === "listening" ? <Button type="button" variant="danger" size="sm" onClick={stopMicrophoneTest}><Square className="size-3.5" />{t.settings.stop}</Button> : <Button type="button" variant="secondary" size="sm" disabled={microphoneTestStatus === "starting"} onClick={() => void startMicrophoneTest()}>{microphoneTestStatus === "starting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Headphones className="size-3.5" />}{microphoneTestStatus === "starting" ? t.settings.starting : t.settings.listen}</Button>}</div>{microphoneTestStatus === "listening" && <p role="status" className="mt-2 text-xs text-emerald-300">{t.settings.micPlaying}</p>}{microphoneTestStatus === "error" && microphoneTestError && <p role="alert" className="mt-2 text-xs text-red-300">{t.settings.micTestError(microphoneTestError)}</p>}</div><div className="divide-y divide-white/6 rounded-xl border border-white/6"><SettingRow title={t.settings.echoCancellation}><Switch checked={preferences.echoCancellation} onCheckedChange={(echoCancellation) => updatePreferences({ ...preferences, echoCancellation })} /></SettingRow><SettingRow title={t.settings.noiseSuppressionShort}><Switch checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow><SettingRow title={t.settings.autoGain}><Switch checked={preferences.autoGainControl} onCheckedChange={(autoGainControl) => updatePreferences({ ...preferences, autoGainControl })} /></SettingRow></div></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.sensitivity}</h3><div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[.025]"><SettingRow title={t.settings.automaticSensitivity} hint={t.settings.automaticSensitivityHint}><Switch aria-label={t.settings.automaticSensitivity} checked={preferences.automaticInputSensitivity} onCheckedChange={(automaticInputSensitivity) => updatePreferences({ ...preferences, automaticInputSensitivity })} /></SettingRow>{!preferences.automaticInputSensitivity && <div className="border-t border-white/6 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-slate-300">{t.settings.manualThreshold}</p><p className="mt-1 text-xs text-slate-500">{t.settings.manualThresholdHint}</p></div><span className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold tabular-nums text-violet-200">{preferences.manualInputSensitivityDb} {t.settings.db}</span></div><MicLevelBar stream={microphoneTestStatus === "listening" ? activeMicrophoneTestStream : null} thresholdDb={preferences.manualInputSensitivityDb} /><input aria-label={t.settings.manualSensitivity} type="range" min={-80} max={-10} step={1} value={preferences.manualInputSensitivityDb} onChange={(event) => updatePreferences({ ...preferences, manualInputSensitivityDb: Number(event.target.value) })} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" /><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>{t.settings.sensitivityLeft}</span><span>{t.settings.sensitivityRight}</span></div></div>}</div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.privacy}</h3><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div><p>{t.settings.identityFuture}</p><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{identity?.fingerprint ?? (identityStatus === "unavailable" ? t.settings.unavailable : t.settings.loading)}</code>{identity && <div className="mt-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.publicKey}</p><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs text-violet-200">{identity.publicKey}</code><Button variant="secondary" size="sm" onClick={() => void copyPublicKey()}><Copy className="size-4" />{t.settings.copyPublicKey}</Button></div><p className="mt-1 text-xs text-slate-500">{t.settings.publicKeyCopyHint}</p>{publicKeyCopied && <p role="status" className="mt-1 text-xs text-emerald-300">{t.settings.publicKeyCopied}</p>}{publicKeyCopyFailed && <p className="mt-1 text-xs text-amber-300">{t.settings.publicKeyCopyFailed}</p>}</div>}</div></div>{!identityReset ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{t.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{t.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs text-amber-100/60">{t.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setIdentityReset(false)}>{t.settings.cancel}</Button><Button variant="danger" size="sm" onClick={resetIdentity}>{t.settings.resetIdentity}</Button></div></div>}</div></section>
          <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div><p className="text-sm font-semibold text-red-200">{t.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{t.settings.resetHint}</p></div><Button variant="danger" size="sm" onClick={onRequestReset}><RotateCcw className="size-4" />{t.settings.reset}</Button></section>
        </div> : <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{t.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{t.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onCancelReset}>{t.settings.cancel}</Button><Button variant="danger" onClick={onReset}>{t.settings.confirm}</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}

function ClientUpdateSection({ state }: { state: ClientUpdateState | null }): React.ReactElement {
  const { t } = useI18n();
  const updates = window.openCord?.updates;
  if (!state) return <></>;
  const checking = state?.status === "checking";
  const downloading = state?.status === "downloading";
  let message = t.settings.updateRetrieving;
  if (state?.status === "disabled") message = state.reason;
  else if (state?.status === "checking") message = t.settings.updateChecking;
  else if (state?.status === "up-to-date") message = t.settings.updateCurrent;
  else if (state?.status === "available") message = `${t.settings.updateAvailable(state.version)} · ${t.settings.updateSizeMb((state.sizeBytes / 1024 / 1024).toFixed(1))}`;
  else if (state?.status === "downloading") message = t.settings.updateDownloading(state.percent);
  else if (state?.status === "downloaded") message = t.settings.updateDownloaded;
  else if (state?.status === "error") message = state.message;
  else if (state) message = t.settings.updateChannel(state.currentVersion, state.channel);

  return <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.updates}</h3><div className="rounded-2xl border border-cyan-400/10 bg-cyan-400/[.035] p-4"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p role={state?.status === "error" ? "alert" : "status"} className={state?.status === "error" ? "text-sm text-red-300" : "text-sm text-slate-300"}>{message}</p>{state && state.status !== "disabled" && <p className="mt-1 text-xs text-slate-500">{t.settings.updateChannel(state.currentVersion, state.channel)}</p>}</div><div className="shrink-0">{state?.status === "available" ? <Button size="sm" onClick={() => void updates?.download()}><Download className="size-4" />{t.settings.updateDownload}</Button> : state?.status === "downloaded" ? <Button size="sm" onClick={() => void updates?.install()}>{t.settings.updateInstall}</Button> : <Button variant="secondary" size="sm" disabled={!updates || checking || downloading || state?.status === "disabled"} onClick={() => void updates?.check()}>{checking ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{checking ? t.settings.updateChecking : downloading ? t.settings.updateDownloading(state.percent) : t.settings.updateCheck}</Button>}</div></div>{downloading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${state.percent}%` }} /></div>}</div></section>;
}

function DeviceSelect({ label, devices, value, onChange }: { label: string; devices: MediaDeviceInfo[]; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const { t } = useI18n();
  return <label className="grid gap-1.5 text-xs font-medium text-slate-300">{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className="h-10 rounded-xl border border-white/10 bg-[#26282c] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/50"><option value="">{t.settings.systemDevice}</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}</select></label>;
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{children}</div>;
}

function MicLevelBar({ stream, thresholdDb }: { stream: MediaStream | null; thresholdDb: number }): React.ReactElement {
  const { t } = useI18n();
  const [levelDb, setLevelDb] = useState<number | null>(null);
  useEffect(() => {
    if (!stream) return;
    const meter = createMicLevelMeter(stream, setLevelDb);
    return () => meter?.stop();
  }, [stream]);
  const thresholdPercent = decibelsToMeterPercent(thresholdDb) * 100;
  const levelPercent = decibelsToMeterPercent(levelDb ?? Number.NEGATIVE_INFINITY) * 100;
  return (
    <div className="mb-3">
      <div role="meter" aria-label={t.settings.micLevel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(levelPercent)} className="relative h-2 w-full overflow-hidden rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 bg-amber-400/60" style={{ width: `${thresholdPercent}%` }} />
        <div data-testid="mic-level-fill" className="absolute inset-y-0 left-0 bg-emerald-400" style={{ left: `${thresholdPercent}%`, width: `${Math.max(0, levelPercent - thresholdPercent)}%` }} />
        <div data-testid="mic-level-threshold" className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white/90" style={{ left: `${thresholdPercent}%` }} title={t.settings.thresholdTitle(thresholdDb)} />
      </div>
      <p className="mt-1.5 text-[10px] text-slate-600">{t.settings.micLevelHint}</p>
    </div>
  );
}
