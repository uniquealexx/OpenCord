"use client";

import { useEffect, useState } from "react";
import { KeyRound, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ru } from "@/lib/i18n/ru";
import type { ClientPreferences } from "@/shared/state";

export function SettingsDialog({ preferences, open, confirmReset, onOpenChange, onPreferences, onRequestReset, onCancelReset, onReset }: { preferences: ClientPreferences; open: boolean; confirmReset: boolean; onOpenChange: (open: boolean) => void; onPreferences: (preferences: ClientPreferences) => void; onRequestReset: () => void; onCancelReset: () => void; onReset: () => void }): React.ReactElement {
  const [fingerprint, setFingerprint] = useState("загрузка…");
  const [identityReset, setIdentityReset] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    void window.openCord?.identity.getOrCreate().then((identity) => setFingerprint(identity.fingerprint)).catch(() => setFingerprint("недоступен"));
  }, [open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{ru.settings.title}</DialogTitle></DialogHeader>
        {!confirmReset ? <div className="space-y-6">
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.appearance}</h3><div className="divide-y divide-white/6 rounded-2xl border border-white/7 bg-white/[.025]">
            <SettingRow title={ru.settings.compact} hint={ru.settings.compactHint}><Switch checked={preferences.compactMode} onCheckedChange={(value) => onPreferences({ ...preferences, compactMode: value })} /></SettingRow>
            <SettingRow title={ru.settings.members}><Switch checked={preferences.showMemberList} onCheckedChange={(value) => onPreferences({ ...preferences, showMemberList: value })} /></SettingRow>
            <SettingRow title={ru.settings.notifications}><Switch checked={preferences.notifications} onCheckedChange={(value) => onPreferences({ ...preferences, notifications: value })} /></SettingRow>
          </div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">Голос</h3><div className="space-y-3 rounded-2xl border border-white/7 bg-white/[.025] p-4"><div className="grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1"><button type="button" onClick={() => onPreferences({ ...preferences, voiceInputMode: "voice" })} className={preferences.voiceInputMode === "voice" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>Активация голосом</button><button type="button" onClick={() => onPreferences({ ...preferences, voiceInputMode: "push-to-talk" })} className={preferences.voiceInputMode === "push-to-talk" ? "rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white" : "rounded-lg px-3 py-2 text-xs text-slate-500"}>Push-to-Talk (V)</button></div><DeviceSelect label="Микрофон" devices={devices.filter((device) => device.kind === "audioinput")} value={preferences.voiceInputDeviceId} onChange={(voiceInputDeviceId) => onPreferences({ ...preferences, voiceInputDeviceId })} /><DeviceSelect label="Устройство вывода" devices={devices.filter((device) => device.kind === "audiooutput")} value={preferences.voiceOutputDeviceId} onChange={(voiceOutputDeviceId) => onPreferences({ ...preferences, voiceOutputDeviceId })} /><div className="divide-y divide-white/6 rounded-xl border border-white/6"><SettingRow title="Подавление эха"><Switch checked={preferences.echoCancellation} onCheckedChange={(echoCancellation) => onPreferences({ ...preferences, echoCancellation })} /></SettingRow><SettingRow title="Шумоподавление"><Switch checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => onPreferences({ ...preferences, noiseSuppression })} /></SettingRow><SettingRow title="Автоматическая регулировка усиления"><Switch checked={preferences.autoGainControl} onCheckedChange={(autoGainControl) => onPreferences({ ...preferences, autoGainControl })} /></SettingRow></div></div></section>
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.privacy}</h3><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div><p>{ru.settings.identityFuture}</p><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{ru.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{fingerprint}</code></div></div>{!identityReset ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{ru.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{ru.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs text-amber-100/60">{ru.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setIdentityReset(false)}>{ru.settings.cancel}</Button><Button variant="danger" size="sm" onClick={resetIdentity}>{ru.settings.resetIdentity}</Button></div></div>}</div></section>
          <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div><p className="text-sm font-semibold text-red-200">{ru.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{ru.settings.resetHint}</p></div><Button variant="danger" size="sm" onClick={onRequestReset}><RotateCcw className="size-4" />{ru.settings.reset}</Button></section>
        </div> : <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{ru.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{ru.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onCancelReset}>{ru.settings.cancel}</Button><Button variant="danger" onClick={onReset}>{ru.settings.confirm}</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}

function DeviceSelect({ label, devices, value, onChange }: { label: string; devices: MediaDeviceInfo[]; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  return <label className="grid gap-1.5 text-xs font-medium text-slate-300">{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className="h-10 rounded-xl border border-white/10 bg-[#10141f] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/50"><option value="">Системное устройство</option>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}</select></label>;
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{children}</div>;
}
