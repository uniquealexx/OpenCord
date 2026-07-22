import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

describe("production deployment", () => {
  it("keeps PostgreSQL private and persistent", async () => {
    const compose = await readFile(path.join(repositoryRoot, "deploy", "compose.yml"), "utf8");
    expect(compose).toContain("postgres_data:/var/lib/postgresql");
    expect(compose).not.toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password");
    expect(compose).not.toMatch(/5432:5432/);
  });

  it("runs the application container without root privileges", async () => {
    const dockerfile = await readFile(path.join(repositoryRoot, "deploy", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM node:24.18.0-bookworm-slim");
    expect(dockerfile).toContain("USER opencord");
    expect(dockerfile).toContain("HEALTHCHECK");
  });

  it("preserves secrets and volumes on repeated installation", async () => {
    const installer = await readFile(path.join(repositoryRoot, "deploy", "scripts", "install-ubuntu.sh"), "utf8");
    expect(installer).toContain("umask 077");
    expect(installer).toContain('if [[ ! -s "${SECRETS_DIR}/postgres_password" ]]');
    expect(installer).toContain("compose up --detach --remove-orphans");
    expect(installer).not.toMatch(/curl[^\n]*\|[^\n]*(?:ba)?sh/);
    expect(installer).not.toMatch(/down[^\n]*(?:--volumes|-v)/);
  });
});
