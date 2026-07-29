import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION, releaseManifestSchema } from "../shared/dist/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRepositoryUrl = "https://github.com/uniquealexx/OpenCord";

export function validateReleaseContext(releaseChannel, now = new Date()) {
  const version = synchronizedVersion();
  if (!isReleaseChannel(releaseChannel)) throw new Error("Release channel must be development, beta, or stable");
  if (releaseChannel === "stable" && isPrerelease(version)) throw new Error("Stable releases cannot use a prerelease version");
  if (releaseChannel === "beta" && !/-beta(?:\.|$)/u.test(version.split("+", 1)[0] ?? version)) throw new Error("Beta releases require a -beta prerelease version");
  const releaseMetadata = releaseChannel === "development" ? null : inspectPublishedGitRelease(version, now, releaseChannel);
  return { version, releaseMetadata };
}

export async function createReleaseManifest({ serverBundlePath, outputPath = path.join(repositoryRoot, "release", "release-manifest.json"), releaseChannel = "development", now = new Date() }) {
  const { version, releaseMetadata } = validateReleaseContext(releaseChannel, now);
  const bundlePath = path.resolve(serverBundlePath);
  const bundle = statSync(bundlePath);
  if (!bundle.isFile() || bundle.size < 1) throw new Error(`Server bundle is empty or missing: ${bundlePath}`);
  const fileName = path.basename(bundlePath);

  const manifest = releaseManifestSchema.parse({
    schemaVersion: 1,
    product: "opencord",
    releaseChannel,
    version,
    protocolVersion: PROTOCOL_VERSION,
    commit: releaseMetadata?.commit ?? null,
    publishedAt: releaseMetadata?.publishedAt ?? null,
    releaseUrl: releaseMetadata?.releaseUrl ?? null,
    artifacts: {
      serverBundle: {
        bundleFormatVersion: 1,
        fileName,
        downloadUrl: releaseMetadata ? `${canonicalRepositoryUrl}/releases/download/v${version}/${encodeURIComponent(fileName)}` : null,
        sha256: await sha256File(bundlePath),
        sizeBytes: bundle.size,
        target: { os: "linux", arch: "x64" },
        installModes: ["docker", "native"],
      },
      serverImage: null,
      windowsClient: null,
    },
  });

  assertCompatibleExistingManifest(outputPath, manifest);
  writeJsonAtomically(outputPath, manifest);
  return manifest;
}

export function validateReleaseManifestFile(filePath) {
  return releaseManifestSchema.parse(JSON.parse(readFileSync(path.resolve(filePath), "utf8")));
}

function synchronizedVersion() {
  const packageFiles = ["package.json", "client/package.json", "server/package.json", "shared/package.json"];
  const versions = packageFiles.map((file) => ({ file, version: JSON.parse(readFileSync(path.join(repositoryRoot, file), "utf8")).version }));
  const version = versions[0]?.version;
  if (typeof version !== "string") throw new Error("The root package does not contain an OpenCord version");
  const mismatch = versions.find((entry) => entry.version !== version);
  if (mismatch) throw new Error(`${mismatch.file} version ${mismatch.version} does not match OpenCord ${version}`);
  return version;
}

function inspectPublishedGitRelease(version, now, releaseChannel) {
  return validatePublishedGitMetadata({
    version,
    status: runGit(["status", "--porcelain", "--untracked-files=all"]),
    commit: runGit(["rev-parse", "HEAD"]),
    tags: runGit(["tag", "--points-at", "HEAD"]).split(/\r?\n/u).filter(Boolean),
    now,
    releaseChannel,
  });
}

export function validatePublishedGitMetadata({ version, status, commit, tags, now = new Date(), releaseChannel = "stable" }) {
  if (status) throw new Error(`${releaseChannel} release manifests require a clean Git working tree`);
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Git returned an invalid release commit");
  const expectedTag = `v${version}`;
  if (!tags.includes(expectedTag)) throw new Error(`${releaseChannel} release manifest requires tag ${expectedTag} on HEAD`);
  return { commit, publishedAt: now.toISOString(), releaseUrl: `${canonicalRepositoryUrl}/releases/tag/${expectedTag}` };
}

export const validateStableGitMetadata = validatePublishedGitMetadata;

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, { cwd: repositoryRoot, encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${arguments_.join(" ")} failed`);
  return result.stdout.trim();
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

function assertCompatibleExistingManifest(outputPath, nextManifest) {
  if (!existsSync(outputPath)) return;
  let current;
  try {
    current = validateReleaseManifestFile(outputPath);
  } catch (error) {
    if (nextManifest.releaseChannel === "development") return;
    throw new Error(`Refusing to replace an invalid existing manifest during a published release: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (current.releaseChannel !== "development" && (nextManifest.releaseChannel !== current.releaseChannel || current.version !== nextManifest.version || current.commit !== nextManifest.commit)) {
    throw new Error("Refusing to overwrite a published manifest with different release metadata");
  }
}

function writeJsonAtomically(outputPath, manifest) {
  const resolvedOutput = path.resolve(outputPath);
  const temporaryPath = `${resolvedOutput}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
    renameSync(temporaryPath, resolvedOutput);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function parseArguments(arguments_) {
  const args = arguments_.filter((argument) => argument !== "--");
  if (args[0] === "--validate") {
    if (!args[1] || args.length !== 2) throw new Error("Usage: release-manifest.mjs --validate PATH");
    return { mode: "validate", filePath: args[1] };
  }
  let releaseChannel = "development";
  let serverBundlePath = "";
  let outputPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--channel") releaseChannel = args[++index] ?? "";
    else if (argument === "--server-bundle") serverBundlePath = args[++index] ?? "";
    else if (argument === "--output") outputPath = args[++index] ?? "";
    else throw new Error(`Unknown release manifest argument: ${argument}`);
  }
  if (!serverBundlePath) throw new Error("--server-bundle is required");
  if (!isReleaseChannel(releaseChannel)) throw new Error("--channel must be development, beta, or stable");
  return { mode: "create", releaseChannel, serverBundlePath, outputPath };
}

function isReleaseChannel(value) {
  return value === "development" || value === "beta" || value === "stable";
}

function isPrerelease(version) {
  return (version.split("+", 1)[0] ?? version).includes("-");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = parseArguments(process.argv.slice(2));
    if (command.mode === "validate") {
      const manifest = validateReleaseManifestFile(command.filePath);
      process.stdout.write(`Valid OpenCord ${manifest.releaseChannel} manifest ${manifest.version}.\n`);
    } else {
      const manifest = await createReleaseManifest(command);
      process.stdout.write(`Manifest: ${path.resolve(command.outputPath ?? path.join(repositoryRoot, "release", "release-manifest.json"))}\nVersion: ${manifest.version}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
