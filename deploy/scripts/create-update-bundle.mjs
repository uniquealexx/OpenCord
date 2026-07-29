import { createHash } from "node:crypto";
import { createReadStream, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, serverBundleInfoSchema } from "../../shared/dist/index.js";
import { createReleaseManifest, validateReleaseContext } from "../../scripts/release-manifest.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseDirectory = path.join(repositoryRoot, "release");
const runtimeName = "server-runtime-linux-x64.tar.gz";
const releaseChannel = argumentValue("--channel") ?? "development";
if (!["development", "beta", "stable"].includes(releaseChannel)) throw new Error("--channel must be development, beta, or stable");
const serverImageReference = argumentValue("--server-image-reference");
const serverImageDigest = argumentValue("--server-image-digest");
if (Boolean(serverImageReference) !== Boolean(serverImageDigest)) throw new Error("--server-image-reference and --server-image-digest must be provided together");

const { version, releaseMetadata } = validateReleaseContext(releaseChannel);
const archiveName = `opencord-server-${version}.tar.gz`;
const archivePath = path.join(releaseDirectory, archiveName);
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "opencord-bundle-"));
const dockerOutput = path.join(temporaryRoot, "docker-output");
const stagingRoot = path.join(temporaryRoot, "bundle");

try {
  mkdirSync(dockerOutput, { recursive: true });
  run("docker", ["info"], "Docker is required to build the Linux x64 OpenCord runtime. Start Docker Desktop and retry.");
  run("docker", [
    "buildx", "build", "--platform", "linux/amd64", "--file", "deploy/Dockerfile.bundle", "--target", "export",
    "--build-arg", `OPENCORD_VERSION=${version}`,
    "--build-arg", `OPENCORD_RELEASE_CHANNEL=${releaseChannel}`,
    "--build-arg", `OPENCORD_BUILD_COMMIT=${releaseMetadata?.commit ?? ""}`,
    "--output", `type=local,dest=${dockerOutput}`, ".",
  ], "Docker Buildx could not create the Linux x64 runtime.");

  const runtimePath = path.join(dockerOutput, runtimeName);
  const runtimeStat = statSync(runtimePath);
  if (!runtimeStat.isFile() || runtimeStat.size < 1) throw new Error("Docker builder did not produce the server runtime archive");
  const runtimeSha256 = await sha256File(runtimePath);
  assertArchiveExcludesSources(runtimePath, "runtime");
  const bundleInfo = serverBundleInfoSchema.parse({
    formatVersion: 1,
    product: "opencord-server",
    version,
    releaseChannel,
    commit: releaseMetadata?.commit ?? null,
    protocolVersion: PROTOCOL_VERSION,
    target: { os: "linux", arch: "x64" },
    runtime: { fileName: runtimeName, sha256: runtimeSha256, sizeBytes: runtimeStat.size },
  });

  stageFile(runtimePath, runtimeName);
  writeFileSync(path.join(stagingRoot, "bundle-info.json"), `${JSON.stringify(bundleInfo, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  for (const entry of [
    ".dockerignore", "package.json", "deploy/Dockerfile", "deploy/compose.yml", "deploy/compose.insecure.yml",
    "deploy/Caddyfile", "deploy/livekit-entrypoint.sh", "deploy/.env.example",
    "deploy/scripts/install-ubuntu.sh", "deploy/scripts/install-native-ubuntu.sh", "deploy/scripts/bundle-runtime.sh",
    "server/package.json", "shared/package.json",
  ]) stageFile(path.join(repositoryRoot, entry), entry);
  stageDirectory("deploy/management");

  mkdirSync(releaseDirectory, { recursive: true });
  run("tar", ["--create", "--gzip", "--file", archivePath, "."], "Could not create the OpenCord server bundle", stagingRoot);
  assertArchiveExcludesSources(archivePath, "bundle");
  const serverImage = serverImageReference && serverImageDigest
    ? { reference: serverImageReference, digest: serverImageDigest, platforms: [{ os: "linux", arch: "amd64" }] }
    : null;
  const manifest = await createReleaseManifest({ serverBundlePath: archivePath, releaseChannel, serverImage });
  writeFileSync(`${archivePath}.sha256`, `${manifest.artifacts.serverBundle.sha256}  ${archiveName}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Bundle: ${archivePath}\nRuntime: linux/x64 ${runtimeSha256}\nSHA-256: ${manifest.artifacts.serverBundle.sha256}\n`);
  process.stdout.write(`Manifest: ${path.join(releaseDirectory, "release-manifest.json")} (${manifest.releaseChannel})\n`);
} finally {
  const resolvedTemporary = path.resolve(temporaryRoot);
  const resolvedSystemTemporary = path.resolve(os.tmpdir());
  if (resolvedTemporary.startsWith(`${resolvedSystemTemporary}${path.sep}`) && path.basename(resolvedTemporary).startsWith("opencord-bundle-")) {
    rmSync(resolvedTemporary, { recursive: true, force: true });
  }
}

function stageFile(source, relativeDestination) {
  const destination = path.join(stagingRoot, relativeDestination);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function stageDirectory(relativeDirectory) {
  const source = path.join(repositoryRoot, relativeDirectory);
  const result = spawnSync(process.platform === "win32" ? "robocopy" : "cp", process.platform === "win32"
    ? [source, path.join(stagingRoot, relativeDirectory), "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"]
    : ["-R", source, path.join(stagingRoot, relativeDirectory)], { stdio: "ignore", shell: false });
  if (result.error || (process.platform === "win32" ? (result.status ?? 16) >= 8 : result.status !== 0)) throw result.error ?? new Error(`Could not stage ${relativeDirectory}`);
}

function run(command, arguments_, failureMessage, cwd = repositoryRoot) {
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${failureMessage}${result.error ? `: ${result.error.message}` : ""}`);
}

function assertArchiveExcludesSources(archive, label) {
  const result = spawnSync("tar", ["--list", "--gzip", "--file", archive], { cwd: repositoryRoot, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) throw new Error(`Could not inspect the generated ${label} archive`);
  const entries = result.stdout.split(/\r?\n/u).map((entry) => entry.replace(/^\.\//u, ""));
  const forbidden = entries.find((entry) => /^(?:server|shared)\/src(?:\/|$)/u.test(entry)
    || /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$/u.test(entry)
    || /^(?:server|shared)\/(?:tsconfig\.json|tsup\.config\.ts)$/u.test(entry));
  if (forbidden) throw new Error(`Generated ${label} archive contains build-only content: ${forbidden}`);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
