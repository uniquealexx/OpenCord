import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_RATE_BYTES_PER_SECOND, AttachmentTransferScheduler, HEAVY_ATTACHMENT_BYTES, VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND, activeAttachmentTransferRate, attachmentTransferRate, prepareAttachmentPreviewDirectory, previewAttachment, setAttachmentLatencySensitive, uploadAttachment } from "../electron/attachments";

describe("Electron attachment previews", () => {
  it("limits and serializes heavy transfers while leaving small files alone", async () => {
    expect(attachmentTransferRate(HEAVY_ATTACHMENT_BYTES - 1, true)).toBeNull();
    expect(attachmentTransferRate(HEAVY_ATTACHMENT_BYTES, false)).toBe(ATTACHMENT_RATE_BYTES_PER_SECOND);
    expect(attachmentTransferRate(HEAVY_ATTACHMENT_BYTES, true)).toBe(VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND);

    const scheduler = new AttachmentTransferScheduler();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = scheduler.run(HEAVY_ATTACHMENT_BYTES, true, async (rate) => { events.push(`first:${rate}`); await firstGate; events.push("first:done"); });
    const secondTransfer = vi.fn(async (rate: number | null) => { events.push(`second:${rate}`); });
    const second = scheduler.run(HEAVY_ATTACHMENT_BYTES, false, secondTransfer);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([`first:${VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND}`]);
    expect(secondTransfer).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([`first:${VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND}`, "first:done", `second:${ATTACHMENT_RATE_BYTES_PER_SECOND}`]);
  });

  it("slows an active heavy transfer when voice becomes latency-sensitive", () => {
    setAttachmentLatencySensitive(false);
    expect(activeAttachmentTransferRate()).toBe(ATTACHMENT_RATE_BYTES_PER_SECOND);
    setAttachmentLatencySensitive(true);
    expect(activeAttachmentTransferRate()).toBe(VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND);
    expect(activeAttachmentTransferRate(true)).toBe(VOICE_ATTACHMENT_RATE_BYTES_PER_SECOND);
    setAttachmentLatencySensitive(false);
  });

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

  it("caches audio previews as local files instead of rejecting them", async () => {
    const contents = Buffer.alloc(1_024 * 1_024, 0x41);
    const attachment = {
      id: randomUUID(),
      fileName: "voice-message-20260101-120000.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": attachment.mimeType, "content-length": String(contents.length), connection: "close" });
      response.end(contents);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    const temporaryParent = await mkdtemp(path.join(tmpdir(), "opencord-audio-test-"));

    try {
      const previewDirectory = await prepareAttachmentPreviewDirectory(temporaryParent);
      const first = await previewAttachment(`http://127.0.0.1:${address.port}`, "A".repeat(43), attachment, previewDirectory);
      const second = await previewAttachment(`http://127.0.0.1:${address.port}`, "A".repeat(43), attachment, previewDirectory);

      expect(new URL(first).protocol).toBe("file:");
      expect(first.endsWith(".mp3")).toBe(true);
      expect(second).toBe(first);
      expect(requests).toBe(1);
      const cached = await readFile(fileURLToPath(first));
      expect(createHash("sha256").update(cached).digest("hex")).toBe(attachment.sha256);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(temporaryParent, { recursive: true, force: true });
    }
  }, 60_000);

  it("prefers the explicit mime type over the file extension when uploading bytes", async () => {
    const contents = Buffer.alloc(4_096, 0x7);
    let receivedMime: string | undefined;
    let receivedName: string | undefined;
    const server = createServer((request, response) => {
      const mimeHeader = request.headers["x-opencord-mime-type"];
      const nameHeader = request.headers["x-opencord-file-name"];
      receivedMime = Array.isArray(mimeHeader) ? mimeHeader[0] : mimeHeader;
      receivedName = Array.isArray(nameHeader) ? nameHeader[0] : nameHeader;
      // Сервер обязан дочитать тело загрузки до ответа, иначе клиент
      // получает Premature close (стабильно воспроизводится на Linux CI).
      request.resume();
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify({ id: randomUUID(), fileName: "voice-message.opus", mimeType: receivedMime, sizeBytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    const temporaryParent = await mkdtemp(path.join(tmpdir(), "opencord-upload-test-"));

    try {
      const filePath = path.join(temporaryParent, "voice-message-20260101-120000.tmp");
      await writeFile(filePath, contents);
      await uploadAttachment(filePath, `http://127.0.0.1:${address.port}`, "A".repeat(43), null, { mimeType: "audio/webm", fileName: "voice-message-20260101-120000.webm" });
      expect(receivedMime).toBe("audio/webm");
      expect(typeof receivedName).toBe("string");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(temporaryParent, { recursive: true, force: true });
    }
  }, 60_000);

  it("strips MediaRecorder codec parameters from the uploaded mime type", async () => {
    const contents = Buffer.alloc(2_048, 0x9);
    let receivedMime: string | undefined;
    const server = createServer((request, response) => {
      const mimeHeader = request.headers["x-opencord-mime-type"];
      receivedMime = Array.isArray(mimeHeader) ? mimeHeader[0] : mimeHeader;
      // Тело загрузки дочитывается до ответа — иначе Premature close на Linux CI.
      request.resume();
      request.on("end", () => {
        response.writeHead(201, { "content-type": "application/json", connection: "close" });
        response.end(JSON.stringify({ id: randomUUID(), fileName: "voice-message.webm", mimeType: receivedMime, sizeBytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected server address");
    const temporaryParent = await mkdtemp(path.join(tmpdir(), "opencord-codecs-test-"));

    try {
      const filePath = path.join(temporaryParent, "voice-message-20260101-120000.webm");
      await writeFile(filePath, contents);
      await uploadAttachment(filePath, `http://127.0.0.1:${address.port}`, "A".repeat(43), null, { mimeType: "audio/webm;codecs=opus", fileName: "voice-message-20260101-120000.webm" });
      expect(receivedMime).toBe("audio/webm");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(temporaryParent, { recursive: true, force: true });
    }
  }, 60_000);
});
