import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["package.json", "client/package.json", "server/package.json", "shared/package.json"];
const versions = packages.map((file) => {
  const value = JSON.parse(readFileSync(path.join(repositoryRoot, file), "utf8"));
  if (typeof value.version !== "string") throw new Error(`${file} does not contain a version`);
  return { file, version: value.version };
});
const expected = versions[0]?.version;
const mismatches = versions.filter(({ version }) => version !== expected);

if (mismatches.length > 0) {
  throw new Error(`OpenCord package versions must match ${expected}: ${mismatches.map(({ file, version }) => `${file}=${version}`).join(", ")}`);
}

const bootstrapPath = path.join(repositoryRoot, "deploy", "scripts", "bootstrap.sh");
const bootstrapSource = readFileSync(bootstrapPath, "utf8");
const bootstrapVersionMatch = bootstrapSource.match(/^BOOTSTRAP_VERSION="([^"]+)"$/mu);
if (!bootstrapVersionMatch || bootstrapVersionMatch[1] !== expected) {
  throw new Error(`deploy/scripts/bootstrap.sh must pin BOOTSTRAP_VERSION="${expected}"`);
}

process.stdout.write(`OpenCord package versions are synchronized at ${expected}.\n`);
