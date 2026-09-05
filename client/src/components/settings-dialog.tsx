"use client";

import { useEffect, useState } from "react";
import { Bell, Copy, Download, Headphones, Keyboard, KeyRound, Languages, LoaderCircle, Mic, Palette, RefreshCw, RotateCcw, Search, SlidersHorizontal, Square, User, Volume2, X, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProfileForm } from "@/components/profile-form";
import { ThemeSelector } from "@/components/theme-selector";
import { DarkShadeSlider, ThemeModeSelector } from "@/components/theme-mode-selector";
import { resolveAppearance, useSystemDark } from "@/lib/appearance";
import { useAudioSettings } from "@/components/settings/use-audio-settings";
import { useLocalIdentity } from "@/components/settings/use-local-identity";
import { KeybindRow } from "@/components/settings/keybind-row";
import { useI18n } from "@/lib/i18n";
import { LANGUAGE_LABELS, LANGUAGES, type Language } from "@/lib/i18n";
import { createMicLevelMeter, decibelsToMeterPercent } from "@/lib/voice-level";
import { cn } from "@/lib/utils";
import { isMobilePlatform } from "@/platform";
import { UI_SCALE_OPTIONS, type ClientPreferences, type LocalProfile } from "@/shared/state";
import type { ClientUpdateState } from "@/shared/updater";

export type SettingsPageId = "account" | "appearance" | "language" | "notifications" | "voice" | "sensitivity" | "keybinds" | "updates" | "privacy" | "reset";

type SettingsGroup = "user" | "voice" | "app" | "security";

const SETTINGS_PAGES: { id: SettingsPageId; group: SettingsGroup }[] = [
  { id: "account", group: "user" },
  { id: "appearance", group: "user" },
  { id: "language", group: "user" },
  { id: "notifications", group: "user" },
  { id: "voice", group: "voice" },
  { id: "sensitivity", group: "voice" },
  { id: "keybinds", group: "voice" },
  { id: "updates", group: "app" },
  { id: "privacy", group: "security" },
  { id: "reset", group: "security" },
];

const PAGE_ICONS: Record<SettingsPageId, LucideIcon> = {
  account: User,
  appearance: Palette,
  language: Languages,
  notifications: Bell,
  voice: Mic,
  sensitivity: SlidersHorizontal,
  keybinds: Keyboard,
  updates: RefreshCw,
  privacy: KeyRound,
  reset: RotateCcw,
};

/** Единая минимальная ширина кнопок-действий в строках настроек. */
const ROW_BUTTON = "min-w-28 justify-center";

export function SettingsDialog({ preferences, profile, open, confirmReset, initialPage, onOpenChange, onPreferences, onSaveProfile, onRequestReset, onCancelReset, onReset, onIdentityReset }: { preferences: ClientPreferences; profile: LocalProfile | null; open: boolean; confirmReset: boolean; initialPage?: SettingsPageId; onOpenChange: (open: boolean) => void; onPreferences: (preferences: ClientPreferences) => void; onSaveProfile: (profile: LocalProfile) => void; onRequestReset: () => void; onCancelReset: () => void; onReset: () => void; onIdentityReset?: (identity: { publicKey: string; fingerprint: string; discriminator: string }) => void }): React.ReactElement {
  const { t } = useI18n();
  const [identityReset, setIdentityReset] = useState(false);
  const [updateState, setUpdateState] = useState<ClientUpdateState | null>(null);
  const [activePage, setActivePage] = useState<SettingsPageId>(() => {
    if (initialPage && (initialPage !== "account" || profile)) return initialPage;
    return profile ? "account" : "appearance";
  });
  const [query, setQuery] = useState("");
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

  function pageTitle(page: SettingsPageId): string {
    switch (page) {
      case "account": return t.settings.navAccount;
      case "appearance": return t.settings.appearance;
      case "language": return t.settings.language;
      case "notifications": return t.settings.notifications;
      case "voice": return t.settings.voice;
      case "sensitivity": return t.settings.sensitivity;
      case "keybinds": return t.settings.keybinds;
      case "updates": return t.settings.updates;
      case "privacy": return t.settings.privacy;
      case "reset": return t.settings.reset;
    }
  }

  function groupTitle(group: SettingsGroup): string {
    switch (group) {
      case "user": return t.settings.navGroupUser;
      case "voice": return t.settings.navGroupVoice;
      case "app": return t.settings.navGroupApp;
      case "security": return t.settings.navGroupSecurity;
    }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const availablePages = SETTINGS_PAGES.filter((page) => page.id !== "account" || profile);
  const visiblePages = normalizedQuery
    ? availablePages.filter((page) => pageTitle(page.id).toLowerCase().includes(normalizedQuery))
    : availablePages;
  const effectivePage = availablePages.some((page) => page.id === activePage) ? activePage : (profile ? "account" : "appearance");
  const groups: SettingsGroup[] = ["user", "voice", "app", "security"];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) audio.stop(); onOpenChange(nextOpen); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{t.settings.title}</DialogTitle></DialogHeader>
        {confirmReset ? <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-5"><h3 className="font-bold text-red-200">{t.settings.resetConfirm}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{t.settings.resetDescription}</p><div className="mt-5 flex justify-end gap-3"><Button variant="secondary" className={ROW_BUTTON} onClick={onCancelReset}>{t.settings.cancel}</Button><Button variant="danger" className={ROW_BUTTON} onClick={onReset}>{t.settings.confirm}</Button></div></div> : (
        <div className="flex min-h-0 flex-col gap-4 md:h-[64vh] md:min-h-[430px] md:flex-row">
          <nav aria-label={t.settings.title} className="flex min-h-0 shrink-0 flex-col md:w-64">
            {profile && (
              <button type="button" onClick={() => setActivePage("account")} className="mb-3 hidden w-full items-center gap-2.5 rounded-xl p-2 text-left transition hover:bg-white/5 md:flex">
                <Avatar name={profile.username} image={profile.avatar} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-100">{profile.username}</span>
                  <span className="block truncate text-xs text-slate-500">{profile.username}#{profile.discriminator}</span>
                </span>
              </button>
            )}
            <div className="relative mb-2 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.settings.navSearch} aria-label={t.settings.navSearch} className="pl-8 pr-8" />
              {query && <button type="button" aria-label={t.settings.cancel} onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200"><X className="size-3.5" /></button>}
            </div>
            <div className="flex min-h-0 gap-1 overflow-x-auto pb-1 md:flex-1 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pb-0 md:pr-1">
              {visiblePages.length === 0 && <p className="whitespace-nowrap px-2 py-3 text-xs text-slate-500 md:whitespace-normal">{t.settings.navEmpty}</p>}
              {groups.map((group) => {
                const items = visiblePages.filter((page) => page.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="contents md:block">
                    <p className="mb-1 mt-3 hidden px-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-500 first:mt-0 md:block">{groupTitle(group)}</p>
                    {items.map((page) => {
                      const Icon = PAGE_ICONS[page.id];
                      const selected = page.id === effectivePage;
                      return (
                        <button
                          key={page.id}
                          type="button"
                          aria-current={selected ? "page" : undefined}
                          onClick={() => setActivePage(page.id)}
                          className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition md:w-full", selected ? "bg-white/8 font-medium text-slate-100" : "text-slate-400 hover:bg-white/5 hover:text-slate-200")}
                        >
                          <Icon className="size-4 shrink-0" />
                          {/* truncate только в вертикальном сайдбаре: длинные подписи
                              («Идентичность и приватность») не должны обрезаться без
                              многоточия; в горизонтальной ленте узких окон перенос запрещён. */}
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left md:whitespace-normal">{pageTitle(page.id)}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </nav>
          <div aria-hidden="true" className="hidden w-px shrink-0 bg-white/6 md:block" />
          <div role="tabpanel" aria-label={pageTitle(effectivePage)} className="min-h-0 min-w-0 flex-1 overflow-x-hidden md:overflow-y-auto md:pr-2">
            <h3 className="mb-4 text-lg font-bold tracking-tight text-slate-100">{pageTitle(effectivePage)}</h3>
            {effectivePage === "account" && profile && (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-slate-400">{t.profile.description}</p>
                <ProfileForm profile={profile} onSave={onSaveProfile} />
              </div>
            )}
            {effectivePage === "appearance" && (
              <div className="space-y-4">
                <Card title={t.settings.themeMode} hint={t.settings.themeModeHint}><ThemeModeSelector value={preferences.themeMode} label={t.settings.themeMode} labels={t.settings.themeModeNames} onChange={(themeMode) => updatePreferences({ ...preferences, themeMode })} />{darkEffective && <div className="mt-4 border-t border-white/6 pt-4"><DarkShadeSlider value={preferences.darkShade} label={t.settings.darkShade} labels={t.settings.darkShadeNames} hint={t.settings.darkShadeHint} onChange={(darkShade) => updatePreferences({ ...preferences, darkShade })} /></div>}</Card>
                <Card title={t.settings.colorTheme} hint={t.settings.colorThemeHint}><ThemeSelector value={preferences.colorTheme} label={t.settings.colorTheme} labels={t.settings.colorThemeNames} onChange={(colorTheme) => updatePreferences({ ...preferences, colorTheme })} /></Card>
                <Card><RowList>
                  <SettingRow title={t.settings.compact} hint={t.settings.compactHint}><Switch checked={preferences.compactMode} onCheckedChange={(value) => onPreferences({ ...preferences, compactMode: value })} /></SettingRow>
                  <SettingRow title={t.settings.members}><Switch checked={preferences.showMemberList} onCheckedChange={(value) => onPreferences({ ...preferences, showMemberList: value })} /></SettingRow>
                </RowList></Card>
                {isMobilePlatform() && <Card title={t.settings.uiScale} hint={t.settings.uiScaleHint}><div role="group" aria-label={t.settings.uiScale} className="grid grid-cols-4 gap-1 rounded-lg bg-white/[.04] p-1">{UI_SCALE_OPTIONS.map((scale) => <button key={scale} type="button" aria-pressed={preferences.uiScale === scale} onClick={() => updatePreferences({ ...preferences, uiScale: scale })} className={cn("rounded-lg px-2 py-2 text-center text-xs", preferences.uiScale === scale ? "bg-violet-500 font-semibold text-white" : "text-slate-500 hover:text-slate-200")}>{Math.round(scale * 100)}%</button>)}</div></Card>}
              </div>
            )}
            {effectivePage === "language" && (
              <Card title={t.settings.language} hint={t.settings.languageHint}><div role="group" aria-label={t.settings.language} className="grid grid-cols-3 gap-1 rounded-lg bg-white/[.04] p-1">{LANGUAGES.map((language: Language) => <button key={language} type="button" aria-pressed={preferences.language === language} onClick={() => updatePreferences({ ...preferences, language })} className={cn("rounded-lg px-3 py-2 text-center text-xs", preferences.language === language ? "bg-violet-500 font-semibold text-white" : "text-slate-500 hover:text-slate-200")}>{LANGUAGE_LABELS[language]}</button>)}</div></Card>
            )}
            {effectivePage === "notifications" && (
              <Card><RowList>
                <SettingRow title={t.settings.notifications}><Switch checked={preferences.notifications} onCheckedChange={(value) => onPreferences({ ...preferences, notifications: value })} /></SettingRow>
              </RowList></Card>
            )}
            {effectivePage === "voice" && (
              <div className="space-y-4">
                <Card title={t.settings.inputMode}><div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[.04] p-1"><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "voice" })} className={cn("rounded-lg px-3 py-2 text-center text-xs", preferences.voiceInputMode === "voice" ? "bg-violet-500 font-semibold text-white" : "text-slate-500 hover:text-slate-200")}>{t.settings.voiceActivation}</button><button type="button" onClick={() => updatePreferences({ ...preferences, voiceInputMode: "push-to-talk" })} className={cn("rounded-lg px-3 py-2 text-center text-xs", preferences.voiceInputMode === "push-to-talk" ? "bg-violet-500 font-semibold text-white" : "text-slate-500 hover:text-slate-200")}>{t.settings.pushToTalk}</button></div></Card>
                <Card title={t.settings.devices}><div className="space-y-3"><DeviceSelect icon={Mic} label={t.settings.microphone} devices={devices.filter((device) => device.kind === "audioinput")} value={preferences.voiceInputDeviceId} onChange={(voiceInputDeviceId) => updatePreferences({ ...preferences, voiceInputDeviceId })} /><DeviceSelect icon={Volume2} label={t.settings.outputDevice} devices={devices.filter((device) => device.kind === "audiooutput")} value={preferences.voiceOutputDeviceId} onChange={(voiceOutputDeviceId) => updatePreferences({ ...preferences, voiceOutputDeviceId })} /></div></Card>
                <Card><div className="flex items-center gap-3"><div className={cn("grid size-9 shrink-0 place-items-center rounded-xl", audio.status === "listening" ? "bg-emerald-400/10 text-emerald-300" : "bg-violet-400/10 text-violet-300")}>{audio.status === "listening" ? <Headphones className="size-4" /> : <Mic className="size-4" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">{t.settings.micTest}</p><p className="mt-0.5 text-xs text-slate-500">{t.settings.micTestHint}</p></div>{audio.status === "listening" ? <Button type="button" variant="danger" size="sm" className={ROW_BUTTON} onClick={audio.stop}><Square className="size-3.5" />{t.settings.stop}</Button> : <Button type="button" variant="secondary" size="sm" className={ROW_BUTTON} disabled={audio.status === "starting"} onClick={() => void audio.start()}>{audio.status === "starting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Headphones className="size-3.5" />}{audio.status === "starting" ? t.settings.starting : t.settings.listen}</Button>}</div>{audio.status === "listening" && <p role="status" className="mt-2 text-xs text-emerald-300">{t.settings.micPlaying}</p>}{audio.status === "error" && audio.error && <p role="alert" className="mt-2 text-xs text-red-300">{t.settings.micTestError(audio.error)}</p>}</Card>
                <Card title={t.settings.processing}><RowList>
                  <SettingRow title={t.settings.noiseSuppression} hint={t.settings.noiseSuppressionHint}><Switch aria-label={t.settings.noiseSuppression} checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow>
                  <SettingRow title={t.settings.echoCancellation}><Switch checked={preferences.echoCancellation} onCheckedChange={(echoCancellation) => updatePreferences({ ...preferences, echoCancellation })} /></SettingRow>
                  <SettingRow title={t.settings.noiseSuppressionShort}><Switch checked={preferences.noiseSuppression} onCheckedChange={(noiseSuppression) => updatePreferences({ ...preferences, noiseSuppression })} /></SettingRow>
                  <SettingRow title={t.settings.autoGain}><Switch checked={preferences.autoGainControl} onCheckedChange={(autoGainControl) => updatePreferences({ ...preferences, autoGainControl })} /></SettingRow>
                </RowList></Card>
              </div>
            )}
            {effectivePage === "keybinds" && (
              <div className="space-y-4"><div className="space-y-3"><KeybindRow action="mute" icon={Mic} title={t.settings.keybindMute} hint={t.settings.keybindMuteHint} bind={preferences.keybinds?.mute} conflict={preferences.keybinds?.deafen} onCapture={(bind) => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, mute: bind } })} onClear={() => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, mute: null } })} /><KeybindRow action="deafen" icon={Headphones} title={t.settings.keybindDeafen} hint={t.settings.keybindDeafenHint} bind={preferences.keybinds?.deafen} conflict={preferences.keybinds?.mute} onCapture={(bind) => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, deafen: bind } })} onClear={() => updatePreferences({ ...preferences, keybinds: { ...preferences.keybinds, deafen: null } })} /></div><p className="text-xs leading-5 text-slate-500">{t.settings.keybindsHint}</p></div>
            )}
            {effectivePage === "sensitivity" && (
              <Card><RowList>
                <SettingRow title={t.settings.automaticSensitivity} hint={t.settings.automaticSensitivityHint}><Switch aria-label={t.settings.automaticSensitivity} checked={preferences.automaticInputSensitivity} onCheckedChange={(automaticInputSensitivity) => updatePreferences({ ...preferences, automaticInputSensitivity })} /></SettingRow>
              </RowList>{!preferences.automaticInputSensitivity && <div className="border-t border-white/6 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-300">{t.settings.manualThreshold}</p><p className="mt-1 text-xs text-slate-500">{t.settings.manualThresholdHint}</p></div><span className="min-w-16 shrink-0 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold tabular-nums text-violet-200">{preferences.manualInputSensitivityDb} {t.settings.db}</span></div><MicLevelBar stream={audio.status === "listening" ? audio.stream : null} thresholdDb={preferences.manualInputSensitivityDb} /><input aria-label={t.settings.manualSensitivity} type="range" min={-80} max={-10} step={1} value={preferences.manualInputSensitivityDb} onChange={(event) => updatePreferences({ ...preferences, manualInputSensitivityDb: Number(event.target.value) })} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" /><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>{t.settings.sensitivityLeft}</span><span>{t.settings.sensitivityRight}</span></div></div>}</Card>
            )}
            {effectivePage === "updates" && <ClientUpdateSection state={updateState} />}
            {effectivePage === "privacy" && (
              <div className="space-y-4"><div className="rounded-2xl border border-violet-400/10 bg-violet-400/5 p-4 text-sm leading-6 text-violet-100/70"><div className="flex gap-3"><KeyRound className="mt-1 size-5 shrink-0 text-violet-300" /><div className="min-w-0"><p>{t.settings.identityFuture}</p>{identity && <><p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.discriminator}</p><code className="mt-1 block text-xs text-violet-200">#{identity.discriminator}</code></>}<p className="mt-3 text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.fingerprint}</p><code className="mt-1 block text-xs text-violet-200">{identity?.fingerprint ?? (identityState.status === "unavailable" ? t.settings.unavailable : t.settings.loading)}</code>{identity && <div className="mt-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-violet-300/60">{t.settings.publicKey}</p><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs text-violet-200">{identity.publicKey}</code><Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={() => void identityState.copyPublicKey()}><Copy className="size-4" />{t.settings.copyPublicKey}</Button></div><p className="mt-1 text-xs text-slate-500">{t.settings.publicKeyCopyHint}</p>{identityState.publicKeyCopied && <p role="status" className="mt-1 text-xs text-emerald-300">{t.settings.publicKeyCopied}</p>}{identityState.publicKeyCopyFailed && <p className="mt-1 text-xs text-amber-300">{t.settings.publicKeyCopyFailed}</p>}</div>}</div></div>{!identityReset ? <Button className={cn("mt-4", ROW_BUTTON)} variant="secondary" size="sm" onClick={() => setIdentityReset(true)}>{t.settings.resetIdentity}</Button> : <div className="mt-4 rounded-xl border border-amber-300/10 bg-amber-300/5 p-3"><p className="font-semibold text-amber-200">{t.settings.resetIdentityConfirm}</p><p className="mt-1 text-xs leading-5 text-amber-100/60">{t.settings.resetIdentityDescription}</p><div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={() => setIdentityReset(false)}>{t.settings.cancel}</Button><Button variant="danger" size="sm" className={ROW_BUTTON} onClick={resetIdentity}>{t.settings.resetIdentity}</Button></div></div>}</div></div>
            )}
            {effectivePage === "reset" && (
              <section className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/10 bg-red-400/[.035] p-4"><div className="min-w-0"><p className="text-sm font-semibold text-red-200">{t.settings.reset}</p><p className="mt-1 text-xs text-slate-500">{t.settings.resetHint}</p></div><Button variant="danger" size="sm" className={ROW_BUTTON} onClick={onRequestReset}><RotateCcw className="size-4" />{t.settings.reset}</Button></section>
            )}
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Единая карточка-секция: один скруглённый контейнер, один отступ, один заголовок. */
function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <section className="rounded-2xl border border-white/7 bg-white/[.025] p-4">
    {title && <p className="text-xs font-bold uppercase tracking-[.16em] text-slate-500">{title}</p>}
    {title && <div className="mt-3">{children}</div>}
    {!title && children}
    {hint && <p className={cn("text-xs leading-5 text-slate-500", title ? "mt-3" : "mt-2")}>{hint}</p>}
  </section>;
}

/** Ровный список строк-настроек с разделителями. */
function RowList({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="divide-y divide-white/6 overflow-hidden rounded-xl border border-white/6">{children}</div>;
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

  return <section><div className="rounded-2xl border border-cyan-400/10 bg-cyan-400/[.035] p-4"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p role={state?.status === "error" ? "alert" : "status"} className={state?.status === "error" ? "text-sm text-red-300" : "text-sm text-slate-300"}>{message}</p>{state && state.status !== "disabled" && <p className="mt-1 text-xs text-slate-500">{t.settings.updateChannel(state.currentVersion, state.channel)}</p>}</div><div className="shrink-0">{state?.status === "available" ? <Button size="sm" className={ROW_BUTTON} onClick={() => void updates?.download()}><Download className="size-4" />{t.settings.updateDownload}</Button> : state?.status === "downloaded" ? <Button size="sm" className={ROW_BUTTON} onClick={() => void updates?.install()}>{t.settings.updateInstall}</Button> : <Button variant="secondary" size="sm" className={ROW_BUTTON} disabled={!updates || checking || downloading || state?.status === "disabled"} onClick={() => void updates?.check()}>{checking ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{checking ? t.settings.updateChecking : downloading ? t.settings.updateDownloading(state.percent) : t.settings.updateCheck}</Button>}</div></div>{downloading && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${state.percent}%` }} /></div>}</div></section>;
}

export function DeviceSelect({ label, icon, devices, value, onChange }: { label: string; icon: typeof Mic; devices: MediaDeviceInfo[]; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const { t } = useI18n();
  return <label className="grid gap-1.5 text-xs font-medium text-slate-300">{label}<Combobox label={label} value={value ?? ""} placeholder={t.settings.systemDevice} icon={icon} options={devices.map((device, index) => ({ value: device.deviceId, label: device.label || `${label} ${index + 1}` }))} onChange={(next) => onChange(next || null)} /></label>;
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-200">{title}</p>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div><div className="shrink-0">{children}</div></div>;
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
