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

  useEffect(() => {
    if (!open) return;
    void window.openCord?.identity.getOrCreate().then((identity) => setFingerprint(identity.fingerprint)).catch(() => setFingerprint("недоступен"));
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
          <section><h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-slate-500">{ru.settings.privacy}</h3><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div><p>{ru.settings.identityFuture}</p><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{ru.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{fingerprint}</code></div></div>{!identityReset ? <Button className="mt-4" variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{ru.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{ru.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs text-amber-100/60">{ru.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" onClick={() => setIdentityReset(false)}>{ru.settings.cancel}</Button><Button variant="danger" size="sm" onClick={resetIdentity}>{ru.settings.resetIdentity}</Button></div></div>}</div></section>
          <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div><p className="text-sm font-semibold text-red-200">{ru.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{ru.settings.resetHint}</p></div><Button variant="danger" size="sm" onClick={onRequestReset}><RotateCcw className="size-4" />{ru.settings.reset}</Button></section>
        </div> : <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{ru.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{ru.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" onClick={onCancelReset}>{ru.settings.cancel}</Button><Button variant="danger" onClick={onReset}>{ru.settings.confirm}</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>{children}</div>;
}
