import { serverAvatarSchema } from "@opencord/shared";
import { calculateCropRectangle, type ImageCrop } from "@/lib/image-crop";
import { currentDictionary } from "@/lib/i18n";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_000_000;
const OUTPUT_SIZES = [256, 192, 128] as const;
const OUTPUT_QUALITIES = [0.86, 0.72, 0.56] as const;

export async function compressServerAvatar(file: File, crop?: ImageCrop): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(currentDictionary().imageErrors.unsupportedType);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(currentDictionary().imageErrors.tooLargeSource);
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16_384 || bitmap.height > 16_384) throw new Error(currentDictionary().imageErrors.resolutionTooLarge);
    const rectangle = calculateCropRectangle(bitmap.width, bitmap.height, 1, crop);
    for (const size of OUTPUT_SIZES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(currentDictionary().imageErrors.prepareFailed);
      context.drawImage(bitmap, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0, size, size);
      for (const quality of OUTPUT_QUALITIES) {
        const blob = await canvasBlob(canvas, "image/webp", quality);
        if (blob.size > MAX_OUTPUT_BYTES) continue;
        return serverAvatarSchema.parse(await blobDataUrl(blob))!;
      }
    }
    throw new Error(currentDictionary().imageErrors.serverCompressFailed);
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(currentDictionary().imageErrors.blobFailed)), type, quality));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(currentDictionary().imageErrors.imageReadFailed));
    reader.onerror = () => reject(new Error(currentDictionary().imageErrors.imageReadFailed));
    reader.readAsDataURL(blob);
  });
}
