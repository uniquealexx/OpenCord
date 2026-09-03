"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOM_STATUS_MAX_LENGTH, userAvatarSchema, userBannerSchema, type UserStatus } from "@opencord/shared";
import { AtSign, Camera, Check, Copy, Crop, Fingerprint, Frame, ImagePlus, LoaderCircle, Trash2, Type, X } from "lucide-react";
import { AccentColorPicker, ColorSwatchPicker } from "@/components/accent-color-picker";
import { Avatar } from "@/components/avatar";
import { EmojiPicker } from "@/components/emoji-picker";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { accentCardStyle, accentGlassBackground, FALLBACK_ACCENT_COLOR, nameGlowStyle } from "@/lib/accent-color";
import { compressUserAvatar } from "@/lib/user-avatar-image";
import { compressUserBanner } from "@/lib/user-banner-image";
import { imageDataUrlToFile, type ImageCrop } from "@/lib/image-crop";
import type { LocalProfile } from "@/shared/state";

const emojiFont = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * Заготовки будущей кастомизации профиля (аналог подписочных возможностей Discord):
 * UI-плейсхолдеры без передачи данных — в протокол они попадут только при реализации.
 */
const CUSTOMIZATION_PLACEHOLDERS = [
  { icon: Type, labelKey: "nameFont" },
  { icon: Frame, labelKey: "avatarDecoration" },
] as const;

export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
  const { t } = useI18n();
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [banner, setBanner] = useState(profile.banner);
  const [status, setStatus] = useState<UserStatus>(profile.status ?? "online");
  const [customStatus, setCustomStatus] = useState(profile.customStatus ?? "");
  const [customStatusEmoji, setCustomStatusEmoji] = useState(profile.customStatusEmoji ?? "");
  const [accentColor, setAccentColor] = useState<string | null>(profile.accentColor ?? null);
  const [nameGlowEnabled, setNameGlowEnabled] = useState(profile.nameGlow != null);
  // Выбранный цвет свечения запоминается на время диалога: выключение галочки
  // снимает свечение, но повторное включение возвращает тот же цвет.
  const [nameGlowColor, setNameGlowColor] = useState(profile.nameGlow ?? FALLBACK_ACCENT_COLOR);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [fingerprintCopied, setFingerprintCopied] = useState(false);
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [cropSource, setCropSource] = useState<{ file: File; kind: "avatar" | "banner" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void window.openCord?.identity?.getOrCreate().then((identity) => setFingerprint(identity.fingerprint)).catch(() => setFingerprint(null));
  }, [open]);

  const usernameValid = /^[a-z0-9_.-]{2,32}$/u.test(username.trim().toLowerCase());

  function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setCropSource({ file, kind: "avatar" });
    event.target.value = "";
  }

  function chooseBanner(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setCropSource({ file, kind: "banner" });
    event.target.value = "";
  }

  function cropExisting(kind: "avatar" | "banner"): void {
    const image = kind === "avatar" ? avatar : banner;
    if (!image) return;
    setError("");
    try { setCropSource({ file: imageDataUrlToFile(image, kind === "avatar" ? "current-avatar.webp" : "current-banner.webp"), kind }); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : t.profile.openFailed); }
  }

  async function applyCrop(crop: ImageCrop): Promise<void> {
    if (!cropSource) return;
    setCompressing(true); setError("");
    try {
      if (cropSource.kind === "avatar") setAvatar(await compressUserAvatar(cropSource.file, crop));
      else setBanner(await compressUserBanner(cropSource.file, crop));
      setCropSource(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : t.profile.processFailed;
      setError(message);
      throw new Error(message);
    } finally { setCompressing(false); }
  }

  async function copyFingerprint(): Promise<void> {
    if (!fingerprint) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t.profile.copyFailed);
      await navigator.clipboard.writeText(fingerprint);
      setFingerprintCopied(true);
      window.setTimeout(() => setFingerprintCopied(false), 2_000);
    } catch { /* код остаётся выделяемым вручную */ }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!usernameValid) return;
    setError("");
    setCompressing(true);
    try {
      const nextAvatar = avatar && !userAvatarSchema.safeParse(avatar).success ? await compressUserAvatar(await (await fetch(avatar)).blob()) : avatar;
      const nextBanner = banner && !userBannerSchema.safeParse(banner).success ? await compressUserBanner(await (await fetch(banner)).blob()) : banner;
      onSave({ ...profile, username: username.trim().toLowerCase(), bio: bio.trim(), avatar: nextAvatar, banner: nextBanner, status, customStatus: customStatus.trim(), customStatusEmoji: customStatus.trim() ? customStatusEmoji : "", accentColor, nameGlow: nameGlowEnabled ? nameGlowColor : null });
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.profile.avatarFailed);
    } finally { setCompressing(false); }
  }

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.profile.title}</DialogTitle><DialogDescription>{t.profile.description}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[.025]">
            <div className="relative aspect-[5/2] overflow-hidden bg-primary/15">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {banner && <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap justify-end gap-2 bg-black/45 p-3">
                <input ref={bannerInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseBanner(event)} />
                <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => bannerInputRef.current?.click()}><ImagePlus className="size-4" />{banner ? t.profile.replace : t.profile.addBanner}</Button>
                {banner && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => cropExisting("banner")}><Crop className="size-4" />{t.profile.crop}</Button>}
                {banner && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setBanner(null)}><Trash2 className="size-4" />{t.profile.remove}</Button>}
              </div>
            </div>
            <p className="px-4 py-3 text-xs leading-5 text-slate-500">{t.profile.bannerHint}</p>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4 max-md:flex-col max-md:items-start">
            <Avatar name={username || profile.username} image={avatar} size="xl" />
            <div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? t.profile.compressing : t.profile.upload}</Button>{avatar && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => cropExisting("avatar")}><Crop className="size-4" />{t.profile.crop}</Button>}{avatar && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setAvatar(null)}><Trash2 className="size-4" />{t.profile.remove}</Button>}</div><p className="mt-2 max-w-72 text-xs leading-5 text-slate-500">{t.profile.avatarHint}</p>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</div>
          </div>
          <div className="rounded-2xl border border-white/7 bg-white/[.025] p-4">
            <label className="grid gap-2 text-sm font-medium text-slate-300">{t.profile.username}<Input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} placeholder="username" className={username && !usernameValid ? "border-red-400/60" : ""} /></label>
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><AtSign className="size-3.5" />{t.profile.usernameHint}</p>
            <div className="mt-4 rounded-xl border border-white/[.06] bg-black/15 px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">{t.profile.tag}</p>
                <p className="min-w-0 truncate text-sm font-semibold text-slate-200">{username.trim().toLowerCase() || "username"}#{profile.discriminator}</p>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">{t.profile.tagHint}</p>
              <div className="mt-3 flex items-center gap-1.5 border-t border-white/[.06] pt-3">
                <Fingerprint className="size-3.5 shrink-0 text-violet-300/70" />
                <p className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">{t.profile.identityCode}</p>
              </div>
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <code title={t.profile.identityCodeHint} className="min-w-0 flex-1 truncate rounded-md bg-white/[.04] px-2 py-1 text-xs text-violet-200/90">{fingerprint ?? t.profile.identityCodeUnavailable}</code>
                {fingerprint && <button type="button" aria-label={t.profile.copyCode} title={t.profile.copyCode} onClick={() => void copyFingerprint()} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200">{fingerprintCopied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}</button>}
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-500">{t.profile.identityCodeHint}</p>
            </div>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{t.profile.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} /></label>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-slate-300">{t.profile.status}</legend>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["online", t.statuses.online, "bg-emerald-400"],
                ["idle", t.statuses.idle, "bg-amber-400"],
                ["dnd", t.statuses.dnd, "bg-red-400"],
                ["invisible", t.statuses.invisible, "bg-slate-500"],
              ] as const).map(([value, label, color]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${status === value ? "border-violet-400/50 bg-violet-400/10 text-white" : "border-white/[.07] bg-white/[.025] text-slate-400 hover:bg-white/[.05]"}`}><span className={`size-2.5 rounded-full ${color}`} />{label}</button>)}
            </div>
            {status === "invisible" && <p className="text-xs text-slate-500">{t.profile.invisibleHint}</p>}
          </fieldset>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-300" htmlFor="custom-status">{t.profile.customStatus}</label>
            <div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-2">
              <EmojiPicker
                trigger={customStatusEmoji ? <span className="text-lg leading-none" style={{ fontFamily: emojiFont }}>{customStatusEmoji}</span> : undefined}
                panelClassName="bottom-auto top-11 left-0 right-auto max-md:bottom-auto max-md:top-11"
                onSelect={setCustomStatusEmoji}
              />
              <Input id="custom-status" value={customStatus} onChange={(event) => setCustomStatus(event.target.value)} maxLength={CUSTOM_STATUS_MAX_LENGTH} placeholder={t.profile.customStatusPlaceholder} className="border-0 bg-transparent px-1 focus-visible:ring-0" />
              {(customStatus || customStatusEmoji) && <button type="button" aria-label={t.profile.customStatusClear} title={t.profile.customStatusClear} onClick={() => { setCustomStatus(""); setCustomStatusEmoji(""); }} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-200"><X className="size-4" /></button>}
            </div>
            <p className="text-right text-[11px] text-slate-500">{customStatus.length}/{CUSTOM_STATUS_MAX_LENGTH}</p>
            <p className="text-[11px] leading-4 text-slate-500">{t.profile.customStatusHint}</p>
          </div>
          <fieldset className="grid gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-4">
            <legend className="px-1 text-sm font-medium text-slate-300">{t.profile.customization}</legend>
            <label className="text-sm font-medium text-slate-300">{t.profile.accentColor}</label>
            <AccentColorPicker value={accentColor} onChange={setAccentColor} />
            {/* Живое превью: как акцент окрасит стекло карточки профиля. */}
            <div
              className="glass flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{ ...(accentColor ? { backgroundColor: accentGlassBackground(accentColor) } : {}), ...accentCardStyle(accentColor) }}
              data-testid="profile-accent-preview"
            >
              <Avatar name={username || profile.username} image={avatar} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-[color:var(--pv-heading)]" style={nameGlowEnabled ? nameGlowStyle(nameGlowColor) : undefined}>{username.trim().toLowerCase() || profile.username}</span>
                <span className="block truncate text-[10px] text-[color:var(--pv-soft)]">@{username.trim().toLowerCase() || profile.username}#{profile.discriminator}</span>
              </span>
            </div>
            <div className="grid gap-3 border-t border-white/[.06] pt-3" data-testid="name-glow-picker">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-300">
                <input type="checkbox" checked={nameGlowEnabled} onChange={(event) => setNameGlowEnabled(event.target.checked)} className="size-4 rounded accent-violet-500" />
                {t.profile.nameGlow}
              </label>
              {nameGlowEnabled && <>
                <ColorSwatchPicker value={nameGlowColor} onChange={setNameGlowColor} groupLabel={t.profile.nameGlowColor} customLabel={t.profile.accentColorCustom} />
                <p className="text-[11px] leading-4 text-slate-500">{t.profile.nameGlowHint}</p>
              </>}
            </div>
            <div className="grid gap-1.5 border-t border-white/[.06] pt-3">
              {CUSTOMIZATION_PLACEHOLDERS.map(({ icon: Icon, labelKey }) => (
                <div key={labelKey} className="flex items-center gap-2 rounded-lg px-1 py-1 opacity-60" aria-disabled="true">
                  <Icon className="size-3.5 shrink-0 text-violet-300/70" />
                  <span className="text-xs text-slate-400">{t.profile[labelKey]}</span>
                  <span className="ml-auto rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] font-semibold text-slate-500">{t.profile.comingSoon}</span>
                </div>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="w-full" disabled={compressing || !usernameValid}>{t.profile.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
    <ImageCropDialog source={cropSource?.file ?? null} title={cropSource?.kind === "banner" ? t.profile.cropBannerTitle : t.profile.cropAvatarTitle} description={cropSource?.kind === "banner" ? t.profile.cropBannerDescription : t.profile.cropAvatarDescription} aspectRatio={cropSource?.kind === "banner" ? 5 / 2 : 1} rounded={cropSource?.kind !== "banner"} onCancel={() => setCropSource(null)} onApply={applyCrop} />
  </>;
}
