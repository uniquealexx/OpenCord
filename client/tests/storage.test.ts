// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultState } from "../src/shared/state";
import { ClientStateStore } from "../electron/storage";
import type { StateCipher } from "../electron/state-cipher";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore(): Promise<{ directory: string; store: ClientStateStore }> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-test-"));
  directories.push(directory);
  return { directory, store: new ClientStateStore(directory) };
}

/** Подмена safeStorage: XOR не защищает, но полностью повторяет контракт шифра. */
function makeFakeCipher(available = true): StateCipher {
  const scramble = (input: Buffer): Buffer => Buffer.from(input.map((byte) => byte ^ 0x5a));
  return {
    isAvailable: () => available,
    encrypt: (plainText) => scramble(Buffer.from(plainText, "utf8")),
    decrypt: (payload) => scramble(Buffer.from(payload)).toString("utf8"),
  };
}

async function makeEncryptedStore(available = true): Promise<{ directory: string; store: ClientStateStore }> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-test-"));
  directories.push(directory);
  return { directory, store: new ClientStateStore(directory, makeFakeCipher(available)) };
}

describe("ClientStateStore", () => {
  it("persists state between store instances", async () => {
    const { directory, store } = await makeStore();
    const initial = await store.load();
    const updated = { ...initial, onboardingComplete: true };
    await store.save(updated);
    await expect(new ClientStateStore(directory).load()).resolves.toEqual(updated);
  });

  it("backs up corrupt JSON and replaces it with defaults", async () => {
    const { directory, store } = await makeStore();
    await writeFile(store.filePath, "{definitely-not-json", "utf8");
    const recovered = await store.load();
    const files = await readdir(directory);
    expect(recovered.onboardingComplete).toBe(false);
    expect(files.some((file) => file.startsWith("client-state.corrupt-"))).toBe(true);
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(recovered);
  });

  it("migrates legacy state without treating it as corrupt", async () => {
    const { directory, store } = await makeStore();
    const legacy = {
      version: 1,
      onboardingComplete: true,
      profile: null,
      servers: [{ id: "open-space", name: "Открытое пространство", address: null, accent: "#7c5cff", channels: [], members: [] }],
      messages: [],
      activeServerId: "open-space",
      activeChannelId: null,
      preferences: { compactMode: false, showMemberList: true, notifications: true },
    };
    await writeFile(store.filePath, JSON.stringify(legacy), "utf8");
    const migrated = await store.load();
    expect(migrated).toMatchObject({ version: 4, servers: [], activeServerId: null });
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(migrated);
    expect((await readdir(directory)).some((file) => file.startsWith("client-state.corrupt-"))).toBe(false);
  });

  it("rejects unvalidated writes", async () => {
    const { store } = await makeStore();
    await expect(store.save({ version: 1 })).rejects.toThrow();
  });

  it("keeps cached private messages off the disk in clear text", async () => {
    const { directory, store } = await makeEncryptedStore();
    const initial = await store.load();
    const state = {
      ...initial,
      onboardingComplete: true,
      messages: [{ id: "11111111-1111-4111-8111-111111111111", channelId: "c", authorId: "a", authorName: "lina", authorColor: "#7c5cff", content: "секрет из личной переписки", createdAt: new Date().toISOString(), kind: "pm" as const }],
    };
    await store.save(state);

    const onDisk = await readFile(store.filePath, "utf8");
    expect(onDisk).not.toContain("секрет из личной переписки");
    expect(JSON.parse(onDisk)).toMatchObject({ format: "opencord-encrypted-state@1" });
    // Расшифровка возвращает ровно то, что сохранили.
    await expect(new ClientStateStore(directory, makeFakeCipher()).load()).resolves.toEqual(state);
  });

  it("re-encrypts a plaintext state left by an older version", async () => {
    const { directory, store } = await makeEncryptedStore();
    const legacy = { ...createDefaultState(), onboardingComplete: true };
    await writeFile(store.filePath, JSON.stringify(legacy), "utf8");

    const loaded = await store.load();
    expect(loaded).toEqual(legacy);
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toMatchObject({ format: "opencord-encrypted-state@1" });
    await expect(new ClientStateStore(directory, makeFakeCipher()).load()).resolves.toEqual(legacy);
  });

  it("resets when the encrypted state cannot be decrypted", async () => {
    const { directory, store } = await makeEncryptedStore();
    await store.save({ ...createDefaultState(), onboardingComplete: true });

    // Другой ключ ОС — например, состояние перенесли к другому пользователю.
    const foreign = new ClientStateStore(directory, {
      isAvailable: () => true,
      encrypt: (plainText) => Buffer.from(plainText, "utf8"),
      decrypt: () => { throw new Error("Не удалось расшифровать"); },
    });
    const recovered = await foreign.load();
    expect(recovered.onboardingComplete).toBe(false);
    expect((await readdir(directory)).some((file) => file.startsWith("client-state.corrupt-"))).toBe(true);
  });

  it("still persists state when the OS key store is unavailable", async () => {
    const { directory, store } = await makeEncryptedStore(false);
    const state = { ...createDefaultState(), onboardingComplete: true };
    await store.save(state);
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toEqual(state);
    await expect(new ClientStateStore(directory, makeFakeCipher(false)).load()).resolves.toEqual(state);
  });

  it("serializes concurrent writes and preserves the latest state", async () => {
    const { directory, store } = await makeStore();
    const initial = await store.load();
    const first = { ...initial, preferences: { ...initial.preferences, compactMode: false } };
    const latest = { ...initial, preferences: { ...initial.preferences, compactMode: true } };

    await Promise.all([store.save(first), store.save(latest)]);

    await expect(new ClientStateStore(directory).load()).resolves.toEqual(latest);
    expect((await readdir(directory)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });
});
