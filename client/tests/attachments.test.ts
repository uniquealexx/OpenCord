import { describe, expect, it } from "vitest";
import { attachmentPreviewResultSchema } from "@/shared/attachments";

describe("attachment preview validation", () => {
  it.each([
    "data:image/png;base64,AA==",
    "data:image/jpeg;base64,AA==",
    "data:video/mp4;base64,AA==",
    "data:video/webm;base64,AA==",
    "data:video/ogg;base64,AA==",
  ])("accepts supported media data URLs", (value) => {
    expect(attachmentPreviewResultSchema.parse(value)).toBe(value);
  });

  it("rejects executable or unrelated data URLs", () => {
    expect(() => attachmentPreviewResultSchema.parse("data:text/html;base64,AA==")).toThrow();
  });

  it("accepts a local cached-video URL but rejects remote media URLs", () => {
    expect(attachmentPreviewResultSchema.parse("file:///C:/Temp/opencord-media-previews/video.mp4")).toBe("file:///C:/Temp/opencord-media-previews/video.mp4");
    expect(() => attachmentPreviewResultSchema.parse("https://example.com/video.mp4")).toThrow();
  });
});
