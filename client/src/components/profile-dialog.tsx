"use client";

import { useRef, useState } from "react";
import { userAvatarSchema, userBannerSchema, type UserStatus } from "@opencord/shared";
import { Camera, Crop, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { compressUserAvatar } from "@/lib/user-avatar-image";
import { compressUserBanner } from "@/lib/user-banner-image";
import { imageDataUrlToFile, type ImageCrop } from "@/lib/image-crop";
import type { LocalProfile } from "@/shared/state";

export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
  const { t } = useI18n();
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [banner, setBanner] = useState(profile.banner);
  const [status, setStatus] = useState<UserStatus>(profile.status ?? "online");
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [cropSource, setCropSource] = useState<{ file: File; kind: "avatar" | "banner" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setError("");
    setCompressing(true);
    try {
      const nextAvatar = avatar && !userAvatarSchema.safeParse(avatar).success ? await compressUserAvatar(await (await fetch(avatar)).blob()) : avatar;
      const nextBanner = banner && !userBannerSchema.safeParse(banner).success ? await compressUserBanner(await (await fetch(banner)).blob()) : banner;
      onSave({ ...profile, displayName: name.trim(), bio: bio.trim(), avatar: nextAvatar, banner: nextBanner, status });
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
          <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4 max-sm:flex-col max-sm:items-start">
            <Avatar name={name || profile.displayName} image={avatar} size="xl" />
            <div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? t.profile.compressing : t.profile.upload}</Button>{avatar && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => cropExisting("avatar")}><Crop className="size-4" />{t.profile.crop}</Button>}{avatar && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setAvatar(null)}><Trash2 className="size-4" />{t.profile.remove}</Button>}</div><p className="mt-2 max-w-72 text-xs leading-5 text-slate-500">{t.profile.avatarHint}</p>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</div>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{t.profile.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
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
          <Button type="submit" className="w-full" disabled={compressing || name.trim().length < 2}>{t.profile.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
    <ImageCropDialog source={cropSource?.file ?? null} title={cropSource?.kind === "banner" ? t.profile.cropBannerTitle : t.profile.cropAvatarTitle} description={cropSource?.kind === "banner" ? t.profile.cropBannerDescription : t.profile.cropAvatarDescription} aspectRatio={cropSource?.kind === "banner" ? 5 / 2 : 1} rounded={cropSource?.kind !== "banner"} onCancel={() => setCropSource(null)} onApply={applyCrop} />
  </>;
}
