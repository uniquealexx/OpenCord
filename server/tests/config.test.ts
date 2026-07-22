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
});
