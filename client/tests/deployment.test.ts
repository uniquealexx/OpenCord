import { createHash } from "node:crypto";
import { PROTOCOL_VERSION } from "@opencord/shared";
import { describe, expect, it } from "vitest";
import { buildExtractBundleCommand, buildInstallCommand, formatSshConnectionError, insecureServerUrl, parseDeploymentEnvironment, parsePublicHealthPayload, posixQuote, readSshKeyAlgorithm, redact, sshFingerprint } from "../electron/deployment";
import { deploymentRequestSchema, sshTargetSchema } from "@/shared/deployment";

describe("SSH deployment boundary", () => {
  const ownerPublicKey = "A".repeat(64);
  it("validates SSH targets and deployment credentials", () => {
    expect(sshTargetSchema.parse({ host: "203.0.113.10", port: 22 })).toEqual({ host: "203.0.113.10", port: 22 });
    expect(() => sshTargetSchema.parse({ host: "https://example.com", port: 22 })).toThrow();
    expect(() => deploymentRequestSchema.parse({
      host: "server.example.com", port: 22, username: "root", domain: "chat.example.com", email: "admin@example.com",
      expectedFingerprint: "not-a-fingerprint", authentication: { type: "password", password: "secret" }, mode: "docker",
    })).toThrow();
    const baseRequest = {
      host: "server.example.com", port: 22, username: "root",
      expectedFingerprint: `SHA256:${"A".repeat(43)}`,
      authentication: { type: "password" as const, password: "secret" }, ownerPublicKey, serverName: "Команда", mode: "native" as const,
    };
    expect(deploymentRequestSchema.parse(baseRequest)).toEqual(baseRequest);
    expect(() => deploymentRequestSchema.parse({ ...baseRequest, domain: "chat.example.com" })).toThrow();
    expect(() => deploymentRequestSchema.parse({ ...baseRequest, email: "admin@example.com" })).toThrow();
  });

  it("formats OpenSSH SHA256 fingerprints and reads the key algorithm", () => {
    const algorithm = Buffer.from("ssh-ed25519");
    const key = Buffer.concat([Buffer.from([0, 0, 0, algorithm.length]), algorithm, Buffer.from("key material")]);
    expect(readSshKeyAlgorithm(key)).toBe("ssh-ed25519");
    expect(sshFingerprint(key)).toBe(`SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/u, "")}`);
  });

  it("explains rejected SSH password authentication", () => {
    const error = Object.assign(new Error("All configured authentication methods failed"), { level: "client-authentication" });
    expect(formatSshConnectionError(error)).toContain("PasswordAuthentication yes");
  });

  it("quotes installer arguments and never includes credentials in the command", () => {
    expect(posixQuote("a'b")).toBe("'a'\"'\"'b'");
    const command = buildInstallCommand("/tmp/opencord-safe", { username: "deploy", domain: "chat.example.com", email: "admin@example.com", ownerPublicKey, serverName: "Команда", sudoPassword: "super-secret", mode: "docker" });
    expect(command).toContain("sudo -S");
    expect(command).toContain("install-ubuntu.sh");
    expect(command).not.toContain("super-secret");
    expect(command).toContain("--owner-public-key");
    expect(command).toContain("--server-name");
    expect(command).toContain("Команда");
    expect(buildInstallCommand("/tmp/opencord-safe", { username: "root", domain: "chat.example.com", email: "admin@example.com", ownerPublicKey, serverName: "Команда", mode: "native" })).toContain("install-native-ubuntu.sh");
    const insecureCommand = buildInstallCommand("/tmp/opencord-safe", { username: "root", ownerPublicKey, serverName: "Команда", mode: "native" });
    expect(insecureCommand).toContain("--insecure");
    expect(insecureCommand).toContain("--public-host 'localhost'");
    expect(insecureCommand).not.toContain("--domain");
    expect(insecureServerUrl("127.0.0.1")).toBe("http://127.0.0.1:3210");
    expect(insecureServerUrl("::1")).toBe("http://[::1]:3210");
  });

  it("parses the remote environment probe", () => {
    expect(parseDeploymentEnvironment("OS_ID=ubuntu\nOS_VERSION=24.04\nARCH=x86_64\nSYSTEMD=true\nDOCKER_CLI=true\nDOCKER_COMPOSE=true\nDOCKER_USABLE=true\nPORT_80=false\nPORT_443=true\nPORT_3210=false\n")).toEqual({
      osId: "ubuntu", osVersion: "24.04", architecture: "x86_64", systemd: true,
      dockerCli: true, dockerCompose: true, dockerUsable: true, occupiedPorts: [443], openCordInstalled: false, supported: true,
    });
  });

  it("accepts only the typed OpenCord health contract", () => {
    const health = {
      status: "ok", service: "opencord-server", version: "0.1.0", releaseChannel: "development", buildCommit: null,
      protocolVersion: PROTOCOL_VERSION, database: "postgres", voice: { status: "degraded", secureTransport: false, maxParticipants: 25, warning: "LiveKit unavailable" },
    };
    expect(parsePublicHealthPayload(health)).toEqual(health);
    expect(() => parsePublicHealthPayload({ status: "ok" })).toThrow();
    expect(() => parsePublicHealthPayload({ ...health, service: "other-server" })).toThrow();
  });

  it("redacts passwords and database URLs from remote output", () => {
    expect(redact("password hunter2 postgresql://user:secret@db/name", ["hunter2"])).toBe("password [скрыто] postgresql://[скрыто]");
  });

  it("verifies and safely extracts one uploaded bundle", () => {
    const command = buildExtractBundleCommand("/tmp/server.tar.gz", "/tmp/opencord-safe", "a".repeat(64));
    expect(command).toContain("sha256sum");
    expect(command).toContain("tar --list");
    expect(command).toContain("--no-same-owner");
    expect(command).not.toContain("server/src");
    expect(() => buildExtractBundleCommand("/tmp/server.tar.gz", "/tmp/opencord-safe", "bad")).toThrow();
  });
});
