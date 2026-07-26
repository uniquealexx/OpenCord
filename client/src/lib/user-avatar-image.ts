import { USER_AVATAR_MAX_BYTES, userAvatarSchema } from "@opencord/shared";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const OUTPUT_SIZES = [128, 96, 64] as const;
const OUTPUT_QUALITIES = [0.82, 0.68, 0.52] as const;

export async function compressUserAvatar(source: Blob): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(source.type)) throw new Error("Поддерживаются PNG, JPEG и WebP");
  if (source.size > MAX_SOURCE_BYTES) throw new Error("Исходное изображение должно быть меньше 20 МБ");
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 16_384 || bitmap.height > 16_384) throw new Error("Слишком большое разрешение изображения");
    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - cropSize) / 2;
    const sourceY = (bitmap.height - cropSize) / 2;
    for (const size of OUTPUT_SIZES) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось подготовить изображение");
      context.drawImage(bitmap, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size);
      for (const quality of OUTPUT_QUALITIES) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= USER_AVATAR_MAX_BYTES) return userAvatarSchema.parse(await blobDataUrl(blob))!;
      }
    }
    throw new Error("Не удалось сжать аватар до 96 КБ");
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
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось прочитать сжатый аватар"));
    reader.onerror = () => reject(new Error("Не удалось прочитать сжатый аватар"));
    reader.readAsDataURL(blob);
  });
}
