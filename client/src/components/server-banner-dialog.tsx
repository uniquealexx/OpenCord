"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, Crop, LoaderCircle, Trash2 } from "lucide-react";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MockServer } from "@/shared/state";
import { compressUserBanner } from "@/lib/user-banner-image";
import { imageDataUrlToFile, type ImageCrop } from "@/lib/image-crop";
import { useI18n } from "@/lib/i18n";

export function ServerBannerDialog({ server, open, onOpenChange, onSave }: { server: MockServer; open: boolean; onOpenChange(open: boolean): void; onSave(banner: string | null): boolean }): React.ReactElement {
  const { t } = useI18n();
  const [banner, setBanner] = useState(server.banner ?? null);
  const [error, setError] = useState("");
  const [compressing, setCompressing] = useState(false);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function chooseBanner(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setCropSource(file); event.target.value = "";
  }

  function cropExisting(): void {
    if (!banner) return;
    setError("");
    try { setCropSource(imageDataUrlToFile(banner, "current-server-banner.webp")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.serverBanner.openFailed); }
  }

  async function applyCrop(crop: ImageCrop): Promise<void> {
    if (!cropSource) return;
    setCompressing(true); setError("");
    try { setBanner(await compressUserBanner(cropSource, crop)); setCropSource(null); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : t.serverBanner.compressFailed;
      setError(message);
      throw new Error(message);
    } finally { setCompressing(false); }
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (onSave(banner)) onOpenChange(false);
  }

  return <><Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t.serverBanner.title}</DialogTitle><DialogDescription>{t.serverBanner.description}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <div className="relative h-32 overflow-hidden rounded-2xl border border-white/7 bg-primary/15">
          {banner && <Image src={banner} alt="" fill unoptimized sizes="600px" className="object-cover" />}
        </div>
        <div className="flex flex-wrap gap-2"><input ref={inputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void chooseBanner(event)} /><Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={() => inputRef.current?.click()}>{compressing ? <LoaderCircle className="size-4 animate-spin" /> : <Camera className="size-4" />}{compressing ? t.serverBanner.compressing : t.serverBanner.choose}</Button>{banner && <Button type="button" variant="secondary" size="sm" disabled={compressing} onClick={cropExisting}><Crop className="size-4" />{t.serverBanner.crop}</Button>}{banner && <Button type="button" variant="danger" size="sm" disabled={compressing} onClick={() => setBanner(null)}><Trash2 className="size-4" />{t.serverBanner.remove}</Button>}</div>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <p className="text-xs leading-5 text-slate-500">{t.serverBanner.hint}</p>
        <Button type="submit" className="w-full" disabled={compressing}>{t.serverBanner.save}</Button>
      </form>
    </DialogContent>
  </Dialog><ImageCropDialog source={cropSource} title={t.serverBanner.cropTitle} description={t.serverBanner.cropDescription} aspectRatio={5 / 2} onCancel={() => setCropSource(null)} onApply={applyCrop} /></>;
}
