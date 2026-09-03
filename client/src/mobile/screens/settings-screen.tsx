"use client";

import { useState } from "react";
import { Copy, Headphones, KeyRound, Languages, LoaderCircle, Mic, Palette, RotateCcw, Sliders, SlidersHorizontal, Square, Volume2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { MicLevelBar } from "@/components/settings-dialog";
import { ThemeSelector } from "@/components/theme-selector";
import { useAudioSettings } from "@/components/settings/use-audio-settings";
import { useLocalIdentity } from "@/components/settings/use-local-identity";
import { LANGUAGE_LABELS, LANGUAGES, useI18n, type Language } from "@/lib/i18n";
import { ListBlock, ListChoice, ListGroup, ListLink, ListToggle } from "@/mobile/components/list";
import { Screen } from "@/mobile/components/screen";
import { useScreenStack } from "@/mobile/navigation";
import { isMobilePlatform } from "@/platform";
import { UI_SCALE_OPTIONS, type ClientPreferences } from "@/shared/state";

type Page = "root" | "appearance" | "theme" | "scale" | "language" | "voice" | "sensitivity" | "identity";

/**
 * Настройки как набор мобильных экранов вместо одной прокручиваемой простыни.
 *
 * Десктопный диалог показывает все разделы сразу — на широком экране это удобно,
 * на телефоне превращается в длинную ленту, где подписи жмутся к элементам
 * управления. Здесь корневой экран — оглавление, а каждый раздел открывается
 * отдельно и получает всю ширину; вся логика (микрофон, устройства, идентичность)
 * общая с десктопом через хуки в `components/settings/`.
 */
export function MobileSettingsScreen({
  preferences,
  confirmReset,
  onClose,
  onPreferences,
  onRequestReset,
  onCancelReset,
  onReset,
  onIdentityReset,
}: {
  preferences: ClientPreferences;
  confirmReset: boolean;
  onClose: () => void;
  onPreferences: (preferences: ClientPreferences) => void;
  onRequestReset: () => void;
  onCancelReset: () => void;
  onReset: () => void;
  onIdentityReset?: (identity: { publicKey: string; fingerprint: string; discriminator: string }) => void;
}): React.ReactElement {
  const { t } = useI18n();
  const stack = useScreenStack<Page>("root");
  const audio = useAudioSettings(preferences, true);
  const identityState = useLocalIdentity(true, onIdentityReset);
  const [identityResetOpen, setIdentityResetOpen] = useState(false);

  const update = (next: Partial<ClientPreferences>): void => onPreferences({ ...preferences, ...next });
  const back = (): void => {
    audio.stop();
    stack.pop();
  };
  const close = (): void => {
    audio.stop();
    onClose();
  };

  if (confirmReset) {
    return (
      <Screen title={t.settings.reset} onBack={onCancelReset}>
        <div className="rounded-2xl border border-red-400/12 bg-red-400/[.04] p-4">
          <h2 className="text-base font-bold text-red-200">{t.settings.resetConfirm}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">{t.settings.resetDescription}</p>
        </div>
        <div className="mt-5 grid gap-2">
          <Button variant="danger" className="h-12" onClick={onReset}>{t.settings.confirm}</Button>
          <Button variant="secondary" className="h-12" onClick={onCancelReset}>{t.settings.cancel}</Button>
        </div>
      </Screen>
    );
  }

  if (stack.current === "appearance") {
    return (
      <Screen title={t.settings.appearance} onBack={back}>
        <ListGroup>
          <ListToggle label={t.settings.compact} hint={t.settings.compactHint} checked={preferences.compactMode} onChange={(compactMode) => update({ compactMode })} />
          <ListToggle label={t.settings.members} checked={preferences.showMemberList} onChange={(showMemberList) => update({ showMemberList })} />
          <ListToggle label={t.settings.notifications} checked={preferences.notifications} onChange={(notifications) => update({ notifications })} />
        </ListGroup>
      </Screen>
    );
  }

  if (stack.current === "theme") {
    return (
      <Screen title={t.settings.colorTheme} onBack={back}>
        <ListGroup hint={t.settings.colorThemeHint}>
          <ListBlock>
            <ThemeSelector
              value={preferences.colorTheme}
              label={t.settings.colorTheme}
              labels={t.settings.colorThemeNames}
              onChange={(colorTheme) => update({ colorTheme })}
            />
          </ListBlock>
        </ListGroup>
      </Screen>
    );
  }

  if (stack.current === "scale") {
    return (
      <Screen title={t.settings.uiScale} onBack={back}>
        <ListGroup hint={t.settings.uiScaleHint}>
          <ListChoice
            label={t.settings.uiScale}
            value={preferences.uiScale}
            options={UI_SCALE_OPTIONS.map((scale) => ({ value: scale, label: `${Math.round(scale * 100)}%` }))}
            onChange={(uiScale) => update({ uiScale })}
          />
        </ListGroup>
      </Screen>
    );
  }

  if (stack.current === "language") {
    return (
      <Screen title={t.settings.language} onBack={back}>
        <ListGroup hint={t.settings.languageHint}>
          <ListChoice
            label={t.settings.language}
            value={preferences.language}
            options={LANGUAGES.map((language: Language) => ({ value: language, label: LANGUAGE_LABELS[language] }))}
            onChange={(language) => update({ language })}
          />
        </ListGroup>
      </Screen>
    );
  }

  if (stack.current === "voice") {
    const inputs = audio.devices.filter((device) => device.kind === "audioinput");
    const outputs = audio.devices.filter((device) => device.kind === "audiooutput");
    return (
      <Screen title={t.settings.voice} onBack={back}>
        <ListGroup>
          <ListChoice
            label={t.settings.voice}
            value={preferences.voiceInputMode}
            options={[
              { value: "voice" as const, label: t.settings.voiceActivation },
              { value: "push-to-talk" as const, label: t.settings.pushToTalk },
            ]}
            onChange={(voiceInputMode) => update({ voiceInputMode })}
          />
        </ListGroup>

        <ListGroup>
          <ListBlock label={t.settings.microphone}>
            <Combobox label={t.settings.microphone} value={preferences.voiceInputDeviceId ?? ""} placeholder={t.settings.systemDevice} icon={Mic} options={inputs.map((device, index) => ({ value: device.deviceId, label: device.label || `${t.settings.microphone} ${index + 1}` }))} onChange={(next) => update({ voiceInputDeviceId: next || null })} />
          </ListBlock>
          <ListBlock label={t.settings.outputDevice}>
            <Combobox label={t.settings.outputDevice} value={preferences.voiceOutputDeviceId ?? ""} placeholder={t.settings.systemDevice} icon={Volume2} options={outputs.map((device, index) => ({ value: device.deviceId, label: device.label || `${t.settings.outputDevice} ${index + 1}` }))} onChange={(next) => update({ voiceOutputDeviceId: next || null })} />
          </ListBlock>
        </ListGroup>

        <ListGroup title={t.settings.micTest}>
          <ListBlock hint={t.settings.micTestHint}>
            {audio.status === "listening" ? (
              <Button type="button" variant="danger" className="h-12 w-full" onClick={audio.stop}>
                <Square className="size-4" />
                {t.settings.stop}
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="h-12 w-full" disabled={audio.status === "starting"} onClick={() => void audio.start()}>
                {audio.status === "starting" ? <LoaderCircle className="size-4 animate-spin" /> : <Headphones className="size-4" />}
                {audio.status === "starting" ? t.settings.starting : t.settings.listen}
              </Button>
            )}
            {audio.status === "listening" && <p role="status" className="mt-2 text-xs text-emerald-300">{t.settings.micPlaying}</p>}
            {audio.status === "error" && audio.error && <p role="alert" className="mt-2 text-xs text-red-300">{t.settings.micTestError(audio.error)}</p>}
          </ListBlock>
        </ListGroup>

        <ListGroup>
          <ListToggle label={t.settings.noiseSuppressionShort} hint={t.settings.noiseSuppressionHint} checked={preferences.noiseSuppression} onChange={(noiseSuppression) => update({ noiseSuppression })} />
          <ListToggle label={t.settings.echoCancellation} checked={preferences.echoCancellation} onChange={(echoCancellation) => update({ echoCancellation })} />
          <ListToggle label={t.settings.autoGain} checked={preferences.autoGainControl} onChange={(autoGainControl) => update({ autoGainControl })} />
        </ListGroup>
      </Screen>
    );
  }

  if (stack.current === "sensitivity") {
    return (
      <Screen title={t.settings.sensitivity} onBack={back}>
        <ListGroup>
          <ListToggle label={t.settings.automaticSensitivity} hint={t.settings.automaticSensitivityHint} checked={preferences.automaticInputSensitivity} onChange={(automaticInputSensitivity) => update({ automaticInputSensitivity })} />
        </ListGroup>
        {!preferences.automaticInputSensitivity && (
          <ListGroup title={t.settings.manualThreshold} hint={t.settings.manualThresholdHint}>
            <ListBlock>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm text-slate-400">{t.settings.manualSensitivity}</span>
                <span className="min-w-16 rounded-lg bg-violet-400/10 px-3 py-2 text-center text-sm font-bold tabular-nums text-violet-200">{preferences.manualInputSensitivityDb} {t.settings.db}</span>
              </div>
              <MicLevelBar stream={audio.status === "listening" ? audio.stream : null} thresholdDb={preferences.manualInputSensitivityDb} />
              <input aria-label={t.settings.manualSensitivity} type="range" min={-80} max={-10} step={1} value={preferences.manualInputSensitivityDb} onChange={(event) => update({ manualInputSensitivityDb: Number(event.target.value) })} className="voice-limit-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15" />
              <div className="mt-2 flex justify-between text-[10px] text-slate-600">
                <span>{t.settings.sensitivityLeft}</span>
                <span>{t.settings.sensitivityRight}</span>
              </div>
            </ListBlock>
          </ListGroup>
        )}
      </Screen>
    );
  }

  if (stack.current === "identity") {
    const { identity } = identityState;
    return (
      <Screen title={t.settings.privacy} onBack={back}>
        <p className="mb-5 text-sm leading-6 text-slate-400">{t.settings.identityFuture}</p>
        <ListGroup>
          {identity && (
            <ListBlock label={t.settings.discriminator}>
              <code className="block text-sm text-violet-200">#{identity.discriminator}</code>
            </ListBlock>
          )}
          <ListBlock label={t.settings.fingerprint}>
            <code className="block break-all text-sm text-violet-200">{identity?.fingerprint ?? (identityState.status === "unavailable" ? t.settings.unavailable : t.settings.loading)}</code>
          </ListBlock>
          {identity && (
            <ListBlock label={t.settings.publicKey} hint={t.settings.publicKeyCopyHint}>
              <code className="block break-all text-xs leading-5 text-violet-200">{identity.publicKey}</code>
              <Button variant="secondary" className="mt-3 h-11 w-full" onClick={() => void identityState.copyPublicKey()}>
                <Copy className="size-4" />
                {t.settings.copyPublicKey}
              </Button>
              {identityState.publicKeyCopied && <p role="status" className="mt-2 text-xs text-emerald-300">{t.settings.publicKeyCopied}</p>}
              {identityState.publicKeyCopyFailed && <p className="mt-2 text-xs text-amber-300">{t.settings.publicKeyCopyFailed}</p>}
            </ListBlock>
          )}
        </ListGroup>

        {!identityResetOpen ? (
          <Button variant="secondary" className="h-12 w-full" onClick={() => setIdentityResetOpen(true)}>{t.settings.resetIdentity}</Button>
        ) : (
          <div className="rounded-2xl border border-amber-300/12 bg-amber-300/5 p-4">
            <p className="font-semibold text-amber-200">{t.settings.resetIdentityConfirm}</p>
            <p className="mt-1 text-xs leading-5 text-amber-100/60">{t.settings.resetIdentityDescription}</p>
            <div className="mt-4 grid gap-2">
              <Button variant="danger" className="h-12" onClick={() => { identityState.reset(); setIdentityResetOpen(false); }}>{t.settings.resetIdentity}</Button>
              <Button variant="secondary" className="h-12" onClick={() => setIdentityResetOpen(false)}>{t.settings.cancel}</Button>
            </div>
          </div>
        )}
      </Screen>
    );
  }

  return (
    <Screen title={t.settings.title} onClose={close}>
      <ListGroup>
        <ListLink icon={<SlidersHorizontal className="size-4" />} label={t.settings.appearance} onClick={() => stack.push("appearance")} />
        <ListLink icon={<Palette className="size-4" />} label={t.settings.colorTheme} value={t.settings.colorThemeNames[preferences.colorTheme]} onClick={() => stack.push("theme")} />
        {isMobilePlatform() && <ListLink icon={<ZoomIn className="size-4" />} label={t.settings.uiScale} value={`${Math.round(preferences.uiScale * 100)}%`} onClick={() => stack.push("scale")} />}
        <ListLink icon={<Languages className="size-4" />} label={t.settings.language} value={LANGUAGE_LABELS[preferences.language]} onClick={() => stack.push("language")} />
      </ListGroup>

      <ListGroup>
        <ListLink icon={<Mic className="size-4" />} label={t.settings.voice} value={preferences.voiceInputMode === "voice" ? t.settings.voiceActivation : t.settings.pushToTalk} onClick={() => stack.push("voice")} />
        <ListLink icon={<Sliders className="size-4" />} label={t.settings.sensitivity} value={preferences.automaticInputSensitivity ? t.settings.automaticSensitivity : `${preferences.manualInputSensitivityDb} ${t.settings.db}`} onClick={() => stack.push("sensitivity")} />
      </ListGroup>

      <ListGroup>
        <ListLink icon={<KeyRound className="size-4" />} label={t.settings.privacy} onClick={() => stack.push("identity")} />
      </ListGroup>

      <ListGroup>
        <ListLink icon={<RotateCcw className="size-4" />} danger label={t.settings.reset} onClick={onRequestReset} />
      </ListGroup>
      <p className="px-1 text-xs leading-5 text-slate-500">{t.settings.resetHint}</p>
    </Screen>
  );
}
