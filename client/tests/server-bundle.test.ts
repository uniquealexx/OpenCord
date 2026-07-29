import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { c } from "tar";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubReleaseBundleProvider, githubReleaseManifestUrl, validateLocalServerBundle } from "../electron/server-bundle";

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

  it("downloads and validates a matching bundle from a canonical GitHub release", async () => {
    const fixture = await createPublishedBundleFixture();
    const manifestUrl = githubReleaseManifestUrl(fixture.version);
    const fetcher = vi.fn(async (url: string) => {
      if (url === manifestUrl) return new Response(JSON.stringify(fixture.manifest), { status: 200 });
      if (url === fixture.downloadUrl) return new Response(new Uint8Array(fixture.archiveBytes), { status: 200, headers: { "content-length": String(fixture.archiveBytes.length) } });
      return new Response("not found", { status: 404 });
    });
    const provider = new GitHubReleaseBundleProvider(manifestUrl, fixture.version, fixture.directory, fetcher);

    const resolved = await provider.resolve();
    expect(resolved.source).toBe("github-release");
    expect(resolved.info).toMatchObject({ version: fixture.version, releaseChannel: "beta", commit: fixture.commit });
    expect(resolved.sha256).toBe(fixture.archiveSha256);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await provider.dispose();
  });

  it("rejects tampered downloads and non-canonical artifact URLs", async () => {
    const fixture = await createPublishedBundleFixture();
    const manifestUrl = githubReleaseManifestUrl(fixture.version);
    const tamperedFetcher = vi.fn(async (url: string) => url === manifestUrl
      ? new Response(JSON.stringify(fixture.manifest), { status: 200 })
      : new Response(new Uint8Array(Buffer.from("tampered")), { status: 200 }));
    const tampered = new GitHubReleaseBundleProvider(manifestUrl, fixture.version, fixture.directory, tamperedFetcher);
    await expect(tampered.resolve()).rejects.toThrow(/размер|повреждён/u);

    const untrustedManifest = { ...fixture.manifest, artifacts: { ...fixture.manifest.artifacts, serverBundle: { ...fixture.manifest.artifacts.serverBundle, downloadUrl: "https://example.com/server.tar.gz" } } };
    const untrustedFetcher = vi.fn(async () => new Response(JSON.stringify(untrustedManifest), { status: 200 }));
    const untrusted = new GitHubReleaseBundleProvider(manifestUrl, fixture.version, fixture.directory, untrustedFetcher);
    await expect(untrusted.resolve()).rejects.toThrow("недоверенную ссылку");
  });
});

async function createPublishedBundleFixture(): Promise<{
  directory: string;
  version: string;
  commit: string;
  downloadUrl: string;
  archiveBytes: Buffer;
  archiveSha256: string;
  manifest: Record<string, unknown> & { artifacts: { serverBundle: Record<string, unknown>; serverImage: null; windowsClient: null } };
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencord-client-release-test-"));
  temporaryDirectories.push(directory);
  const version = "0.1.0-beta.1";
  const commit = "a".repeat(40);
  const runtimeName = "server-runtime-linux-x64.tar.gz";
  const runtime = Buffer.from("published runtime fixture");
  await writeFile(path.join(directory, runtimeName), runtime);
  await writeFile(path.join(directory, "bundle-info.json"), JSON.stringify({
    formatVersion: 1,
    product: "opencord-server",
    version,
    releaseChannel: "beta",
    commit,
    protocolVersion: PROTOCOL_VERSION,
    target: { os: "linux", arch: "x64" },
    runtime: { fileName: runtimeName, sha256: createHash("sha256").update(runtime).digest("hex"), sizeBytes: runtime.length },
  }));
  const fileName = `opencord-server-${version}.tar.gz`;
  const archive = path.join(directory, fileName);
  await c({ cwd: directory, gzip: true, file: archive }, ["bundle-info.json", runtimeName]);
  const archiveBytes = await readFile(archive);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const downloadUrl = `https://github.com/uniquealexx/OpenCord/releases/download/v${version}/${fileName}`;
  const manifest = {
    schemaVersion: 1,
    product: "opencord",
    releaseChannel: "beta",
    version,
    protocolVersion: PROTOCOL_VERSION,
    commit,
    publishedAt: "2026-07-29T12:00:00.000Z",
    releaseUrl: `https://github.com/uniquealexx/OpenCord/releases/tag/v${version}`,
    artifacts: {
      serverBundle: {
        bundleFormatVersion: 1,
        fileName,
        downloadUrl,
        sha256: archiveSha256,
        sizeBytes: archiveBytes.length,
        target: { os: "linux", arch: "x64" },
        installModes: ["docker", "native"],
      },
      serverImage: null,
      windowsClient: null,
    },
  };
  return { directory, version, commit, downloadUrl, archiveBytes, archiveSha256, manifest };
}
