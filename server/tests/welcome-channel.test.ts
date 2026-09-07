import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_WELCOME_MESSAGE, PROTOCOL_VERSION, clientEventSchema, renderWelcomeMessage, serverEventSchema, type ServerEvent } from "@opencord/shared";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository } from "../src/database/repository";

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];
const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("welcome template", () => {
  it("substitutes {user} and {server} and leaves unknown placeholders alone", () => {
    expect(renderWelcomeMessage("Welcome to {server}, {user}!", "lina", "OpenCord")).toBe("Welcome to OpenCord, lina!");
    expect(renderWelcomeMessage("{user}{user} {server} {unknown}", "a", "b")).toBe("aa b {unknown}");
  });

  it("rejects templates over 500 chars and non-uuid channels", () => {
    const base = { type: "server.settings.update", requestId: randomUUID(), name: "Сервер", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 };
    expect(() => clientEventSchema.parse({ ...base, welcomeMessage: "x".repeat(501) })).toThrow();
    expect(() => clientEventSchema.parse({ ...base, welcomeChannelId: "not-a-uuid" })).toThrow();
    expect(clientEventSchema.parse({ ...base, welcomeChannelId: null, welcomeMessage: "Hi {user}!" })).toMatchObject({ welcomeChannelId: null });
  });
});

describe("welcome channel settings", () => {
  let database: PGliteDatabase;
  let repository: ChatRepository;

  beforeEach(async () => {
    database = new PGliteDatabase("memory://");
    await runMigrations(database);
    repository = new ChatRepository(database);
  });

  afterEach(async () => database.close());

  it("defaults to disabled and persists channel plus template", async () => {
    expect(await repository.getServer()).toMatchObject({ welcomeChannelId: null, welcomeMessage: DEFAULT_WELCOME_MESSAGE });
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();
    await repository.updateServerSettings({ name: "Команда", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: channel!.id, welcomeMessage: "Привет, {user}!" });
    expect(await repository.getServer()).toMatchObject({ welcomeChannelId: channel!.id, welcomeMessage: "Привет, {user}!" });
    // Старый клиент шлёт настройки без welcome-полей — приветствие обязано уцелеть.
    await repository.updateServerSettings({ name: "Команда", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 });
    expect(await repository.getServer()).toMatchObject({ welcomeChannelId: channel!.id, welcomeMessage: "Привет, {user}!" });
    // Явный null выключает.
    await repository.updateServerSettings({ name: "Команда", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: null });
    expect(await repository.getServer()).toMatchObject({ welcomeChannelId: null, welcomeMessage: "Привет, {user}!" });
  });

  it("clears the setting when the welcome channel is deleted", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text");
    await repository.updateServerSettings({ name: "Команда", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: channel!.id, welcomeMessage: "Hi!" });
    expect(await repository.deleteChannel(channel!.id)).toBe(true);
    expect((await repository.getServer()).welcomeChannelId).toBeNull();
  });
});

describe("welcome greeting on join", () => {
  it("posts a substituted greeting for a first-time identity", async () => {
    const { url } = await startApp();
    const owner = await connectAndAuthenticate(url, "Owner");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const updated = waitForEventMatching(owner.socket, "server.snapshot", (snapshot) => snapshot.server.welcomeChannelId === channel!.id);
    owner.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Сервер", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: channel!.id, welcomeMessage: "Добро пожаловать, {user}, на {server}!" }));
    await updated;

    const greeting = waitForEventMatching(owner.socket, "message.created", (event) => event.message.channelId === channel!.id);
    await connectAndAuthenticate(url, "Newcomer");
    const created = await greeting;
    expect(created.message).toMatchObject({ channelId: channel!.id, kind: "chat", authorId: owner.userId, content: "Добро пожаловать, newcomer, на Сервер!" });

    const history = waitForEvent(owner.socket, "history.result");
    owner.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const result = await history;
    expect(result.type === "history.result" && result.messages.some((message) => message.content === "Добро пожаловать, newcomer, на Сервер!")).toBe(true);

    owner.socket.close();
  }, 15_000);

  it("stays silent when the welcome channel is null", async () => {
    const { url } = await startApp();
    const owner = await connectAndAuthenticate(url, "Owner");
    expect(owner.snapshot.server.welcomeChannelId).toBeNull();
    const seen = collectMessages(owner.socket);
    await connectAndAuthenticate(url, "Quiet");
    await sleep(500);
    expect(seen.length).toBe(0);
    owner.socket.close();
  }, 15_000);

  it("rejects setting changes without MANAGE_SERVER and bad channels", async () => {
    const { url } = await startApp();
    const owner = await connectAndAuthenticate(url, "Owner");
    const member = await connectAndAuthenticate(url, "Member");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    const voice = owner.snapshot.server.channels.find((item) => item.kind === "voice");

    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Чужой", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: channel!.id, welcomeMessage: "Hi!" }));
    expect((await forbidden).code).toBe("FORBIDDEN");

    const missing = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Сервер", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: randomUUID(), welcomeMessage: "Hi!" }));
    expect((await missing).code).toBe("NOT_FOUND");

    if (voice) {
      const invalid = waitForEvent(owner.socket, "error");
      owner.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Сервер", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: voice.id, welcomeMessage: "Hi!" }));
      expect((await invalid).code).toBe("INVALID_EVENT");
    }
    owner.socket.close();
    member.socket.close();
  }, 15_000);

  it("greets once: no greeting on reconnect, leave-rejoin, or ban", async () => {
    const { url } = await startApp();
    const owner = await connectAndAuthenticate(url, "Owner");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    const updated = waitForEventMatching(owner.socket, "server.snapshot", (snapshot) => snapshot.server.welcomeChannelId === channel!.id);
    owner.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Сервер", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60, welcomeChannelId: channel!.id, welcomeMessage: "Привет, {user}!" }));
    await updated;

    const keys = generateKeyPairSync("ed25519");
    const greeting = waitForEventMatching(owner.socket, "message.created", (event) => event.message.channelId === channel!.id);
    const first = await connectAndAuthenticate(url, "Returner", keys);
    await greeting;
    const countGreetings = async (): Promise<number> => {
      const history = waitForEvent(owner.socket, "history.result");
      owner.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
      const result = await history;
      if (result.type !== "history.result") throw new Error("History expected");
      return result.messages.filter((message) => message.content === "Привет, returner!").length;
    };
    expect(await countGreetings()).toBe(1);

    // Переподключение тем же ключом — не новичка.
    first.socket.close();
    await once(first.socket, "close");
    const seenReconnect = collectMessages(owner.socket);
    const second = await connectAndAuthenticate(url, "Returner", keys);
    await sleep(500);
    expect(seenReconnect.length).toBe(0);
    expect(await countGreetings()).toBe(1);

    // Выход и повторный вход — тоже не первая регистрация.
    const left = waitForEvent(second.socket, "member.removed");
    const secondClosed = once(second.socket, "close");
    second.socket.send(JSON.stringify({ type: "server.leave", requestId: randomUUID() }));
    await left;
    await secondClosed;
    const seenRejoin = collectMessages(owner.socket);
    await connectAndAuthenticate(url, "Returner", keys);
    await sleep(500);
    expect(seenRejoin.length).toBe(0);
    expect(await countGreetings()).toBe(1);

    // Бан: идентичность вообще не проходит аутентификацию.
    const bannedKeys = generateKeyPairSync("ed25519");
    const bannedGreeting = waitForEventMatching(owner.socket, "message.created", (event) => event.message.channelId === channel!.id);
    const banned = await connectAndAuthenticate(url, "Baddie", bannedKeys);
    await bannedGreeting;
    const banNotice = waitForEvent(banned.socket, "error");
    owner.socket.send(JSON.stringify({ type: "member.ban", requestId: randomUUID(), userId: banned.userId, durationMinutes: null }));
    expect((await banNotice).code).toBe("BANNED");
    const rejected = await connectAndExpectBanned(url, bannedKeys);
    expect(rejected.code).toBe("BANNED");
    owner.socket.close();
    banned.socket.close();
  }, 30_000);
});

async function startApp(): Promise<{ url: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-welcome-"));
  temporaryDirectories.push(directory);
  const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, allowInsecureFirstUserOwner: true, attachmentsDir: directory });
  openApps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected test address");
  return { url: `ws://127.0.0.1:${address.port}/ws` };
}

function collectMessages(socket: WebSocket): { type: string }[] {
  const seen: { type: string }[] = [];
  const onMessage = (data: WebSocket.RawData): void => {
    const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
    if (parsed.success && parsed.data.type === "message.created") seen.push(parsed.data);
  };
  socket.on("message", onMessage);
  return seen;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519"), username = usernameFromDisplayName(displayName)): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEvent(socket, "auth.challenge");
  if (challengeEvent.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEvent(socket, "auth.ok");
  const snapshot = waitForEvent(socket, "server.snapshot");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username, discriminator: "1234", avatar: null } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot") throw new Error("Snapshot expected");
  if (authenticated.type !== "auth.ok") throw new Error("Auth ok expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId };
}

async function connectAndExpectBanned(url: string, keys: { publicKey: KeyObject; privateKey: KeyObject }): Promise<Extract<ServerEvent, { type: "error" }>> {
  const socket = new WebSocket(url);
  const challenge = await waitForEvent(socket, "auth.challenge");
  if (challenge.type !== "auth.challenge") throw new Error("Challenge expected");
  const signature = sign(null, Buffer.from(challenge.challenge, "base64"), keys.privateKey).toString("base64");
  const rejected = waitForEvent(socket, "error");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challenge.requestId, protocolVersion: PROTOCOL_VERSION, publicKey: exportPublicKey(keys.publicKey), signature, profile: { username: "baddie", discriminator: "1234", avatar: null } }));
  const event = await rejected;
  socket.close();
  return event;
}

function usernameFromDisplayName(displayName: string): string {
  const slug = displayName.toLocaleLowerCase("ru").replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug.length >= 2 ? slug.slice(0, 32) : `user-${displayName.length}`;
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function waitForEvent<T extends ServerEvent["type"]>(socket: WebSocket, type: T): Promise<Extract<ServerEvent, { type: T }>> {
  return waitForEventMatching(socket, type, () => true);
}

function waitForEventMatching<T extends ServerEvent["type"]>(socket: WebSocket, type: T, matches: (event: Extract<ServerEvent, { type: T }>) => boolean): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type && matches(parsed.data as Extract<ServerEvent, { type: T }>)) { cleanup(); resolve(parsed.data as Extract<ServerEvent, { type: T }>); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
