"use client";

import { useRef, useState } from "react";
import { Camera, Crop, LoaderCircle, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MockServer } from "@/shared/state";
import { compressServerAvatar } from "@/lib/server-avatar-image";
import { imageDataUrlToFile, type ImageCrop } from "@/lib/image-crop";

export function ServerAvatarDialog({ server, open, onOpenChange, onSave }: { server: MockServer; open: boolean; onOpenChange(open: boolean): void; onSave(avatar: string | null): boolean }): React.ReactElement {
  const [avatar, setAvatar] = useState(server.avatar ?? null);
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setCropSource(file); event.target.value = "";
  }

  function cropExisting(): void {
    if (!avatar) return;
    setError("");
    try { setCropSource(imageDataUrlToFile(avatar, "current-server-avatar.webp")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть установленное изображение"); }
  }

  async function applyCrop(crop: ImageCrop): Promise<void> {
    if (!cropSource) return;
    setCompressing(true); setError("");
    try { setAvatar(await compressServerAvatar(cropSource, crop)); setCropSource(null); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "Не удалось сжать изображение";
      setError(message);
      throw new Error(message);
    } finally { setCompressing(false); }
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (onSave(avatar)) onOpenChange(false);
  }

  return <><Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Аватар сервера</DialogTitle><DialogDescription>Изображение увидят все участники сервера. Изменить его может только владелец.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center gap-4 rounded-2xl border border-white/7 bg-white/[.025] p-4">
          <Avatar name={server.name} image={avatar} size="xl" />
          <div className="flex flex-wrap gap-2"><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseAvatar(event)} /><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? "Сжимаем…" : "Выбрать изображение"}</Button>{avatar && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={cropExisting}><Crop className="size-4" />Кадрировать</Button>}{avatar && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setAvatar(null)}><Trash2 className="size-4" />Удалить</Button>}</div>
        </div>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <p className="text-xs leading-5 text-slate-500">После выбора настройте кадр, затем изображение уменьшится до 256×256 и сожмётся в WebP меньше 1 МБ.</p>
        <Button type="submit" className="w-full" disabled={compressing}>Сохранить аватар</Button>
      </form>
    </DialogContent>
  </Dialog><ImageCropDialog source={cropSource} title="Кадрирование аватара сервера" description="Выберите квадратную область, которую увидят участники сервера." aspectRatio={1} rounded onCancel={() => setCropSource(null)} onApply={applyCrop} /></>;
}
