"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Headphones, KeyRound, LoaderCircle, Mic, RefreshCw, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ru } from "@/lib/i18n/ru";
import type { ClientPreferences } from "@/shared/state";
import type { ClientUpdateState } from "@/shared/updater";

export function SettingsDialog({ preferences, open, confirmReset, onOpenChange, onPreferences, onRequestReset, onCancelReset, onReset }: { preferences: ClientPreferences; open: boolean; confirmReset: boolean; onOpenChange: (open: boolean) => void; onPreferences: (preferences: ClientPreferences) => void; onRequestReset: () => void; onCancelReset: () => void; onReset: () => void }): React.ReactElement {
  const [fingerprint, setFingerprint] = useState("загрузка…");
  const [identityReset, setIdentityReset] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneTestStatus, setMicrophoneTestStatus] = useState<"idle" | "starting" | "listening" | "error">("idle");
  const [microphoneTestError, setMicrophoneTestError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<ClientUpdateState | null>(null);
  const microphoneTestStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestAudioRef = useRef<HTMLAudioElement | null>(null);
  const microphoneTestGenerationRef = useRef(0);

  const releaseMicrophoneTest = useCallback((): void => {
    microphoneTestGenerationRef.current += 1;
    for (const track of microphoneTestStreamRef.current?.getTracks() ?? []) track.stop();
    microphoneTestStreamRef.current = null;
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

  useEffect(() => {
    if (!open) return;
    void window.openCord?.identity.getOrCreate().then((identity) => setFingerprint(identity.fingerprint)).catch(() => setFingerprint("недоступен"));
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
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Доступ к микрофону не поддерживается");
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
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      microphoneTestAudioRef.current = audio;
      const outputAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
      if (preferences.voiceOutputDeviceId) {
        if (!outputAudio.setSinkId) throw new Error("Выбор устройства вывода не поддерживается");
        await outputAudio.setSinkId(preferences.voiceOutputDeviceId);
      }
      await audio.play();
      setMicrophoneTestStatus("listening");
      void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => undefined);
    } catch (error) {
      if (generation !== microphoneTestGenerationRef.current) return;
      stopMicrophoneTest();
      setMicrophoneTestStatus("error");
      setMicrophoneTestError(error instanceof Error ? error.message : "Не удалось включить прослушивание микрофона");
    }
  }

  function updatePreferences(nextPreferences: ClientPreferences): void {
    if (microphoneTestStatus === "starting" || microphoneTestStatus === "listening") stopMicrophoneTest();
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
    void window.openCord?.identity.reset().then((identity) => { setFingerprint(identity.fingerprint); setIdentityReset(false); }).catch(() => setFingerprint("ошибка смены ключа"));
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) stopMicrophoneTest(); onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{ru.settings.title}</DialogTitle></DialogHeader>
        {!confirmReset ? <div className="space-y-6">
          <ClientUpdateSection state={updateState} />
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.appearance}</h3><div className="divide-y divide-white/6 rounded-2xl border border-white/7 bg-white/[.025]">
            <SettingRow title={ru.settings.compact} hint={ru.settings.compactHint}><Switch checked={preferences.compactMode} onCheckedChange={(value) => onPreferences({ ...preferences, compactMode: value })} /></SettingRow>
            <SettingRow title={ru.settings.members}><Switch checked={preferences.showMemberList} onCheckedChange={(value) => onPreferences({ ...preferences, showMemberList: value })} /></SettingRow>
            <SettingRow title={ru.settings.notifications}><Switch checked={preferences.notifications} onCheckedChange={(value) => onPreferences({ ...preferences, notifications: value })} /></SettingRow>
          </div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">Голос</h3><div className="space-y-3 rounded-2xl border border-white/7 bg-white/[.025] p-4"><div className="grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1"><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "voice" })} className={preferences.voiceInputMode === "voice" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>Активация голосом</button><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "push-to-talk" })} className={preferences.voiceInputMode === "push-to-talk" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>Push-to-Talk (V)</button></div><DeviceSelect label="Микрофон" devices={devices.filter((device) => device.kind === "audioinput")} value={preferences.voiceInputDeviceId} onChange={(voiceInputDeviceId) => updatePreferences({ ...preferences, voiceInputDeviceId })} /><DeviceSelect label="Устройство вывода" devices={devices.filter((device) => device.kind === "audiooutput")} value={preferences.voiceOutputDeviceId} onChange={(voiceOutputDeviceId) => updatePreferences({ ...preferences, voiceOutputDeviceId })} /><div className="rounded-xl border border-violet-400/10 bg-violet-400/[.045] p-3"><div className="flex items-center gap-3"><div className={microphoneTestStatus === "listening" ? "grid size-9 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300" : "grid size-9 place-items-center rounded-xl bg-violet-400/10 text-violet-300"}>{microphoneTestStatus === "listening" ? <Headphones className="size-4" /> : <Mic className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">Прослушать микрофон</p><p className="mt-0.5 text-xs text-slate-500">Используйте наушники, чтобы избежать эха. Звук остаётся на этом компьютере.</p></div>{microphoneTestStatus === "listening" ? <Button type="button" variant="danger" size="sm" onClick={stopMicrophoneTest}><Square className="size-3.5" />Остановить</Button> : <Button type="button" variant="secondary" size="sm" disabled={microphoneTestStatus === "starting"} onClick={() => void startMicrophoneTest()}>{microphoneTestStatus === "starting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Headphones className="size-3.5" />}{microphoneTestStatus === "starting" ? "Запуск…" : "Прослушать"}</Button>}</div>{microphoneTestStatus === "listening" && <p role="status" className="mt-2 text-xs text-emerald-300">Микрофон воспроизводится через выбранное устройство вывода.</p>}{microphoneTestStatus === "error" && microphoneTestError && <p role="alert" className="mt-2 text-xs text-red-300">Не удалось начать проверку: {microphoneTestError}</p>}</div><div className="divide-y divide-white/6 rounded-xl border border-white/6"><SettingRow title="Подавление эха"><Switch checked={preferences.echoCancellation} onCheckedChange={(echoCancellation) => updatePreferences({ ...preferences, echoCancellation })} /></SettingRow><SettingRow title="Шумоподавление"><Switch checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow><SettingRow title="Автоматическая регулировка усиления"><Switch checked={preferences.autoGainControl} onCheckedChange={(autoGainControl) => updatePreferences({ ...preferences, autoGainControl })} /></SettingRow></div></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">Чувствительность микрофона</h3><div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[.025]"><SettingRow title="Автоматическая чувствительность" hint="Порог подстраивается под фоновый шум и громкость микрофона."><Switch aria-label="Автоматическая чувствительность" checked={preferences.automaticInputSensitivity} onCheckedChange={(automaticInputSensitivity) => updatePreferences({ ...preferences, automaticInputSensitivity })} /></SettingRow>{!preferences.automaticInputSensitivity && <div className="border-t border-white/6 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-slate-300">Ручной порог активации</p><p className="mt-1 text-xs text-slate-500">Левее — чувствительнее, правее — меньше фоновых срабатываний.</p></div><span className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold tabular-nums text-violet-200">{preferences.manualInputSensitivityDb} дБ</span></div><input aria-label="Ручная чувствительность микрофона" type="range" min={-80} max={-10} step={1} value={preferences.manualInputSensitivityDb} onChange={(event) => updatePreferences({ ...preferences, manualInputSensitivityDb: Number(event.target.value) })} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full" style={{ background: `linear-gradient(90deg, #8b5cf6 0%, #22d3ee ${((preferences.manualInputSensitivityDb + 80) / 70) * 100}%, #1e293b ${((preferences.manualInputSensitivityDb + 80) / 70) * 100}%, #1e293b 100%)` }} /><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>−80 дБ · чувствительнее</span><span>−10 дБ · тише фон</span></div></div>}</div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.privacy}</h3><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div><p>{ru.settings.identityFuture}</p><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{ru.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{fingerprint}</code></div></div>{!identityReset ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{ru.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{ru.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs text-amber-100/60">{ru.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setIdentityReset(false)}>{ru.settings.cancel}</Button><Button variant="danger" size="sm" onClick={resetIdentity}>{ru.settings.resetIdentity}</Button></div></div>}</div></section>
          <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div><p className="text-sm font-semibold text-red-200">{ru.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{ru.settings.resetHint}</p></div><Button variant="danger" size="sm" onClick={onRequestReset}><RotateCcw className="size-4" />{ru.settings.reset}</Button></section>
        </div> : <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{ru.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{ru.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onCancelReset}>{ru.settings.cancel}</Button><Button variant="danger" onClick={onReset}>{ru.settings.confirm}</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}

function ClientUpdateSection({ state }: { state: ClientUpdateState | null }): React.ReactElement {
  const updates = window.openCord?.updates;
  if (!state) return <></>;
  const checking = state?.status === "checking";
  const downloading = state?.status === "downloading";
  let message = "Получение информации о версии…";
  if (state?.status === "disabled") message = state.reason;
  else if (state?.status === "checking") message = ru.settings.updateChecking;
  else if (state?.status === "up-to-date") message = ru.settings.updateCurrent;
  else if (state?.status === "available") message = `${ru.settings.updateAvailable(state.version)} · ${(state.sizeBytes / 1024 / 1024).toFixed(1)} МБ`;
  else if (state?.status === "downloading") message = ru.settings.updateDownloading(state.percent);
  else if (state?.status === "downloaded") message = ru.settings.updateDownloaded;
  else if (state?.status === "error") message = state.message;
  else if (state) message = ru.settings.updateChannel(state.currentVersion, state.channel);

  return <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.updates}</h3><div className="rounded-2xl border border-cyan-400/10 bg-cyan-400/[.035] p-4"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p role={state?.status === "error" ? "alert" : "status"} className={state?.status === "error" ? "text-sm text-red-300" : "text-sm text-slate-300"}>{message}</p>{state && state.status !== "disabled" && <p className="mt-1 text-xs text-slate-500">{ru.settings.updateChannel(state.currentVersion, state.channel)}</p>}</div><div className="shrink-0">{state?.status === "available" ? <Button size="sm" onClick={() => void updates?.download()}><Download className="size-4" />{ru.settings.updateDownload}</Button> : state?.status === "downloaded" ? <Button size="sm" onClick={() => void updates?.install()}>{ru.settings.updateInstall}</Button> : <Button variant="secondary" size="sm" disabled={!updates || checking || downloading || state?.status === "disabled"} onClick={() => void updates?.check()}>{checking ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{checking ? ru.settings.updateChecking : downloading ? ru.settings.updateDownloading(state.percent) : ru.settings.updateCheck}</Button>}</div></div>{downloading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/7"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width]" style={{ width: `${state.percent}%` }} /></div>}</div></section>;
}

function DeviceSelect({ label, devices, value, onChange }: { label: string; devices: MediaDeviceInfo[]; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  return <label className="grid gap-1.5 text-xs font-medium text-slate-300">{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className="h-10 rounded-xl border border-white/10 bg-[#10141f] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/50"><option value="">Системное устройство</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}</select></label>;
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{children}</div>;
}
