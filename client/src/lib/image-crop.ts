import { currentDictionary } from "@/lib/i18n";

export interface ImageCrop {
  zoom: number;
  x: number;
  y: number;
}

export interface CropRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_IMAGE_CROP: ImageCrop = { zoom: 1, x: 0, y: 0 };
export const MAX_CROP_SOURCE_BYTES = 20 * 1024 * 1024;

export function validateCropSource(source: Blob): void {
  if (!["image/png", "image/jpeg", "image/webp"].includes(source.type)) throw new Error(currentDictionary().imageErrors.unsupportedType);
  if (source.size > MAX_CROP_SOURCE_BYTES) throw new Error(currentDictionary().imageErrors.tooLargeSource);
}

export function imageDataUrlToFile(dataUrl: string, fileName: string): File {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/u.exec(dataUrl);
  if (!match) throw new Error(currentDictionary().imageErrors.readFailed);
  const decoded = atob(match[2]!);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new File([bytes], fileName, { type: match[1] });
}

export function calculateCropRectangle(imageWidth: number, imageHeight: number, aspectRatio: number, crop: ImageCrop = DEFAULT_IMAGE_CROP): CropRectangle {
  const boundedZoom = Math.max(1, Math.min(3, crop.zoom));
  const imageRatio = imageWidth / imageHeight;
  const baseWidth = imageRatio > aspectRatio ? imageHeight * aspectRatio : imageWidth;
  const baseHeight = imageRatio > aspectRatio ? imageHeight : imageWidth / aspectRatio;
  const width = baseWidth / boundedZoom;
  const height = baseHeight / boundedZoom;
  const availableX = Math.max(0, imageWidth - width);
  const availableY = Math.max(0, imageHeight - height);
  const normalizedX = Math.max(-1, Math.min(1, crop.x));
  const normalizedY = Math.max(-1, Math.min(1, crop.y));
  return {
    x: availableX * (normalizedX + 1) / 2,
    y: availableY * (normalizedY + 1) / 2,
    width,
    height,
  };
}
