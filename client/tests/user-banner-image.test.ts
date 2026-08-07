import { afterEach, describe, expect, it, vi } from "vitest";
import { compressUserBanner } from "@/lib/user-banner-image";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("user banner compression", () => {
  it("center-crops a wide image to a 600 by 240 WebP", async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1_200, height: 800, close })));
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName !== "canvas") return originalCreateElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (callback: BlobCallback) => callback(new Blob(["small-banner"], { type: "image/webp" })),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    const result = await compressUserBanner(new File(["source"], "banner.png", { type: "image/png" }));

    expect(result).toMatch(/^data:image\/webp;base64,/u);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 160, 1_200, 480, 0, 0, 600, 240);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and excessively large source files", async () => {
    await expect(compressUserBanner(new File(["svg"], "banner.svg", { type: "image/svg+xml" }))).rejects.toThrow("PNG, JPEG и WebP");
    await expect(compressUserBanner({ type: "image/png", size: 21 * 1024 * 1024 } as Blob)).rejects.toThrow("меньше 20 МБ");
  });
});
