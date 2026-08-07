import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareAttachmentPreviewDirectory, previewAttachment } from "../electron/attachments";

describe("Electron attachment previews", () => {
  it("caches and reuses videos larger than 10 MB without converting them to base64", async () => {
    const contents = Buffer.alloc(10 * 1024 * 1024 + 1, 0x5a);
    const attachment = {
      id: randomUUID(),
      fileName: "large-video.mp4",
      mimeType: "video/mp4",
      sizeBytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
    let requests = 0;
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      requests += 1;
      authorization = request.headers.authorization;
      response.writeHead(200, { "content-type": attachment.mimeType, "content-length": String(contents.length), connection: "close" });
      response.end(contents);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    const temporaryParent = await mkdtemp(path.join(tmpdir(), "opencord-preview-test-"));

    try {
      const previewDirectory = await prepareAttachmentPreviewDirectory(temporaryParent);
      const first = await previewAttachment(`http://127.0.0.1:${address.port}`, "A".repeat(43), attachment, previewDirectory);
      const second = await previewAttachment(`http://127.0.0.1:${address.port}`, "A".repeat(43), attachment, previewDirectory);

      expect(new URL(first).protocol).toBe("file:");
      expect(second).toBe(first);
      expect(requests).toBe(1);
      expect(authorization).toBe(`Bearer ${"A".repeat(43)}`);
      const cached = await readFile(fileURLToPath(first));
      expect(cached.length).toBe(contents.length);
      expect(createHash("sha256").update(cached).digest("hex")).toBe(attachment.sha256);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(temporaryParent, { recursive: true, force: true });
    }
  }, 60_000);
});
