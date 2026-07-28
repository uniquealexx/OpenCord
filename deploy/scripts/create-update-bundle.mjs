import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const version = typeof packageJson.version === "string" ? packageJson.version : "development";
const releaseDirectory = path.join(repositoryRoot, "release");
const archiveName = `opencord-server-${version}.tar.gz`;
const archivePath = path.join(releaseDirectory, archiveName);
const entries = [
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "deploy/Dockerfile",
  "deploy/compose.yml",
  "deploy/compose.insecure.yml",
  "deploy/Caddyfile",
  "deploy/livekit-entrypoint.sh",
  "deploy/.env.example",
  "deploy/scripts/install-ubuntu.sh",
  "deploy/scripts/install-native-ubuntu.sh",
  "deploy/management",
  "server/package.json",
  "server/tsconfig.json",
  "server/src",
  "shared/package.json",
  "shared/tsconfig.json",
  "shared/src",
];

mkdirSync(releaseDirectory, { recursive: true });
const result = spawnSync("tar", ["--create", "--gzip", "--file", archivePath, ...entries], { cwd: repositoryRoot, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(`${archivePath}.sha256`, `${sha256}  ${archiveName}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`Bundle: ${archivePath}\nSHA-256: ${sha256}\n`);
