import { USER_BANNER_MAX_BYTES, userBannerSchema } from "@opencord/shared";
import { calculateCropRectangle, type ImageCrop } from "@/lib/image-crop";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const ASPECT_RATIO = 5 / 2;
const OUTPUT_WIDTHS = [600, 480, 360] as const;
const OUTPUT_QUALITIES = [0.82, 0.68, 0.52] as const;

export async function compressUserBanner(source: Blob, crop?: ImageCrop): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(source.type)) throw new Error("Поддерживаются PNG, JPEG и WebP");
  if (source.size > MAX_SOURCE_BYTES) throw new Error("Исходное изображение должно быть меньше 20 МБ");
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16_384 || bitmap.height > 16_384) throw new Error("Слишком большое разрешение изображения");
    const rectangle = calculateCropRectangle(bitmap.width, bitmap.height, ASPECT_RATIO, crop);
    for (const width of OUTPUT_WIDTHS) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(width / ASPECT_RATIO);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось подготовить изображение");
      context.drawImage(bitmap, rectangle.x, rectangle.y, rectangle.width, rectangle.height, 0, 0, canvas.width, canvas.height);
      for (const quality of OUTPUT_QUALITIES) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= USER_BANNER_MAX_BYTES) return userBannerSchema.parse(await blobDataUrl(blob))!;
      }
    }
    throw new Error("Не удалось сжать шапку профиля до 256 КБ");
  } finally {
    bitmap.close();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось сжать изображение")), "image/webp", quality));
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать сжатую шапку"));
    reader.onerror = () => reject(new Error("Не удалось прочитать сжатую шапку"));
    reader.readAsDataURL(blob);
  });
}
