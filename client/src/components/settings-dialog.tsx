"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Headphones, KeyRound, LoaderCircle, Mic, RefreshCw, RotateCcw, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ThemeSelector } from "@/components/theme-selector";
import { DarkShadeSlider, ThemeModeSelector } from "@/components/theme-mode-selector";
import { resolveAppearance, useSystemDark } from "@/lib/appearance";
import { useAudioSettings } from "@/components/settings/use-audio-settings";
import { useLocalIdentity } from "@/components/settings/use-local-identity";
import { KeybindRow } from "@/components/settings/keybind-row";
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type Language } from "@/lib/i18n";
import { createMicLevelMeter, decibelsToMeterPercent } from "@/lib/voice-level";
import { isMobilePlatform } from "@/platform";
import { UI_SCALE_OPTIONS, type ClientPreferences } from "@/shared/state";
import type { ClientUpdateState } from "@/shared/updater";

export function SettingsDialog({ preferences, open, confirmReset, onOpenChange, onPreferences, onRequestReset, onCancelReset, onReset, onIdentityReset }: { preferences: ClientPreferences; open: boolean; confirmReset: boolean; onOpenChange: (open: boolean) => void; onPreferences: (preferences: ClientPreferences) => void; onRequestReset: () => void; onCancelReset: () => void; onReset: () => void; onIdentityReset?: (identity: { publicKey: string; fingerprint: string; discriminator: string }) => void }): React.ReactElement {
  const { t } = useI18n();
  const [identityReset, setIdentityReset] = useState(false);
  const [updateState, setUpdateState] = useState<ClientUpdateState | null>(null);
  // Проверка микрофона, список устройств и идентичность общие с мобильным экраном
  // настроек (`src/mobile/screens/settings-screen.tsx`).
  const audio = useAudioSettings(preferences, open);
  const systemDark = useSystemDark();
  // Слайдер яркости виден только при тёмном эффективном оформлении:
  // явная тёмная тема либо системная при тёмной ОС.
  const darkEffective = resolveAppearance(preferences.themeMode, systemDark) === "dark";
  const identityState = useLocalIdentity(open, onIdentityReset);
  const { identity } = identityState;
  const devices = audio.devices;

  useEffect(() => {
    if (!open || !window.openCord?.updates) return;
    const updates = window.openCord.updates;
    void updates.getState().then(setUpdateState);
    return updates.onStateChange(setUpdateState);
  }, [open]);

  function updatePreferences(nextPreferences: ClientPreferences): void {
    onPreferences(nextPreferences);
  }

  function resetIdentity(): void {
    identityState.reset();
    setIdentityReset(false);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) audio.stop(); onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t.settings.title}</DialogTitle></DialogHeader>
        {!confirmReset ? <div className="space-y-6">
          <ClientUpdateSection state={updateState} />
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.themeMode}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><ThemeModeSelector value={preferences.themeMode} label={t.settings.themeMode} labels={t.settings.themeModeNames} onChange={(themeMode) => updatePreferences({ ...preferences, themeMode })} />{darkEffective && <div className="mt-4 border-t border-white/6 pt-4"><DarkShadeSlider value={preferences.darkShade} label={t.settings.darkShade} labels={t.settings.darkShadeNames} hint={t.settings.darkShadeHint} onChange={(darkShade) => updatePreferences({ ...preferences, darkShade })} /></div>}<p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.themeModeHint}</p></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.colorTheme}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><ThemeSelector value={preferences.colorTheme} label={t.settings.colorTheme} labels={t.settings.colorThemeNames} onChange={(colorTheme) => updatePreferences({ ...preferences, colorTheme })} /><p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.colorThemeHint}</p></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.appearance}</h3><div className="divide-y divide-white/6 rounded-2xl border border-white/7 bg-white/[.025]">
            <SettingRow title={t.settings.compact} hint={t.settings.compactHint}><Switch checked={preferences.compactMode} onCheckedChange={(value) => onPreferences({ ...preferences, compactMode: value })} /></SettingRow>
            <SettingRow title={t.settings.members}><Switch checked={preferences.showMemberList} onCheckedChange={(value) => onPreferences({ ...preferences, showMemberList: value })} /></SettingRow>
            <SettingRow title={t.settings.notifications}><Switch checked={preferences.notifications} onCheckedChange={(value) => onPreferences({ ...preferences, notifications: value })} /></SettingRow>
          </div></section>
          {isMobilePlatform() && <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.uiScale}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><div role="group" aria-label={t.settings.uiScale} className="grid grid-cols-4 gap-1 rounded-lg bg-white/[.04] p-1">{UI_SCALE_OPTIONS.map((scale) => <button key={scale} type="button" aria-pressed={preferences.uiScale === scale} onClick={() => updatePreferences({ ...preferences, uiScale: scale })} className={preferences.uiScale === scale ? "rounded-lg bg-violet-500 px-2 py-2 text-xs font-semibold text-white" : "rounded-lg px-2 py-2 text-xs text-slate-500 hover:text-slate-200"}>{Math.round(scale * 100)}%</button>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.uiScaleHint}</p></div></section>}
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.language}</h3><div className="rounded-2xl border border-white/7 bg-white/[.025] p-4"><div role="group" aria-label={t.settings.language} className="grid grid-cols-3 gap-1 rounded-lg bg-white/[.04] p-1">{LANGUAGES.map((language: Language) => <button key={language} type="button" aria-pressed={preferences.language === language} onClick={() => updatePreferences({ ...preferences, language })} className={preferences.language === language ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-200"}>{LANGUAGE_LABELS[language]}</button>)}</div><p className="mt-3 text-xs leading-5 text-slate-500">{t.settings.languageHint}</p></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.voice}</h3><div className="space-y-3 rounded-2xl border border-white/7 bg-white/[.025] p-4"><div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1"><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "voice" })} className={preferences.voiceInputMode === "voice" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>{t.settings.voiceActivation}</button><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "push-to-talk" })} className={preferences.voiceInputMode === "push-to-talk" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>{t.settings.pushToTalk}</button></div><DeviceSelect icon={Mic} label={t.settings.microphone} devices={devices.filter((device) => device.kind === "audioinput")} value={preferences.voiceInputDeviceId} onChange={(voiceInputDeviceId) => updatePreferences({ ...preferences, voiceInputDeviceId })} /><DeviceSelect icon={Volume2} label={t.settings.outputDevice} devices={devices.filter((device) => device.kind === "audiooutput")} value={preferences.voiceOutputDeviceId} onChange={(voiceOutputDeviceId) => updatePreferences({ ...preferences, voiceOutputDeviceId })} /><div className="overflow-hidden rounded-xl border border-white/7 bg-white/[.025]"><SettingRow title={t.settings.noiseSuppression} hint={t.settings.noiseSuppressionHint}><Switch aria-label={t.settings.noiseSuppression} checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow></div><div className="rounded-xl border border-violet-400/10 bg-violet-400/[.045] p-3"><div className="flex items-center gap-3"><div className={audio.status === "listening" ? "grid size-9 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300" : "grid size-9 place-items-center rounded-xl bg-violet-400/10 text-violet-300"}>{audio.status === "listening" ? <Headphones className="size-4" /> : <Mic className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">{t.settings.micTest}</p><p className="mt-0.5 text-xs text-slate-500">{t.settings.micTestHint}</p></div>{audio.status === "listening" ? <Button type="button" variant="danger" size="sm" onClick={audio.stop}><Square className="size-3.5" />{t.settings.stop}</Button> : <Button type="button" variant="secondary" size="sm" disabled={audio.status === "starting"} onClick={() => void audio.start()}>{audio.status === "starting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Headphones className="size-3.5" />}{audio.status === "starting" ? t.settings.starting : t.settings.listen}</Button>}</div>{audio.status === "listening" && <p role="status" className="mt-2 text-xs text-emerald-300">{t.settings.micPlaying}</p>}{audio.status === "error" && audio.error && <p role="alert" className="mt-2 text-xs text-red-300">{t.settings.micTestError(audio.error)}</p>}</div><div className="divide-y divide-white/6 rounded-xl border border-white/6"><SettingRow title={t.settings.echoCancellation}><Switch checked={preferences.echoCancellation} onCheckedChange={(echoCancellation) => updatePreferences({ ...preferences, echoCancellation })} /></SettingRow><SettingRow title={t.settings.noiseSuppressionShort}><Switch checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow><SettingRow title={t.settings.autoGain}><Switch checked={preferences.autoGainControl} onCheckedChange={(autoGainControl) => updatePreferences({ ...preferences, autoGainControl })} /></SettingRow></div></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.keybinds}</h3><div className="space-y-3 rounded-2xl border border-white/7 bg-white/[.025] p-4"><KeybindRow action="mute" title={t.settings.keybindMute} hint={t.settings.keybindMuteHint} bind={preferences.keybinds?.mute} conflict={preferences.keybinds?.deafen} onCapture={(bind) => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, mute: bind } })} onClear={() => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, mute: null } })} /><KeybindRow action="deafen" title={t.settings.keybindDeafen} hint={t.settings.keybindDeafenHint} bind={preferences.keybinds?.deafen} conflict={preferences.keybinds?.mute} onCapture={(bind) => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, deafen: bind } })} onClear={() => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, deafen: null } })} /><p className="text-xs leading-5 text-slate-500">{t.settings.keybindsHint}</p></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.sensitivity}</h3><div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[.025]"><SettingRow title={t.settings.automaticSensitivity} hint={t.settings.automaticSensitivityHint}><Switch aria-label={t.settings.automaticSensitivity} checked={preferences.automaticInputSensitivity} onCheckedChange={(automaticInputSensitivity) => updatePreferences({ ...preferences, automaticInputSensitivity })} /></SettingRow>{!preferences.automaticInputSensitivity && <div className="border-t border-white/6 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-slate-300">{t.settings.manualThreshold}</p><p className="mt-1 text-xs text-slate-500">{t.settings.manualThresholdHint}</p></div><span className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold tabular-nums text-violet-200">{preferences.manualInputSensitivityDb} {t.settings.db}</span></div><MicLevelBar stream={audio.status === "listening" ? audio.stream : null} thresholdDb={preferences.manualInputSensitivityDb} /><input aria-label={t.settings.manualSensitivity} type="range" min={-80} max={-10} step={1} value={preferences.manualInputSensitivityDb} onChange={(event) => updatePreferences({ ...preferences, manualInputSensitivityDb: Number(event.target.value) })} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" /><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>{t.settings.sensitivityLeft}</span><span>{t.settings.sensitivityRight}</span></div></div>}</div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{t.settings.privacy}</h3><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div className="min-w-0"><p>{t.settings.identityFuture}</p>{identity && <><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.discriminator}</p><code className="mt-1 block text-xs text-violet-200">#{identity.discriminator}</code></>}<p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{identity?.fingerprint ?? (identityState.status === "unavailable" ? t.settings.unavailable : t.settings.loading)}</code>{identity && <div className="mt-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.publicKey}</p><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs text-violet-200">{identity.publicKey}</code><Button variant="secondary" size="sm" onClick={() => void identityState.copyPublicKey()}><Copy className="size-4" />{t.settings.copyPublicKey}</Button></div><p className="mt-1 text-xs text-slate-500">{t.settings.publicKeyCopyHint}</p>{identityState.publicKeyCopied && <p role="status" className="mt-1 text-xs text-emerald-300">{t.settings.publicKeyCopied}</p>}{identityState.publicKeyCopyFailed && <p className="mt-1 text-xs text-amber-300">{t.settings.publicKeyCopyFailed}</p>}</div>}</div></div>{!identityReset ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{t.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{t.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs text-amber-100/60">{t.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setIdentityReset(false)}>{t.settings.cancel}</Button><Button variant="danger" size="sm" onClick={resetIdentity}>{t.settings.resetIdentity}</Button></div></div>}</div></section>
          <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div><p className="text-sm font-semibold text-red-200">{t.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{t.settings.resetHint}</p></div><Button variant="danger" size="sm" onClick={onRequestReset}><RotateCcw className="size-4" />{t.settings.reset}</Button></section>
        </div> : <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{t.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{t.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onCancelReset}>{t.settings.cancel}</Button><Button variant="danger" onClick={onReset}>{t.settings.confirm}</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}

export function ClientUpdateSection({ state }: { state: ClientUpdateState | null }): React.ReactElement {
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

export function DeviceSelect({ label, icon, devices, value, onChange }: { label: string; icon: typeof Mic; devices: MediaDeviceInfo[]; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const { t } = useI18n();
  return <label className="grid gap-1.5 text-xs font-medium text-slate-300">{label}<Combobox label={label} value={value ?? ""} placeholder={t.settings.systemDevice} icon={icon} options={devices.map((device, index) => ({ value: device.deviceId, label: device.label || `${label} ${index + 1}` }))} onChange={(next) => onChange(next || null)} /></label>;
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{children}</div>;
}

export function MicLevelBar({ stream, thresholdDb }: { stream: MediaStream | null; thresholdDb: number }): React.ReactElement {
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
