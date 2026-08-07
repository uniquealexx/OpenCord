import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { AttachmentSizeError, FileSystemAttachmentStorage } from "../src/attachments/storage";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("filesystem attachment storage", () => {
  it("writes exact bytes and computes SHA-256", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-storage-"));
    directories.push(directory);
    const storage = new FileSystemAttachmentStorage(directory);
    const contents = Buffer.from("attachment");
    const key = crypto.randomUUID();
    const stored = await storage.store(key, Readable.from(contents), contents.length, 10 * 1024 * 1024);
    expect(stored).toMatchObject({ storageKey: key, sizeBytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") });
    expect(await readFile(path.join(directory, key))).toEqual(contents);
  });

  it("rejects an oversized declared upload before writing", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-storage-"));
    directories.push(directory);
    const storage = new FileSystemAttachmentStorage(directory);
    await expect(storage.store(crypto.randomUUID(), Readable.from("x"), 11, 10)).rejects.toBeInstanceOf(AttachmentSizeError);
  });

  it("accepts uploads without a configured limit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-storage-"));
    directories.push(directory);
    const storage = new FileSystemAttachmentStorage(directory);
    const contents = Buffer.alloc(32, 7);
    const stored = await storage.store(crypto.randomUUID(), Readable.from(contents), contents.length, null);
    expect(stored.sizeBytes).toBe(contents.length);
  });
});
