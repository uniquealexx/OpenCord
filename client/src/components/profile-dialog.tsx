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
import { ru } from "@/lib/i18n/ru";
import { compressUserAvatar } from "@/lib/user-avatar-image";
import { compressUserBanner } from "@/lib/user-banner-image";
import { imageDataUrlToFile, type ImageCrop } from "@/lib/image-crop";
import type { LocalProfile } from "@/shared/state";

export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
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
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Не удалось открыть установленное изображение"); }
  }

  async function applyCrop(crop: ImageCrop): Promise<void> {
    if (!cropSource) return;
    setCompressing(true); setError("");
    try {
      if (cropSource.kind === "avatar") setAvatar(await compressUserAvatar(cropSource.file, crop));
      else setBanner(await compressUserBanner(cropSource.file, crop));
      setCropSource(null);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Не удалось обработать изображение";
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
      setError(nextError instanceof Error ? nextError.message : "Не удалось обработать аватар");
    } finally { setCompressing(false); }
  }

  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ru.profile.title}</DialogTitle><DialogDescription>{ru.profile.description}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-white/7 bg-white/[.025]">
            <div className="relative aspect-[5/2] overflow-hidden bg-primary/15">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {banner && <img src={banner} alt="" className="absolute inset-0 size-full object-cover" />}
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-black/45 p-3">
                <input ref={bannerInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseBanner(event)} />
                <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => bannerInputRef.current?.click()}><ImagePlus className="size-4" />{banner ? "Заменить" : "Добавить шапку"}</Button>
                {banner && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => cropExisting("banner")}><Crop className="size-4" />Кадрировать</Button>}
                {banner && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setBanner(null)}><Trash2 className="size-4" />Удалить</Button>}
              </div>
            </div>
            <p className="px-4 py-3 text-xs leading-5 text-slate-500">Шапка обрежется до формата 5:2 и сохранится как WebP размером до 256 КБ.</p>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4">
            <Avatar name={name || profile.displayName} image={avatar} size="xl" />
            <div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? "Сжимаем…" : ru.profile.upload}</Button>{avatar && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => cropExisting("avatar")}><Crop className="size-4" />Кадрировать</Button>}{avatar && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setAvatar(null)}><Trash2 className="size-4" />Удалить</Button>}</div><p className="mt-2 max-w-72 text-xs leading-5 text-slate-500">Изображение обрежется до квадрата 128×128 и сохранится как WebP размером до 96 КБ.</p>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</div>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} /></label>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-slate-300">Статус</legend>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["online", "В сети", "bg-emerald-400"],
                ["idle", "Недоступен", "bg-amber-400"],
                ["dnd", "Не беспокоить", "bg-red-400"],
                ["invisible", "Невидимка", "bg-slate-500"],
              ] as const).map(([value, label, color]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${status === value ? "border-violet-400/50 bg-violet-400/10 text-white" : "border-white/[.07] bg-white/[.025] text-slate-400 hover:bg-white/[.05]"}`}><span className={`size-2.5 rounded-full ${color}`} />{label}</button>)}
            </div>
            {status === "invisible" && <p className="text-xs text-slate-500">Для остальных участников вы будете отображаться не в сети.</p>}
          </fieldset>
          <Button type="submit" className="w-full" disabled={compressing || name.trim().length < 2}>{ru.profile.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
    <ImageCropDialog source={cropSource?.file ?? null} title={cropSource?.kind === "banner" ? "Кадрирование шапки" : "Кадрирование аватара"} description={cropSource?.kind === "banner" ? "Выберите широкую область, которая будет видна в шапке профиля." : "Выберите область, которая будет видна в аватаре профиля."} aspectRatio={cropSource?.kind === "banner" ? 5 / 2 : 1} rounded={cropSource?.kind !== "banner"} onCancel={() => setCropSource(null)} onApply={applyCrop} />
  </>;
}
