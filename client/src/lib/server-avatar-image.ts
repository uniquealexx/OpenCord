import { serverAvatarSchema } from "@opencord/shared";
import { calculateCropRectangle, type ImageCrop } from "@/lib/image-crop";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_000_000;
const OUTPUT_SIZES = [256, 192, 128] as const;
const OUTPUT_QUALITIES = [0.86, 0.72, 0.56] as const;

export async function compressServerAvatar(file: File, crop?: ImageCrop): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Поддерживаются PNG, JPEG и WebP");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Исходное изображение должно быть меньше 20 МБ");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16_384 || bitmap.height > 16_384) throw new Error("Слишком большое разрешение изображения");
    const rectangle = calculateCropRectangle(bitmap.width, bitmap.height, 1, crop);
    for (const size of OUTPUT_SIZES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось подготовить изображение");
      context.drawImage(bitmap, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0, size, size);
      for (const quality of OUTPUT_QUALITIES) {
        const blob = await canvasBlob(canvas, "image/webp", quality);
        if (blob.size > MAX_OUTPUT_BYTES) continue;
        return serverAvatarSchema.parse(await blobDataUrl(blob))!;
      }
    }
    throw new Error("Не удалось сжать изображение до 1 МБ");
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось сжать изображение")), type, quality));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать сжатое изображение"));
    reader.onerror = () => reject(new Error("Не удалось прочитать сжатое изображение"));
    reader.readAsDataURL(blob);
  });
}
