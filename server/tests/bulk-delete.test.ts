import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository } from "../src/database/repository";

const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;
const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];

let database: PGliteDatabase;
let repository: ChatRepository;

beforeEach(async () => {
  database = new PGliteDatabase("memory://");
  await runMigrations(database);
  repository = new ChatRepository(database);
});

afterEach(async () => {
  await database.close();
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("ChatRepository.deleteMessages", () => {
  it("deletes regular messages of one channel and returns orphaned storage keys", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const fileId = randomUUID();
    await repository.createAttachment(fileId, "user-1", "bulk-storage-key", "отчёт.txt", "text/plain", 10, "a".repeat(64));
    await repository.createMessage(firstId, channel.id, "user-1", "Первое", [fileId]);
    await repository.createMessage(secondId, channel.id, "user-1", "Второе");

    const result = await repository.deleteMessages([firstId, secondId], channel.id);
    expect(result).toMatchObject({ channelId: channel.id, storageKeys: ["bulk-storage-key"] });
    expect(new Set(result?.deletedIds)).toEqual(new Set([firstId, secondId]));
    expect(await repository.getHistory(channel.id, 50, "user-1")).toEqual([]);
  });

  it("rejects a mixture from another channel and deletes nothing", async () => {
    const channels = (await repository.getServer()).channels.filter((item) => item.kind === "text");
    const first = channels[0]!;
    const second = await repository.createChannel(randomUUID(), "второй", "text", "", null);
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    const firstId = randomUUID();
    const secondId = randomUUID();
    await repository.createMessage(firstId, first.id, "user-1", "В первом");
    await repository.createMessage(secondId, second.id, "user-1", "Во втором");

    expect(await repository.deleteMessages([firstId, secondId], first.id)).toBeNull();
    expect(await repository.getHistory(first.id, 50, "user-1")).toHaveLength(1);
    expect(await repository.getHistory(second.id, 50, "user-1")).toHaveLength(1);
  });

  it("rejects private messages and missing ids without deleting anything", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("sender", "sender-key", { username: "sender", discriminator: "1111", avatar: null });
    await repository.upsertUser("receiver", "receiver-key", { username: "receiver", discriminator: "2222", avatar: null });
    const regularId = randomUUID();
    const pmId = randomUUID();
    await repository.createMessage(regularId, channel.id, "sender", "Обычное");
    await repository.createMessage(pmId, channel.id, "sender", "Личное", [], [], "pm", "receiver");

    expect(await repository.deleteMessages([regularId, pmId], channel.id)).toBeNull();
    expect(await repository.deleteMessages([regularId, randomUUID()], channel.id)).toBeNull();
    expect(await repository.deleteMessages([], channel.id)).toBeNull();
    expect(await repository.getHistory(channel.id, 50, "sender")).toHaveLength(2);
  });
});

describe("WebSocket message.bulkDelete", () => {
  it("requires MANAGE_MESSAGES and broadcasts one message.deleted per id", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const member = await connectAndAuthenticate(url, "Member");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text")!;
    expect(member.snapshot.server.currentUser.permissions).not.toContain("MANAGE_MESSAGES");

    const ids = [await sendChat(owner.socket, member.socket, channel.id, "Первое"), await sendChat(owner.socket, member.socket, channel.id, "Второе"), await sendChat(owner.socket, member.socket, channel.id, "Третье")];

    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: channel.id, messageIds: [ids[0]!, ids[1]!] }));
    expect((await forbidden).code).toBe("FORBIDDEN");

    const firstDeletedForOwner = waitForEventMatching(owner.socket, "message.deleted", (event) => event.messageId === ids[0]);
    const secondDeletedForOwner = waitForEventMatching(owner.socket, "message.deleted", (event) => event.messageId === ids[1]);
    const firstDeletedForMember = waitForEventMatching(member.socket, "message.deleted", (event) => event.messageId === ids[0]);
    const secondDeletedForMember = waitForEventMatching(member.socket, "message.deleted", (event) => event.messageId === ids[1]);
    owner.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: channel.id, messageIds: [ids[0]!, ids[1]!] }));
    expect(await firstDeletedForOwner).toMatchObject({ messageId: ids[0], channelId: channel.id });
    expect(await secondDeletedForOwner).toMatchObject({ messageId: ids[1], channelId: channel.id });
    expect(await firstDeletedForMember).toMatchObject({ messageId: ids[0], channelId: channel.id });
    expect(await secondDeletedForMember).toMatchObject({ messageId: ids[1], channelId: channel.id });

    const history = waitForEvent(owner.socket, "history.result");
    owner.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel.id, limit: 50 }));
    const result = await history;
    if (result.type !== "history.result") throw new Error("History expected");
    expect(result.messages.map((message) => message.id)).toEqual([ids[2]]);

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("rejects cross-channel and private messages without deleting anything", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const member = await connectAndAuthenticate(url, "Member");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text")!;

    const secondSnapshot = waitForEventMatching(owner.socket, "server.snapshot", (event) => event.server.channels.some((item) => item.name === "second"));
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "second", kind: "text", description: "" }));
    const withSecond = await secondSnapshot;
    const otherChannel = withSecond.server.channels.find((item) => item.name === "second")!;

    const regularId = await sendChat(owner.socket, member.socket, channel.id, "Обычное");
    const otherId = await sendChat(owner.socket, member.socket, otherChannel.id, "В другом канале");

    const pmCreated = waitForEvent(member.socket, "message.created");
    owner.socket.send(JSON.stringify({ type: "chat.pm", requestId: randomUUID(), channelId: channel.id, content: "Личное", targetUserId: member.userId }));
    const pm = await pmCreated;
    if (pm.type !== "message.created") throw new Error("PM expected");

    const crossRejected = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: otherChannel.id, messageIds: [regularId, otherId] }));
    expect((await crossRejected).code).toBe("NOT_FOUND");

    const pmRejected = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "message.bulkDelete", requestId: randomUUID(), channelId: channel.id, messageIds: [regularId, pm.message.id] }));
    expect((await pmRejected).code).toBe("NOT_FOUND");

    const history = waitForEvent(owner.socket, "history.result");
    owner.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel.id, limit: 50 }));
    const result = await history;
    if (result.type !== "history.result") throw new Error("History expected");
    expect(result.messages.map((message) => message.id).sort()).toEqual([regularId, pm.message.id].sort());

    const otherHistory = waitForEvent(owner.socket, "history.result");
    owner.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: otherChannel.id, limit: 50 }));
    const otherResult = await otherHistory;
    if (otherResult.type !== "history.result") throw new Error("History expected");
    expect(otherResult.messages.map((message) => message.id)).toEqual([otherId]);

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 15_000);
});

async function sendChat(sender: WebSocket, observer: WebSocket, channelId: string, content: string): Promise<string> {
  const created = waitForEvent(observer, "message.created");
  sender.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId, content }));
  const event = await created;
  if (event.type !== "message.created") throw new Error("Message expected");
  return event.message.id;
}

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519")): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEvent(socket, "auth.challenge");
  if (challengeEvent.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEvent(socket, "auth.ok");
  const snapshot = waitForEvent(socket, "server.snapshot");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: usernameFromDisplayName(displayName), discriminator: "1234", avatar: null } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot" || authenticated.type !== "auth.ok") throw new Error("Auth expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId };
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
