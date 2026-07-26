import { afterEach, describe, expect, it, vi } from "vitest";
import { compressServerAvatar } from "@/lib/server-avatar-image";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server avatar compression", () => {
  it("center-crops and converts an image to a small WebP", async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close })));
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName !== "canvas") return originalCreateElement(tagName);
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toBlob: (callback: BlobCallback) => callback(new Blob(["tiny"], { type: "image/webp" })),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    const result = await compressServerAvatar(new File(["source"], "avatar.png", { type: "image/png" }));

    expect(result).toMatch(/^data:image\/webp;base64,/u);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 0, 600, 600, 0, 0, 256, 256);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and unreasonably large source files", async () => {
    await expect(compressServerAvatar(new File(["text"], "avatar.svg", { type: "image/svg+xml" }))).rejects.toThrow("PNG, JPEG и WebP");
    await expect(compressServerAvatar({ type: "image/png", size: 21 * 1024 * 1024 } as File)).rejects.toThrow("меньше 20 МБ");
  });
});
