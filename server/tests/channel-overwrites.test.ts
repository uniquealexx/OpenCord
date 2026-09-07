import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, resolveChannelPermissions, serverEventSchema, type ServerEvent } from "@opencord/shared";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository, SEEDED_MEMBER_ROLE_ID } from "../src/database/repository";

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

describe("channel overwrites migration", () => {
  it("creates the channel_overwrites table and round-trips rows", async () => {
    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    const server = await repository.getServer();
    const channelId = server.channels[0]?.id ?? "";
    const saved = await repository.setChannelOverwrite(channelId, SEEDED_MEMBER_ROLE_ID, ["VOICE_SPEAK"], ["VOICE_CONNECT"]);
    expect(saved).toMatchObject({ channelId, roleId: SEEDED_MEMBER_ROLE_ID });
    expect(await repository.listChannelOverwritesForChannel(channelId)).toHaveLength(1);
    expect(await repository.setChannelOverwrite(channelId, SEEDED_MEMBER_ROLE_ID, [], [])).toBeNull();
    expect(await repository.listChannelOverwritesForChannel(channelId)).toHaveLength(0);
  });
});

describe("allow/deny math", () => {
  it("adds allow, removes deny, deny wins over allow across roles", async () => {
    expect(resolveChannelPermissions(["VOICE_CONNECT", "VOICE_SPEAK"], [])).toEqual(
      expect.arrayContaining(["VOICE_CONNECT", "VOICE_SPEAK"]),
    );
    expect(resolveChannelPermissions(["VOICE_CONNECT", "VOICE_SPEAK"], [{ allow: [], deny: ["VOICE_SPEAK"] }])).toEqual(["VOICE_CONNECT"]);
    expect(resolveChannelPermissions([], [{ allow: ["MANAGE_MESSAGES"], deny: [] }])).toEqual(["MANAGE_MESSAGES"]);
    expect(
      resolveChannelPermissions(["VOICE_CONNECT"], [{ allow: ["VOICE_SPEAK"], deny: [] }, { allow: [], deny: ["VOICE_SPEAK"] }]),
    ).toEqual(["VOICE_CONNECT"]);
  });
});

describe("effective channel permissions", () => {
  it("hides channels denied VOICE_CONNECT and exempts the owner", async () => {
    await repository.upsertUser("owner-1", "owner-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.ensureMembership("owner-1", "owner-key", "owner-key");
    await repository.upsertUser("user-1", "user-key", { username: "lina", discriminator: "0002", avatar: null });
    await repository.ensureMembership("user-1", "user-key");
    const server = await repository.getServer();
    const channelId = server.channels[0]?.id ?? "";
    expect(await repository.hasChannelPermission("user-1", channelId, "VOICE_CONNECT")).toBe(true);
    await repository.setChannelOverwrite(channelId, SEEDED_MEMBER_ROLE_ID, [], ["VOICE_CONNECT"]);
    expect(await repository.hasChannelPermission("user-1", channelId, "VOICE_CONNECT")).toBe(false);
    expect(await repository.hasChannelPermission("user-1", channelId, "VOICE_SPEAK")).toBe(true);
    const visible = await repository.getVisibleChannelIds("user-1");
    expect(visible.has(channelId)).toBe(false);
    expect(await repository.hasChannelPermission("owner-1", channelId, "VOICE_CONNECT")).toBe(true);
    expect((await repository.getVisibleChannelIds("owner-1")).has(channelId)).toBe(true);
  });
});

describe("WebSocket channel overwrites", () => {
  it("enforces overwrites per handler, filters snapshots, checks hierarchy", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "owner-user", ownerKeys);
    const member = await connectAndAuthenticate(url, "member-user");
    const textChannel = owner.snapshot.server.channels.find((channel) => channel.kind === "text");
    const voiceChannel = owner.snapshot.server.channels.find((channel) => channel.kind === "voice");
    if (!textChannel || !voiceChannel) throw new Error("Seed channels expected");

    // Без MANAGE_CHANNELS менять overwrites нельзя.
    const noPerm = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: textChannel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: [], deny: ["VOICE_SPEAK"] }));
    expect((await noPerm).code).toBe("FORBIDDEN");

    // Запрет писать: VOICE_SPEAK deny блокирует chat.send, но чтение открыто.
    const updated = waitForEvent(member.socket, "channel.overwrites.updated");
    const snapAfterDeny = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: textChannel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: [], deny: ["VOICE_SPEAK"] }));
    expect((await updated).channelId).toBe(textChannel.id);
    await snapAfterDeny;
    const sendForbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: textChannel.id, content: "hello", attachmentIds: [], mentions: [], replyToMessageId: null }));
    expect((await sendForbidden).code).toBe("FORBIDDEN");
    const historyOk = waitForEvent(member.socket, "history.result");
    member.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: textChannel.id, limit: 10 }));
    expect((await historyOk).channelId).toBe(textChannel.id);

    // Запрет видеть: VOICE_CONNECT deny скрывает канал из snapshot и закрывает чтение.
    const snapHidden = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: textChannel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: [], deny: ["VOICE_CONNECT", "VOICE_SPEAK"] }));
    const hiddenSnapshot = await snapHidden;
    expect(hiddenSnapshot.server.channels.some((channel) => channel.id === textChannel.id)).toBe(false);
    expect(hiddenSnapshot.server.channelOverwrites).toEqual([]);
    const historyForbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: textChannel.id, limit: 10 }));
    expect((await historyForbidden).code).toBe("FORBIDDEN");

    // Владелец канал по-прежнему видит.
    const ownerList = waitForEvent(owner.socket, "role.list.result");
    owner.socket.send(JSON.stringify({ type: "role.list", requestId: randomUUID() }));
    await ownerList;

    // Голос: VOICE_CONNECT deny блокирует voice.join.
    const voiceDeny = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: voiceChannel.id, roleId: SEEDED_MEMBER_ROLE_ID, allow: [], deny: ["VOICE_CONNECT"] }));
    await voiceDeny;
    const voiceForbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel.id }));
    expect((await voiceForbidden).code).toBe("FORBIDDEN");

    // Иерархия: роль модератора (топ 5) не трогает overwrites роли 50.
    const highCreated = waitForEvent(owner.socket, "role.created");
    owner.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "Senior", color: null, position: 50, permissions: ["VOICE_CONNECT", "VOICE_SPEAK"] }));
    const highRole = await highCreated;
    const modCreated = waitForEvent(owner.socket, "role.created");
    owner.socket.send(JSON.stringify({ type: "role.create", requestId: randomUUID(), name: "Helper", color: null, position: 5, permissions: ["MANAGE_CHANNELS", "VOICE_CONNECT", "VOICE_SPEAK"] }));
    const modRole = await modCreated;
    const helper = await connectAndAuthenticate(url, "helper-user");
    const helperAssigned = waitForEvent(helper.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.roles.set", requestId: randomUUID(), userId: helper.userId, roleIds: [modRole.role.id] }));
    await helperAssigned;
    const hierarchyForbidden = waitForEvent(helper.socket, "error");
    helper.socket.send(JSON.stringify({ type: "channel.overwrites.set", requestId: randomUUID(), channelId: textChannel.id, roleId: highRole.role.id, allow: [], deny: ["VOICE_SPEAK"] }));
    expect((await hierarchyForbidden).code).toBe("FORBIDDEN");

    const closed = [once(owner.socket, "close"), once(member.socket, "close"), once(helper.socket, "close")];
    owner.socket.close();
    member.socket.close();
    helper.socket.close();
    await Promise.all(closed);
  }, 30_000);
});

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
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)); }, 5_000);
    const onMessage = (data: WebSocket.RawData): void => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success && parsed.data.type === type) { cleanup(); resolve(parsed.data as Extract<ServerEvent, { type: T }>); }
    };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const cleanup = (): void => { clearTimeout(timeout); socket.off("message", onMessage); socket.off("error", onError); };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
