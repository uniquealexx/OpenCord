import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { c } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { validateLocalServerBundle } from "../electron/server-bundle";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local server bundle provider", () => {
  it("validates both the outer bundle and embedded runtime hashes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-client-bundle-test-"));
    temporaryDirectories.push(directory);
    const runtimeName = "server-runtime-linux-x64.tar.gz";
    const runtime = Buffer.from("runtime fixture");
    await writeFile(path.join(directory, runtimeName), runtime);
    await writeFile(path.join(directory, "bundle-info.json"), JSON.stringify({
      formatVersion: 1,
      product: "opencord-server",
      version: "0.1.0",
      releaseChannel: "development",
      commit: null,
      protocolVersion: 13,
      target: { os: "linux", arch: "x64" },
      runtime: { fileName: runtimeName, sha256: createHash("sha256").update(runtime).digest("hex"), sizeBytes: runtime.length },
    }));
    const archive = path.join(directory, "opencord-server-0.1.0.tar.gz");
    await c({ cwd: directory, gzip: true, file: archive }, ["bundle-info.json", runtimeName]);
    const archiveBytes = await readFile(archive);
    await writeFile(`${archive}.sha256`, `${createHash("sha256").update(archiveBytes).digest("hex")}  ${path.basename(archive)}\n`);

    const resolved = await validateLocalServerBundle(archive);
    expect(resolved.info.target).toEqual({ os: "linux", arch: "x64" });
    expect(resolved.info.runtime.sizeBytes).toBe(runtime.length);
  });

  it("rejects a bundle whose external checksum was changed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-client-bundle-test-"));
    temporaryDirectories.push(directory);
    const archive = path.join(directory, "broken.tar.gz");
    await writeFile(archive, "broken");
    await writeFile(`${archive}.sha256`, `${"a".repeat(64)}  broken.tar.gz\n`);
    await expect(validateLocalServerBundle(archive)).rejects.toThrow("SHA-256");
  });
});
