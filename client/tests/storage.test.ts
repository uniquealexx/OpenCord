// @vitest-environment node

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClientStateStore } from "../electron/storage";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore(): Promise<{ directory: string; store: ClientStateStore }> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-test-"));
  directories.push(directory);
  return { directory, store: new ClientStateStore(directory) };
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

  it("rejects unvalidated writes", async () => {
    const { store } = await makeStore();
    await expect(store.save({ version: 1 })).rejects.toThrow();
  });
});
