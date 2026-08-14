import { USER_AVATAR_MAX_BYTES, userAvatarSchema } from "@opencord/shared";
import { calculateCropRectangle, type ImageCrop } from "@/lib/image-crop";
import { currentDictionary } from "@/lib/i18n";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const OUTPUT_SIZES = [128, 96, 64] as const;
const OUTPUT_QUALITIES = [0.82, 0.68, 0.52] as const;

export async function compressUserAvatar(source: Blob, crop?: ImageCrop): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(source.type)) throw new Error(currentDictionary().imageErrors.unsupportedType);
  if (source.size > MAX_SOURCE_BYTES) throw new Error(currentDictionary().imageErrors.tooLargeSource);
  const bitmap = await createImageBitmap(source);
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
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= USER_AVATAR_MAX_BYTES) return userAvatarSchema.parse(await blobDataUrl(blob))!;
      }
    }
    throw new Error(currentDictionary().imageErrors.avatarCompressFailed);
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(currentDictionary().imageErrors.blobFailed)), "image/webp", quality));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(currentDictionary().imageErrors.avatarReadFailed));
    reader.onerror = () => reject(new Error(currentDictionary().imageErrors.avatarReadFailed));
    reader.readAsDataURL(blob);
  });
}
