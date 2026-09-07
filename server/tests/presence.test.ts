import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
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

describe("presence broadcast", () => {
  it("broadcasts presence.updated to all members on presence.set", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");

    const seenByOther = waitForEventMatching(second.socket, "presence.updated", (event) => event.userId === first.userId);
    const seenBySelf = waitForEventMatching(first.socket, "presence.updated", (event) => event.userId === first.userId);
    first.socket.send(JSON.stringify({ type: "presence.set", status: "dnd" }));
    expect(await seenByOther).toMatchObject({ userId: first.userId, status: "dnd" });
    expect(await seenBySelf).toMatchObject({ userId: first.userId, status: "dnd" });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("shows invisible as offline to other members", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");

    const seen = waitForEventMatching(second.socket, "presence.updated", (event) => event.userId === first.userId);
    first.socket.send(JSON.stringify({ type: "presence.set", status: "invisible" }));
    expect(await seen).toMatchObject({ userId: first.userId, status: "offline" });

    await closeAll([first.socket, second.socket]);
  }, 15_000);

  it("broadcasts offline when the last connection closes", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");

    const offline = waitForEventMatching(second.socket, "presence.updated", (event) => event.userId === first.userId && event.status === "offline");
    first.socket.close();
    await once(first.socket, "close");
    expect(await offline).toMatchObject({ userId: first.userId, status: "offline" });

    await closeAll([second.socket]);
  }, 15_000);

  it("carries the last-known presence in the snapshot", async () => {
    const url = await startServer();
    const first = await connectAndAuthenticate(url, "Lina");
    const second = await connectAndAuthenticate(url, "Mark");

    const seen = waitForEventMatching(second.socket, "presence.updated", (event) => event.userId === first.userId);
    first.socket.send(JSON.stringify({ type: "presence.set", status: "idle" }));
    await seen;

    const third = await connectAndAuthenticate(url, "Ivy");
    const member = third.snapshot.server.members.find((item) => item.id === first.userId);
    expect(member?.status).toBe("idle");

    await closeAll([first.socket, second.socket, third.socket]);
  }, 15_000);
});

async function startServer(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "opencord-presence-"));
  temporaryDirectories.push(directory);
  const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, attachmentsDir: directory });
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
