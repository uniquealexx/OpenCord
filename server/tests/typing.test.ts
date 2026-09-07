import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];
const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("typing indicators", () => {
  it("broadcasts typing.updated to other members, not to the sender", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    // Собственный start автору не возвращается — слушаем оба сокета.
    const senderLeak = noEvent(first.socket, "typing.updated", 400);
    const started = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === true);
    first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    expect(await started).toMatchObject({ channelId: channel!.id, userId: first.userId, typing: true });
    await senderLeak;

    const stopped = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === false);
    first.socket.send(JSON.stringify({ type: "typing.stop", channelId: channel!.id }));
    expect(await stopped).toMatchObject({ channelId: channel!.id, userId: first.userId, typing: false });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("rate limits typing.start to one broadcast per 2s per user and channel", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const started = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === true);
    first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    await started;

    const stopped = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === false);
    first.socket.send(JSON.stringify({ type: "typing.stop", channelId: channel!.id }));
    await stopped;

    // Мгновенный повторный start после stop — мимо ограничителя, без рассылки.
    await noEvent(second.socket, "typing.updated", 400, () => {
      first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("ignores typing for unknown and voice channels without broadcasting", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const voice = first.snapshot.server.channels.find((item) => item.kind === "voice");
    expect(voice).toBeDefined();

    await noEvent(second.socket, "typing.updated", 400, () => {
      first.socket.send(JSON.stringify({ type: "typing.start", channelId: randomUUID() }));
      first.socket.send(JSON.stringify({ type: "typing.start", channelId: voice!.id }));
    });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("expires typing state after the TTL without typing.stop", async () => {
    const url = await startServer({ typingTtlMs: 150 });
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const started = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === true);
    first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    await started;
    const expired = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === false);
    expect(await expired).toMatchObject({ channelId: channel!.id, userId: first.userId, typing: false });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("clears typing state when the author sends a message", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const started = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === true);
    first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    await started;
    const cleared = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === false);
    first.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Уже написал" }));
    expect(await cleared).toMatchObject({ channelId: channel!.id, userId: first.userId, typing: false });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("clears typing state when the author disconnects", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const started = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === true);
    first.socket.send(JSON.stringify({ type: "typing.start", channelId: channel!.id }));
    await started;
    const released = waitForEventMatching(second.socket, "typing.updated", (event) => event.typing === false);
    first.socket.close();
    await once(first.socket, "close");
    expect(await released).toMatchObject({ channelId: channel!.id, userId: first.userId, typing: false });

    await closeAll([second.socket]);
  }, 15_000);
});

async function startServer(options: { typingTtlMs?: number } = {}): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-typing-"));
  temporaryDirectories.push(directory);
  const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, attachmentsDir: directory, ...options });
  openApps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected test address");
  return `ws://127.0.0.1:${address.port}/ws`;
}

async function closeAll(sockets: WebSocket[]): Promise<void> {
  const open = sockets.filter((socket) => socket.readyState === WebSocket.OPEN);
  if (!open.length) return;
  const closed = open.map((socket) => once(socket, "close"));
  for (const socket of open) socket.close();
  await Promise.all(closed);
}

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519")): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEventMatching(socket, "auth.challenge", () => true);
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEventMatching(socket, "auth.ok", () => true);
  const snapshot = waitForEventMatching(socket, "server.snapshot", () => true);
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: usernameFromDisplayName(displayName), discriminator: "1234", avatar: null } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId };
}

function usernameFromDisplayName(displayName: string): string {
  const slug = displayName.toLocaleLowerCase("en").replace(/[^a-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug.length >= 2 ? slug.slice(0, 32) : `user-${displayName.length}`;
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
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

/** Резолвится, если за ms событие type не пришло; реджектится, если пришло. */
function noEvent<T extends ServerEvent["type"]>(socket: WebSocket, type: T, ms: number, act?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type) { cleanup(); reject(new Error(`Unexpected ${type}`)); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { clearTimeout(timer); socket.off("message", onMessage); socket.off("error", onError); };
    socket.on("message", onMessage);
    socket.on("error", onError);
    act?.();
  });
}
