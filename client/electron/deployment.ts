import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import {
  deploymentConnectionSchema,
  deploymentEnvironmentSchema,
  deploymentProgressSchema,
  deploymentRequestSchema,
  sshHostIdentitySchema,
  sshTargetSchema,
  type DeploymentConnection,
  type DeploymentEnvironment,
  type DeploymentProgress,
  type DeploymentRequest,
  type SshHostIdentity,
  type SshTarget,
} from "../src/shared/deployment";

const BUNDLE_ENTRIES = [
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "deploy/Dockerfile",
  "deploy/compose.yml",
  "deploy/compose.insecure.yml",
  "deploy/Caddyfile",
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
] as const;

type ProgressListener = (progress: DeploymentProgress) => void;
type CredentialResolver = (credentialId: string) => string | undefined;

interface ActiveDeployment {
  client: Client;
  cancelled: boolean;
}

export class DeploymentManager {
  private readonly active = new Map<string, ActiveDeployment>();

  constructor(
    private readonly bundleRoot: string,
    private readonly resolveCredential: CredentialResolver,
    private readonly onProgress: ProgressListener,
  ) {}

  inspectHost(input: unknown): Promise<SshHostIdentity> {
    const target = sshTargetSchema.parse(input);
    return inspectSshHost(target);
  }

  async inspectEnvironment(input: unknown): Promise<DeploymentEnvironment> {
    const connection = deploymentConnectionSchema.parse(input);
    const client = new Client();
    client.on("error", () => undefined);
    try {
      await connect(client, await this.createConnectionConfiguration(connection));
      const result = await executeCapture(client, PREFLIGHT_COMMAND, 20_000);
      if (result.exitCode !== 0) throw new Error("Не удалось проверить окружение VPS");
      const installation = await executeCapture(client, privilegedInstallationProbe(connection), 20_000, connection.username !== "root" && connection.sudoPassword ? `${connection.sudoPassword}\n` : undefined);
      if (installation.exitCode !== 0) throw new Error("Не удалось проверить существующую установку OpenCord через sudo");
      return parseDeploymentEnvironment(`${result.stdout}\n${installation.stdout}`);
    } finally {
      client.end();
    }
  }

  start(input: unknown): { operationId: string } {
    const request = deploymentRequestSchema.parse(input);
    const operationId = randomUUID();
    const active: ActiveDeployment = { client: new Client(), cancelled: false };
    active.client.on("error", () => undefined);
    this.active.set(operationId, active);
    setTimeout(() => { void this.run(operationId, active, request); }, 50);
    return { operationId };
  }

  cancel(operationId: unknown): void {
    if (typeof operationId !== "string") return;
    const active = this.active.get(operationId);
    if (!active) return;
    active.cancelled = true;
    active.client.end();
    this.emit(operationId, "cancelled", "info", "Развёртывание отменено");
    this.active.delete(operationId);
  }

  private async run(operationId: string, active: ActiveDeployment, request: DeploymentRequest): Promise<void> {
    const secrets = collectSecrets(request);
    try {
      this.emit(operationId, "connecting", "info", `Подключение к ${request.host}:${request.port}`);
      const configuration = await this.createConnectionConfiguration(request);
      await connect(active.client, configuration);
      this.assertActive(active);

      const installation = await executeCapture(active.client, privilegedInstallationProbe(request), 20_000, request.username !== "root" && request.sudoPassword ? `${request.sudoPassword}\n` : undefined);
      if (installation.exitCode !== 0) throw new Error("Не удалось проверить существующую установку OpenCord через sudo");
      const redeployment = installation.stdout.includes("OPENCORD_INSTALLED=true");

      const remoteRoot = `/tmp/opencord-install-${operationId}`;
      this.emit(operationId, "uploading", "info", redeployment ? "Загрузка проверенного комплекта для переразвёртывания OpenCord" : "Загрузка проверенного комплекта OpenCord на VPS");
      const sftp = await openSftp(active.client);
      await uploadBundle(sftp, this.bundleRoot, remoteRoot);
      sftp.end();
      this.assertActive(active);

      this.emit(operationId, "installing", "info", redeployment ? "Запуск безопасного переразвёртывания с сохранением данных" : "Запуск идемпотентного установщика Ubuntu");
      const command = buildInstallCommand(remoteRoot, request);
      const exitCode = await executeInstaller(active.client, command, request.sudoPassword, (line, isError) => {
        const clean = redact(line, secrets);
        if (clean) this.emit(operationId, "installing", isError ? "error" : "info", clean);
      });
      if (exitCode !== 0) throw new Error(`Установщик завершился с кодом ${exitCode}`);
      this.assertActive(active);

      const serverUrl = request.domain ? `https://${request.domain}` : insecureServerUrl(request.host);
      this.emit(operationId, "verifying", "info", `Проверка ${serverUrl}/health`);
      await waitForPublicHealth(`${serverUrl}/health`);
      this.emit(operationId, "completed", "success", redeployment ? "OpenCord Server переразвёрнут; база и вложения сохранены" : "OpenCord Server установлен и доступен", serverUrl);
    } catch (error) {
      if (!active.cancelled) this.emit(operationId, "failed", "error", redact(toMessage(error), secrets));
    } finally {
      active.client.end();
      this.active.delete(operationId);
    }
  }

  private async createConnectionConfiguration(request: DeploymentConnection): Promise<ConnectConfig> {
    const configuration: ConnectConfig = {
      host: request.host,
      port: request.port,
      username: request.username,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => sshFingerprint(key) === request.expectedFingerprint,
    };
    if (request.authentication.type === "password") {
      configuration.password = request.authentication.password;
    } else {
      const keyPath = this.resolveCredential(request.authentication.credentialId);
      if (!keyPath) throw new Error("Выбранный SSH-ключ больше недоступен. Выберите файл ещё раз");
      configuration.privateKey = await readFile(keyPath);
      if (request.authentication.passphrase) configuration.passphrase = request.authentication.passphrase;
    }
    return configuration;
  }

  private assertActive(active: ActiveDeployment): void {
    if (active.cancelled) throw new Error("Развёртывание отменено");
  }

  private emit(operationId: string, phase: DeploymentProgress["phase"], level: DeploymentProgress["level"], message: string, serverUrl?: string): void {
    this.onProgress(deploymentProgressSchema.parse({ operationId, phase, level, message: message.slice(0, 2_000), ...(serverUrl ? { serverUrl } : {}) }));
  }
}

export async function inspectSshHost(input: SshTarget): Promise<SshHostIdentity> {
  const target = sshTargetSchema.parse(input);
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("VPS не ответил по SSH за 15 секунд")), 15_000);

    function finish(error?: Error, identity?: SshHostIdentity): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.end();
      if (error) reject(error);
      else if (identity) resolve(sshHostIdentitySchema.parse(identity));
    }

    client.on("error", (error) => {
      if (!settled) finish(new Error(`Не удалось получить SSH fingerprint: ${error.message}`));
    });
    client.connect({
      host: target.host,
      port: target.port,
      username: "opencord-host-check",
      readyTimeout: 15_000,
      hostVerifier: (key: Buffer) => {
        finish(undefined, { ...target, algorithm: readSshKeyAlgorithm(key), fingerprint: sshFingerprint(key) });
        return false;
      },
    });
  });
}

export function sshFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/u, "")}`;
}

export function readSshKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) return "SSH host key";
  const length = key.readUInt32BE(0);
  if (length < 1 || length > 64 || key.length < length + 4) return "SSH host key";
  const algorithm = key.subarray(4, length + 4).toString("ascii");
  return /^[a-z0-9@._+-]+$/iu.test(algorithm) ? algorithm : "SSH host key";
}

export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildInstallCommand(remoteRoot: string, request: Pick<DeploymentRequest, "username" | "domain" | "email" | "ownerPublicKey" | "serverName" | "sudoPassword" | "mode">): string {
  const scriptName = request.mode === "native" ? "install-native-ubuntu.sh" : "install-ubuntu.sh";
  const installer = `${remoteRoot}/deploy/scripts/${scriptName}`;
  const argumentsLine = request.domain && request.email
    ? `--domain ${posixQuote(request.domain)} --email ${posixQuote(request.email)}`
    : "--insecure";
  const invocation = `bash ${posixQuote(installer)} ${argumentsLine} --owner-public-key ${posixQuote(request.ownerPublicKey)} --server-name ${posixQuote(request.serverName)}`;
  if (request.username === "root") return invocation;
  return request.sudoPassword ? `sudo -S -p '' -- ${invocation}` : `sudo -n -- ${invocation}`;
}

export function insecureServerUrl(host: string): string {
  const normalizedHost = host.startsWith("[") ? host : host.includes(":") ? `[${host}]` : host;
  return `http://${normalizedHost}:3210`;
}

const PREFLIGHT_COMMAND = `LC_ALL=C sh -c '
os_id=unknown
os_version=unknown
if [ -r /etc/os-release ]; then . /etc/os-release; os_id=\${ID:-unknown}; os_version=\${VERSION_ID:-unknown}; fi
printf "OS_ID=%s\\nOS_VERSION=%s\\nARCH=%s\\n" "$os_id" "$os_version" "$(uname -m)"
if [ "$(ps -p 1 -o comm= 2>/dev/null | tr -d " ")" = systemd ]; then echo SYSTEMD=true; else echo SYSTEMD=false; fi
if command -v docker >/dev/null 2>&1; then echo DOCKER_CLI=true; else echo DOCKER_CLI=false; fi
if docker compose version >/dev/null 2>&1; then echo DOCKER_COMPOSE=true; else echo DOCKER_COMPOSE=false; fi
if timeout 8 docker info >/dev/null 2>&1; then echo DOCKER_USABLE=true; else echo DOCKER_USABLE=false; fi
for port in 80 443 3210; do
  if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then printf "PORT_%s=true\\n" "$port"; else printf "PORT_%s=false\\n" "$port"; fi
done
'`;

export function parseDeploymentEnvironment(output: string): DeploymentEnvironment {
  const values = new Map(output.split(/\r?\n/u).map((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : [line, ""];
  }));
  const osId = values.get("OS_ID") ?? "unknown";
  const osVersion = values.get("OS_VERSION") ?? "unknown";
  const occupiedPorts = [80, 443, 3210].filter((port) => values.get(`PORT_${port}`) === "true");
  return deploymentEnvironmentSchema.parse({
    osId,
    osVersion,
    architecture: values.get("ARCH") ?? "unknown",
    systemd: values.get("SYSTEMD") === "true",
    dockerCli: values.get("DOCKER_CLI") === "true",
    dockerCompose: values.get("DOCKER_COMPOSE") === "true",
    dockerUsable: values.get("DOCKER_USABLE") === "true",
    occupiedPorts,
    openCordInstalled: values.get("OPENCORD_INSTALLED") === "true",
    supported: osId === "ubuntu" && /^(22\.04|24\.04)$/u.test(osVersion) && /^(x86_64|aarch64|arm64)$/u.test(values.get("ARCH") ?? "") && values.get("SYSTEMD") === "true",
  });
}

function privilegedInstallationProbe(connection: Pick<DeploymentConnection, "username" | "sudoPassword">): string {
  const probe = `sh -c 'if [ -x /home/opencord/opencordctl ] && [ -f /home/opencord/settings/server.env ]; then echo OPENCORD_INSTALLED=true; else echo OPENCORD_INSTALLED=false; fi'`;
  if (connection.username === "root") return probe;
  return connection.sudoPassword ? `sudo -S -p '' -- ${probe}` : `sudo -n -- ${probe}`;
}

export function redact(value: string, secrets: string[]): string {
  let result = value.replace(/postgresql:\/\/[^\s]+/giu, "postgresql://[скрыто]");
  for (const secret of secrets) if (secret) result = result.replaceAll(secret, "[скрыто]");
  return result.trim();
}

function collectSecrets(request: DeploymentRequest): string[] {
  return [
    request.sudoPassword ?? "",
    request.authentication.type === "password" ? request.authentication.password : "",
    request.authentication.type === "private-key" ? request.authentication.passphrase ?? "" : "",
  ].filter(Boolean);
}

function connect(client: Client, configuration: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => { cleanup(); reject(new Error(formatSshConnectionError(error))); };
    const onReady = (): void => { cleanup(); resolve(); };
    const cleanup = (): void => { client.off("error", onError); client.off("ready", onReady); };
    client.once("error", onError);
    client.once("ready", onReady);
    client.connect(configuration);
  });
}

export function formatSshConnectionError(error: unknown): string {
  const sshError = error as { code?: unknown; level?: unknown; message?: unknown };
  const message = typeof sshError?.message === "string" ? sshError.message : "";
  const code = typeof sshError?.code === "string" ? sshError.code : "";
  const level = typeof sshError?.level === "string" ? sshError.level : "";

  if (level === "client-authentication" || /authentication methods failed/iu.test(message)) {
    return "SSH-сервер отклонил авторизацию. Проверьте имя пользователя и пароль, а также что в sshd_config включено PasswordAuthentication yes";
  }
  if (code === "ECONNREFUSED") return "SSH-порт недоступен: соединение отклонено. Проверьте, что sshd запущен и слушает указанный порт";
  if (code === "ETIMEDOUT") return "SSH-сервер не ответил вовремя. Проверьте адрес, порт и сетевой экран";
  return `SSH-подключение не установлено${message ? `: ${message}` : code ? ` (${code})` : ""}`;
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

async function uploadBundle(sftp: SFTPWrapper, bundleRoot: string, remoteRoot: string): Promise<void> {
  const files = await expandBundleFiles(bundleRoot);
  await mkdirRemote(sftp, remoteRoot);
  const directories = [...new Set(files.map((file) => path.posix.dirname(file.replaceAll("\\", "/"))))]
    .filter((directory) => directory !== ".")
    .sort((left, right) => left.split("/").length - right.split("/").length);
  for (const directory of directories) await mkdirRemote(sftp, `${remoteRoot}/${directory}`);
  for (const relativeFile of files) {
    const localFile = path.join(bundleRoot, relativeFile);
    const remoteFile = `${remoteRoot}/${relativeFile.replaceAll("\\", "/")}`;
    await fastPut(sftp, localFile, remoteFile);
  }
}

export async function expandBundleFiles(bundleRoot: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of BUNDLE_ENTRIES) {
    const absolute = path.join(bundleRoot, entry);
    const metadata = await stat(absolute).catch(() => null);
    if (!metadata) throw new Error(`Комплект установки повреждён: отсутствует ${entry}`);
    if (metadata.isFile()) files.push(entry);
    else await walk(absolute, entry, files);
  }
  return files.sort();
}

async function walk(directory: string, relativeDirectory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) await walk(absolute, relative, files);
    else if (entry.isFile()) files.push(relative);
  }
}

function mkdirRemote(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.mkdir(remotePath, (error) => {
    if (!error) resolve();
    else sftp.stat(remotePath, (statError, metadata) => statError || !metadata.isDirectory() ? reject(error) : resolve());
  }));
}

function fastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.fastPut(localPath, remotePath, (error) => error ? reject(error) : resolve()));
}

function executeCapture(client: Client, command: string, timeoutMs: number, stdin?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => client.exec(command, { pty: false }, (error, stream) => {
    if (error) { reject(error); return; }
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      stream.close();
      reject(new Error("Проверка окружения превысила допустимое время"));
    }, timeoutMs);
    stream.on("data", (chunk: Buffer | string) => { if (stdout.length < 65_536) stdout += chunk.toString(); });
    stream.stderr.on("data", (chunk: Buffer | string) => { if (stderr.length < 65_536) stderr += chunk.toString(); });
    stream.once("error", (streamError: Error) => { clearTimeout(timeout); reject(streamError); });
    stream.once("close", (code: number | null) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    stream.end(stdin);
  }));
}

function executeInstaller(client: Client, command: string, sudoPassword: string | undefined, onLine: (line: string, isError: boolean) => void): Promise<number> {
  return new Promise((resolve, reject) => client.exec(command, { pty: false }, (error, stream) => {
    if (error) { reject(error); return; }
    pipeLines(stream, false, onLine);
    pipeLines(stream.stderr, true, onLine);
    stream.once("error", reject);
    stream.once("close", (code: number | null) => resolve(code ?? 1));
    if (sudoPassword) stream.write(`${sudoPassword}\n`);
    stream.end();
  }));
}

function pipeLines(stream: NodeJS.ReadableStream, isError: boolean, onLine: (line: string, isError: boolean) => void): void {
  let pending = "";
  stream.on("data", (chunk: Buffer | string) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(line, isError);
  });
  stream.on("end", () => { if (pending.trim()) onLine(pending, isError); });
}

async function waitForPublicHealth(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) return;
    } catch {
      // DNS and TLS can take a little time after Caddy starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Сервер установлен, но endpoint /health недоступен. Проверьте адрес и требуемые входящие порты");
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка развёртывания";
}
