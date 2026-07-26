"use client";

import { useRef, useState } from "react";
import { userAvatarSchema } from "@opencord/shared";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ru } from "@/lib/i18n/ru";
import { compressUserAvatar } from "@/lib/user-avatar-image";
import type { LocalProfile } from "@/shared/state";

export function ProfileDialog({ profile, open, onOpenChange, onSave }: { profile: LocalProfile; open: boolean; onOpenChange: (open: boolean) => void; onSave: (profile: LocalProfile) => void }): React.ReactElement {
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setCompressing(true);
    try { setAvatar(await compressUserAvatar(file)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Не удалось обработать аватар"); }
    finally { setCompressing(false); event.target.value = ""; }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setError("");
    setCompressing(true);
    try {
      const nextAvatar = avatar && !userAvatarSchema.safeParse(avatar).success ? await compressUserAvatar(await (await fetch(avatar)).blob()) : avatar;
      onSave({ ...profile, displayName: name.trim(), bio: bio.trim(), avatar: nextAvatar });
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось обработать аватар");
    } finally { setCompressing(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{ru.profile.title}</DialogTitle><DialogDescription>{ru.profile.description}</DialogDescription></DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4">
            <Avatar name={name || profile.displayName} image={avatar} size="xl" />
            <div><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event)} /><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? "Сжимаем…" : ru.profile.upload}</Button>{avatar && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setAvatar(null)}><Trash2 className="size-4" />Удалить</Button>}</div><p className="mt-2 max-w-72 text-xs leading-5 text-slate-500">Изображение обрежется до квадрата 128×128 и сохранится как WebP размером до 96 КБ.</p>{error && <p className="mt-2 text-xs text-red-300">{error}</p>}</div>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.name}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} /></label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">{ru.profile.bio}<Textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} /></label>
          <Button type="submit" className="w-full" disabled={compressing || name.trim().length < 2}>{ru.profile.save}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
