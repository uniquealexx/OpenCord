import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("server config", () => {
  it("loads the production database URL from a secret file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-config-"));
    temporaryDirectories.push(directory);
    const secretFile = path.join(directory, "database_url");
    await writeFile(secretFile, "postgresql://opencord:secret@database:5432/opencord\n", "utf8");

    const config = loadConfig({ DATABASE_URL_FILE: secretFile, HOST: "0.0.0.0" });

    expect(config.DATABASE_URL).toBe("postgresql://opencord:secret@database:5432/opencord");
    expect(config.HOST).toBe("0.0.0.0");
  });

  it("rejects ambiguous database configuration", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgresql://localhost/opencord", DATABASE_URL_FILE: "/run/secrets/database_url" })).toThrow(/not both/);
  });

  it("loads an owner public key from a file and keeps first-user bootstrap disabled by default", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-owner-config-"));
    temporaryDirectories.push(directory);
    const ownerFile = path.join(directory, "owner_public_key");
    await writeFile(ownerFile, `${"A".repeat(64)}\n`, "utf8");
    const config = loadConfig({ BOOTSTRAP_OWNER_PUBLIC_KEY_FILE: ownerFile });
    expect(config.BOOTSTRAP_OWNER_PUBLIC_KEY).toBe("A".repeat(64));
    expect(config.ALLOW_INSECURE_FIRST_USER_OWNER).toBe(false);
  });

  it("loads the shared server name and deployment generation from files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencord-server-config-"));
    temporaryDirectories.push(directory);
    const nameFile = path.join(directory, "server_name");
    const deploymentFile = path.join(directory, "deployment_id");
    await writeFile(nameFile, "Команда OpenCord\n", "utf8");
    await writeFile(deploymentFile, "8fa65095-8e9d-4bb9-a177-2a5d5de0c81f\n", "utf8");
    const config = loadConfig({ SERVER_NAME_FILE: nameFile, DEPLOYMENT_ID_FILE: deploymentFile });
    expect(config.SERVER_NAME).toBe("Команда OpenCord");
    expect(config.DEPLOYMENT_ID).toBe("8fa65095-8e9d-4bb9-a177-2a5d5de0c81f");
  });
});
