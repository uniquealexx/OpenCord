import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface StoredAttachmentObject {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

export interface AttachmentStorage {
  store(storageKey: string, input: Readable, expectedSize: number): Promise<StoredAttachmentObject>;
  open(storageKey: string): Readable;
  remove(storageKey: string): Promise<void>;
}

export class FileSystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly root: string) {}

  async store(storageKey: string, input: Readable, expectedSize: number): Promise<StoredAttachmentObject> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_BYTES) throw new AttachmentSizeError();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.resolve(storageKey);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > MAX_ATTACHMENT_BYTES) { callback(new AttachmentSizeError()); return; }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(input, meter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      if (sizeBytes !== expectedSize) throw new Error("Attachment size does not match Content-Length");
      await rename(temporary, target);
      return { storageKey, sizeBytes, sha256: hash.digest("hex") };
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  open(storageKey: string): Readable {
    return createReadStream(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  private resolve(storageKey: string): string {
    if (!/^[0-9a-f-]{36}$/iu.test(storageKey)) throw new Error("Invalid attachment storage key");
    return path.join(this.root, storageKey);
  }
}

export class AttachmentSizeError extends Error {
  readonly statusCode = 413;
  constructor() { super("Размер файла превышает 10 МБ"); }
}
