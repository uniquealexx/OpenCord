import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "up";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const deployDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(deployDirectory, "..");
const secretsDirectory = path.join(deployDirectory, "secrets");
const environmentFile = path.join(deployDirectory, ".env");
const passwordFile = path.join(secretsDirectory, "postgres_password");
const databaseUrlFile = path.join(secretsDirectory, "database_url");
const ownerPublicKeyFile = path.join(secretsDirectory, "owner_public_key");
const serverNameFile = path.join(secretsDirectory, "server_name");
const deploymentIdFile = path.join(secretsDirectory, "deployment_id");

if (!new Set(["up", "down", "logs"]).has(action)) {
  throw new Error(`Unknown local Docker action: ${action}`);
}

if (action === "up") ensureLocalSecrets();

const composeArguments = [
  "compose",
  "--project-directory", repositoryRoot,
  "--env-file", environmentFile,
  "--file", path.join(deployDirectory, "compose.yml"),
  "--file", path.join(deployDirectory, "compose.local.yml"),
];

if (action === "up") composeArguments.push("up", "--detach", "--build", "database", "server");
if (action === "down") composeArguments.push("down");
if (action === "logs") composeArguments.push("logs", "--follow", "--tail", "200", "server", "database");

const result = spawnSync("docker", composeArguments, { cwd: repositoryRoot, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (action === "up") {
  await waitForHealth("http://127.0.0.1:3210/health");
  console.log("OpenCord Server is ready at http://127.0.0.1:3210");
}

function ensureLocalSecrets() {
  mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });
  if (!existsSync(passwordFile)) writeFileSync(passwordFile, `${randomBytes(32).toString("hex")}\n`, { encoding: "utf8", mode: 0o600 });
  const password = readFileSync(passwordFile, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("Local PostgreSQL secret has an unexpected format");
  writeFileSync(databaseUrlFile, `postgresql://opencord:${password}@database:5432/opencord\n`, { encoding: "utf8", mode: 0o600 });
  if (!existsSync(ownerPublicKeyFile)) writeFileSync(ownerPublicKeyFile, "local-development-owner-is-claimed-by-first-user-0000\n", { encoding: "utf8", mode: 0o600 });
  if (!existsSync(serverNameFile)) writeFileSync(serverNameFile, "OpenCord Local Docker\n", { encoding: "utf8", mode: 0o600 });
  if (!existsSync(deploymentIdFile)) writeFileSync(deploymentIdFile, `${randomUUID()}\n`, { encoding: "utf8", mode: 0o600 });
  writeFileSync(environmentFile, "OPENCORD_DOMAIN=localhost\nACME_EMAIL=local@example.invalid\nOPENCORD_VERSION=local\nSERVER_LOG_LEVEL=info\n", { encoding: "utf8", mode: 0o600 });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out while waiting for the local OpenCord Server healthcheck");
}
