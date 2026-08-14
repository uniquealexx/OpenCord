import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageCropDialog } from "@/components/image-crop-dialog";
import { calculateCropRectangle, imageDataUrlToFile, validateCropSource } from "@/lib/image-crop";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("image crop", () => {
  it("calculates centered, zoomed and moved crop rectangles", () => {
    expect(calculateCropRectangle(1_200, 800, 1)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    expect(calculateCropRectangle(1_200, 800, 1, { zoom: 1, x: 1, y: 0 })).toEqual({ x: 400, y: 0, width: 800, height: 800 });
    expect(calculateCropRectangle(1_200, 800, 1, { zoom: 2, x: 0, y: 0 })).toEqual({ x: 400, y: 200, width: 400, height: 400 });
    expect(calculateCropRectangle(1_200, 800, 5 / 2)).toEqual({ x: 0, y: 160, width: 1_200, height: 480 });
  });

  it("rejects unsupported and oversized crop sources before decoding", () => {
    expect(() => validateCropSource(new File(["svg"], "image.svg", { type: "image/svg+xml" }))).toThrow("PNG, JPEG and WebP are supported");
    expect(() => validateCropSource({ type: "image/png", size: 21 * 1024 * 1024 } as Blob)).toThrow("under 20 MB");
  });

  it("converts an installed data URL back into a crop source", () => {
    const file = imageDataUrlToFile("data:image/webp;base64,QUJD", "current.webp");
    expect(file).toMatchObject({ name: "current.webp", type: "image/webp", size: 3 });
    expect(() => imageDataUrlToFile("https://example.test/avatar.webp", "current.webp")).toThrow("Could not read the saved image");
  });

  it("returns the selected zoom from the crop dialog", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1_200, height: 800, close })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
    const onApply = vi.fn(async () => undefined);
    render(<ImageCropDialog source={new File(["image"], "photo.png", { type: "image/png" })} title="Кадрирование" description="Настройте кадр" aspectRatio={1} rounded onCancel={vi.fn()} onApply={onApply} />);

    await waitFor(() => expect(drawImage).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("slider", { name: "Масштаб изображения" }), { target: { value: "1.75" } });
    await user.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1.75, x: 0, y: 0 }));
    await act(async () => undefined);
    expect(close).not.toHaveBeenCalled();
  });
});
