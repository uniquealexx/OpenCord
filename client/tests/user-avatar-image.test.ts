import { afterEach, describe, expect, it, vi } from "vitest";
import { compressUserAvatar } from "@/lib/user-avatar-image";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("user avatar compression", () => {
  it("center-crops a large image to a 128px WebP", async () => {
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
        toBlob: (callback: BlobCallback) => callback(new Blob(["small-avatar"], { type: "image/webp" })),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    const result = await compressUserAvatar(new File(["source"], "portrait.png", { type: "image/png" }));

    expect(result).toMatch(/^data:image\/webp;base64,/u);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 128, 128);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and excessively large source files", async () => {
    await expect(compressUserAvatar(new File(["svg"], "avatar.svg", { type: "image/svg+xml" }))).rejects.toThrow("PNG, JPEG и WebP");
    await expect(compressUserAvatar({ type: "image/png", size: 21 * 1024 * 1024 } as Blob)).rejects.toThrow("меньше 20 МБ");
  });
});
