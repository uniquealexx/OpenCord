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
    expect(compose).toContain("BOOTSTRAP_OWNER_PUBLIC_KEY_FILE: /run/secrets/owner_public_key");
    expect(compose).toContain("SERVER_NAME_FILE: /run/secrets/server_name");
    expect(compose).toContain("DEPLOYMENT_ID_FILE: /run/secrets/deployment_id");
    expect(compose).toContain("ATTACHMENTS_DIR: /var/lib/opencord/attachments");
    expect(compose).toContain("attachments_data:/var/lib/opencord/attachments");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("ghcr.io/uniquealexx/opencord-server:${OPENCORD_VERSION");
    expect(compose).not.toContain("dockerfile: deploy/Dockerfile");
    expect(compose).toContain("owner_public_key:");
    expect(compose).not.toMatch(/5432:5432/);
  });

  it("runs the application container without root privileges", async () => {
    const dockerfile = await readFile(path.join(repositoryRoot, "deploy", "Dockerfile"), "utf8");
    expect(dockerfile).toContain("FROM node:24.18.0-bookworm-slim");
    expect(dockerfile).toContain("USER opencord");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('org.opencontainers.image.version=${OPENCORD_VERSION}');
    expect(dockerfile).toContain("h.service!=='opencord-server'");
    expect(dockerfile).toContain("server-runtime-linux-x64.tar.gz");
    expect(dockerfile).not.toContain("shared/src");
    expect(dockerfile).not.toContain("server/src");
    expect(dockerfile).not.toContain("pnpm install");
  });

  it("publishes beta server images to GHCR from an exact Git tag", async () => {
    const workflow = await readFile(path.join(repositoryRoot, ".github", "workflows", "publish-server-image.yml"), "utf8");
    expect(workflow).toContain('tags:\n      - "v*-beta.*"');
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("ghcr.io");
    expect(workflow).toContain("target: runtime");
    expect(workflow).toContain("platforms: linux/amd64");
    expect(workflow).toContain("type=raw,value=beta");
    expect(workflow).toContain("type=raw,value=latest");
    expect(workflow).toContain("OPENCORD_RELEASE_CHANNEL=beta");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@(main|master|v\d+)\s*$/mu);
  });

  it("preserves secrets and volumes on repeated installation", async () => {
    const installer = await readFile(path.join(repositoryRoot, "deploy", "scripts", "install-ubuntu.sh"), "utf8");
    expect(installer).toContain("umask 077");
    expect(installer).toContain('if [[ ! -s "${SECRETS_DIR}/postgres_password" ]]');
    expect(installer).toContain("compose up --detach --remove-orphans");
    expect(installer).toContain("compose up --detach --force-recreate --no-deps server");
    expect(installer).not.toMatch(/curl[^\n]*\|[^\n]*(?:ba)?sh/);
    expect(installer).not.toMatch(/down[^\n]*(?:--volumes|-v)/);
    expect(installer).toContain("--insecure");
    expect(installer).toContain("--owner-public-key");
    expect(installer).toContain("--server-name");
    expect(installer).toContain('cat /proc/sys/kernel/random/uuid > "${SECRETS_DIR}/deployment_id"');
    expect(installer).toContain('if [[ ! -s "${SECRETS_DIR}/owner_public_key" ]]');
    expect(installer).toContain("chown 10001:10001");
    expect(installer).toContain("chmod 0400");
    expect(installer).toContain("install-management-home");
    expect(installer).toContain("deploy/management");
    expect(installer).toContain("server-runtime-linux-x64.tar.gz");
    expect(installer).toContain("compose pull database");
    expect(installer).not.toContain("compose build");
    expect(installer).not.toContain("pnpm install");
  });

  it("publishes only the application port in explicit insecure mode", async () => {
    const override = await readFile(path.join(repositoryRoot, "deploy", "compose.insecure.yml"), "utf8");
    expect(override).toContain('"3210:3210"');
    expect(override).not.toMatch(/(?:80|443):(?:80|443)/);
  });

  it("builds versioned native releases with a systemd rollback path", async () => {
    const installer = await readFile(path.join(repositoryRoot, "deploy", "scripts", "install-native-ubuntu.sh"), "utf8");
    expect(installer).toContain('NODE_VERSION="24.18.0"');
    expect(installer).toContain("sha256sum --check --strict");
    expect(installer).toContain("ProtectSystem=strict");
    expect(installer).toContain("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK");
    expect(installer).toContain('release_dir="${INSTALL_ROOT}/releases/${release_id}"');
    expect(installer).toContain('tar --extract --gzip --file "${BUNDLE_RUNTIME_PATH}"');
    expect(installer).not.toContain("pnpm install");
    expect(installer).toContain('readlink -e "${INSTALL_ROOT}/current"');
    expect(installer).toContain("rollback_release");
    expect(installer).toContain("systemctl enable --now postgresql");
    expect(installer).toContain("--insecure");
    expect(installer).toContain("--owner-public-key");
    expect(installer).toContain("--server-name");
    expect(installer).toContain("Environment=SERVER_NAME_FILE=/etc/opencord/server_name");
    expect(installer).toContain("Environment=DEPLOYMENT_ID_FILE=/etc/opencord/deployment_id");
    expect(installer).toContain("Environment=ATTACHMENTS_DIR=/var/lib/opencord/attachments");
    expect(installer).toContain("ReadWritePaths=/var/lib/opencord/attachments");
    expect(installer).toContain('if [[ ! -s "${CONFIG_ROOT}/owner_public_key" ]]');
    expect(installer).toContain("install-management-home");
    expect(installer).toContain("# Managed by OpenCord");
    expect(installer).toContain('bind_host="0.0.0.0"');
    expect(installer).not.toMatch(/curl[^\n]*\|[^\n]*(?:ba)?sh/);
    expect(installer).not.toMatch(/dropdb|DROP DATABASE|purge[^\n]*postgresql/i);
  });

  it("installs a protected management home with explicit data-preserving removal", async () => {
    const controller = await readFile(path.join(repositoryRoot, "deploy", "management", "opencordctl"), "utf8");
    const installer = await readFile(path.join(repositoryRoot, "deploy", "management", "install-management-home"), "utf8");
    const updater = await readFile(path.join(repositoryRoot, "deploy", "management", "update-server"), "utf8");
    const bundler = await readFile(path.join(repositoryRoot, "deploy", "scripts", "create-update-bundle.mjs"), "utf8");
    const manifestGenerator = await readFile(path.join(repositoryRoot, "scripts", "release-manifest.mjs"), "utf8");
    expect(controller).toContain('MANAGEMENT_ROOT="/home/opencord"');
    expect(controller).toContain("compose down --remove-orphans");
    expect(controller).toContain("compose down --volumes --remove-orphans");
    expect(controller).toContain("DELETE-OPENCORD-DATA");
    expect(controller).toContain("pg_dump --format=custom");
    expect(controller).toContain("opencord/attachments -cf");
    expect(controller).toContain("--user 10001:10001 --entrypoint tar");
    expect(controller).toContain("clear-messages DELETE-ALL-MESSAGES");
    expect(controller).toContain("DELETE FROM messages RETURNING 1");
    expect(controller).toContain("История не удалена: не удалось создать обязательную резервную копию");
    expect(installer).toContain('chmod 0640 "${MANAGEMENT_ROOT}/settings/server.env"');
    expect(installer).toContain('ln -sfnT -- "${MANAGEMENT_ROOT}/opencordctl" /usr/local/bin/opencordctl');
    expect(installer).toContain("backup clear-messages update");
    expect(installer).toContain("OpenCord management assets are incomplete");
    expect(installer).toContain('"${SOURCE_DIR}/update-server"');
    expect(updater).toContain("EXPECTED_SHA256");
    expect(updater).toContain("--proto '=https'");
    expect(updater).toContain('"${MANAGEMENT_ROOT}/opencordctl" backup');
    expect(updater).toContain("--no-same-owner --no-same-permissions");
    expect(bundler).toContain('"deploy/management"');
    expect(bundler).toContain("Dockerfile.bundle");
    expect(bundler).not.toContain('"server/src"');
    expect(bundler).not.toContain('"shared/src"');
    expect(bundler).toContain("createReleaseManifest");
    expect(manifestGenerator).toContain('createHash("sha256")');
    expect(manifestGenerator).toContain("createReadStream");
    expect(installer).not.toContain("usermod");
    expect(installer).not.toContain("database_password");
  });
});
