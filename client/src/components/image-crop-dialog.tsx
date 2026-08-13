"use client";

import { useEffect, useRef, useState } from "react";
import { Crop, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calculateCropRectangle, DEFAULT_IMAGE_CROP, validateCropSource, type ImageCrop } from "@/lib/image-crop";
import { cn } from "@/lib/utils";

const PREVIEW_WIDTH = 600;

interface ImageCropDialogProps { source: File | null; title: string; description: string; aspectRatio: number; rounded?: boolean; onCancel(): void; onApply(crop: ImageCrop): Promise<void> }

export function ImageCropDialog(props: ImageCropDialogProps): React.ReactElement {
  if (!props.source) return <Dialog open={false} onOpenChange={() => undefined} />;
  let initialError = "";
  try { validateCropSource(props.source); }
  catch (reason) { initialError = reason instanceof Error ? reason.message : "Не удалось открыть изображение"; }
  return <ImageCropEditor key={`${props.source.name}:${props.source.size}:${props.source.lastModified}`} {...props} source={props.source} initialError={initialError} />;
}

function ImageCropEditor({ source, title, description, aspectRatio, rounded = false, onCancel, onApply, initialError }: Omit<ImageCropDialogProps, "source"> & { source: File; initialError: string }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [crop, setCrop] = useState<ImageCrop>(DEFAULT_IMAGE_CROP);
  const [loading, setLoading] = useState(!initialError);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(initialError);

  useEffect(() => {
    if (initialError) return;
    let active = true;
    void createImageBitmap(source).then((bitmap) => {
      if (!active) { bitmap.close(); return; }
      if (!bitmap.width || !bitmap.height || bitmap.width > 16_384 || bitmap.height > 16_384) { bitmap.close(); throw new Error("Слишком большое разрешение изображения"); }
      bitmapRef.current?.close();
      bitmapRef.current = bitmap;
      setLoading(false);
    }).catch((reason: unknown) => {
      if (!active) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : "Не удалось открыть изображение");
    });
    return () => {
      active = false;
      bitmapRef.current?.close();
      bitmapRef.current = null;
    };
  }, [initialError, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rectangle = calculateCropRectangle(bitmap.width, bitmap.height, aspectRatio, crop);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0, canvas.width, canvas.height);
  }, [aspectRatio, crop, loading]);

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!bitmapRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: crop.x, y: crop.y };
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCrop((current) => ({ ...current, x: clamp(drag.x - (event.clientX - drag.clientX) * 2 / Math.max(1, bounds.width)), y: clamp(drag.y - (event.clientY - drag.clientY) * 2 / Math.max(1, bounds.height)) }));
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function apply(): Promise<void> {
    if (!bitmapRef.current || applying) return;
    setApplying(true); setError("");
    try { await onApply(crop); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось кадрировать изображение"); }
    finally { setApplying(false); }
  }

  const height = Math.round(PREVIEW_WIDTH / aspectRatio);
  return <Dialog open={Boolean(source)} onOpenChange={(open) => { if (!open && !applying) onCancel(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className={cn("relative mx-auto w-full overflow-hidden border border-white/10 bg-black shadow-inner", rounded ? "max-w-[360px] rounded-full" : "rounded-2xl")} style={{ aspectRatio }}>
          <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={height} aria-label="Область кадрирования" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} className={cn("size-full touch-none object-cover", !loading && !error && "cursor-grab active:cursor-grabbing")} />
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-35 [&>*]:border-white/30"><span className="border-b border-r" /><span className="border-b border-r" /><span className="border-b" /><span className="border-b border-r" /><span className="border-b border-r" /><span className="border-b" /><span className="border-r" /><span className="border-r" /><span /></div>
          {loading && <div className="absolute inset-0 grid place-items-center bg-black/60"><LoaderCircle className="size-7 animate-spin text-violet-300" /></div>}
        </div>
        <label className="grid gap-2 text-xs font-medium text-slate-400">Масштаб
          <input aria-label="Масштаб изображения" type="range" min="1" max="3" step="0.01" value={crop.zoom} onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} className="h-2 w-full cursor-pointer accent-violet-500" />
        </label>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setCrop(DEFAULT_IMAGE_CROP)}><RotateCcw className="size-4" />Сбросить</Button>
          <p className="text-right text-xs text-slate-500">Перетаскивайте изображение внутри рамки</p>
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/[.06] px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="grid grid-cols-2 gap-2"><Button type="button" variant="secondary" disabled={applying} onClick={onCancel}>Отмена</Button><Button type="button" disabled={loading || applying || Boolean(error)} onClick={() => void apply()}>{applying ? <LoaderCircle className="size-4 animate-spin" /> : <Crop className="size-4" />}{applying ? "Сохраняем…" : "Применить"}</Button></div>
      </div>
    </DialogContent>
  </Dialog>;
}

function clamp(value: number): number { return Math.max(-1, Math.min(1, value)); }
