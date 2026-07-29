import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { releaseManifestSchema } from "@opencord/shared";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe("release manifest generator", () => {
  it("hashes the actual server bundle and emits a valid development manifest", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-manifest-"));
    temporaryDirectories.push(directory);
    const bundlePath = path.join(directory, "opencord-server-0.1.0-beta.1.tar.gz");
    const outputPath = path.join(directory, "release-manifest.json");
    const contents = Buffer.from("verified OpenCord bundle");
    await writeFile(bundlePath, contents);

    const generated = spawnSync(process.execPath, ["scripts/release-manifest.mjs", "--server-bundle", bundlePath, "--channel", "development", "--output", outputPath], { cwd: repositoryRoot, encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);
    const manifest = releaseManifestSchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
    expect(manifest).toMatchObject({ releaseChannel: "development", commit: null, publishedAt: null, releaseUrl: null, artifacts: { serverBundle: { sizeBytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex"), downloadUrl: null } } });

    const validated = spawnSync(process.execPath, ["scripts/release-manifest.mjs", "--validate", outputPath], { cwd: repositoryRoot, encoding: "utf8" });
    expect(validated.status, validated.stderr).toBe(0);
    expect(validated.stdout).toContain("Valid OpenCord development manifest");
  });

  it("enforces clean Git state, commit shape and an exact version tag for stable releases", () => {
    const moduleUrl = pathToFileURL(path.join(repositoryRoot, "scripts", "release-manifest.mjs")).href;
    const verification = `
      import { validateStableGitMetadata } from ${JSON.stringify(moduleUrl)};
      const valid = validateStableGitMetadata({ version: "1.2.3", status: "", commit: "a".repeat(40), tags: ["v1.2.3"], now: new Date("2026-07-29T12:00:00.000Z") });
      if (valid.releaseUrl !== "https://github.com/uniquealexx/OpenCord/releases/tag/v1.2.3") process.exit(1);
      for (const input of [
        { version: "1.2.3", status: " M package.json", commit: "a".repeat(40), tags: ["v1.2.3"] },
        { version: "1.2.3", status: "", commit: "bad", tags: ["v1.2.3"] },
        { version: "1.2.3", status: "", commit: "a".repeat(40), tags: ["v1.2.2"] },
      ]) {
        let rejected = false;
        try { validateStableGitMetadata(input); } catch { rejected = true; }
        if (!rejected) process.exit(2);
      }
    `;
    const checked = spawnSync(process.execPath, ["--input-type=module", "--eval", verification], { cwd: repositoryRoot, encoding: "utf8" });
    expect(checked.status, checked.stderr).toBe(0);
  });
});
