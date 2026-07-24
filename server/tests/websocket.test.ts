import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { PROTOCOL_VERSION, serverEventSchema, type ServerEvent } from "@opencord/shared";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("WebSocket chat flow", () => {
  it("authenticates two identities, broadcasts and persists a message", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://") });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const first = await connectAndAuthenticate(url, "Лина");
    const second = await connectAndAuthenticate(url, "Марк");
    const channel = first.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const broadcast = waitForEvent(second.socket, "message.created");
    first.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Сообщение между двумя клиентами" }));
    const created = await broadcast;
    expect(created.type === "message.created" && created.message.content).toBe("Сообщение между двумя клиентами");

    const history = waitForEvent(second.socket, "history.result");
    second.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const result = await history;
    expect(result.type === "history.result" && result.messages.some((message) => message.content === "Сообщение между двумя клиентами")).toBe(true);

    const closed = [once(first.socket, "close"), once(second.socket, "close")];
    first.socket.close();
    second.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("bootstraps one owner, enforces permissions and promotes an administrator", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), bootstrapOwnerPublicKey: ownerPublicKey });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys);
    const member = await connectAndAuthenticate(url, "Участник");
    expect(owner.snapshot.server.currentUser.role).toBe("owner");
    expect(owner.snapshot.server.currentUser.permissions).toContain("MANAGE_ROLES");
    expect(member.snapshot.server.currentUser.role).toBe("member");

    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "закрытый", kind: "text", description: "" }));
    const denied = await forbidden;
    expect(denied.type === "error" && denied.code).toBe("FORBIDDEN");

    const existingChannel = owner.snapshot.server.channels[0]!;
    const forbiddenDelete = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.delete", requestId: randomUUID(), channelId: existingChannel.id }));
    expect((await forbiddenDelete).code).toBe("FORBIDDEN");

    const promotedSnapshot = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.role.set", requestId: randomUUID(), userId: member.userId, role: "administrator" }));
    expect((await promotedSnapshot).server.currentUser.role).toBe("administrator");

    const channelSnapshot = waitForEvent(member.socket, "server.snapshot");
    member.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "новости", kind: "text", description: "Обновления" }));
    const createdSnapshot = await channelSnapshot;
    const createdChannel = createdSnapshot.server.channels.find((channel) => channel.name === "новости");
    expect(createdChannel).toBeDefined();

    const updatedSnapshot = waitForEvent(member.socket, "server.snapshot");
    member.socket.send(JSON.stringify({ type: "channel.update", requestId: randomUUID(), channelId: createdChannel!.id, name: "анонсы", description: "Важные обновления" }));
    expect((await updatedSnapshot).server.channels.find((channel) => channel.id === createdChannel!.id)).toMatchObject({ name: "анонсы", description: "Важные обновления", kind: "text" });

    const deletedSnapshot = waitForEvent(member.socket, "server.snapshot");
    member.socket.send(JSON.stringify({ type: "channel.delete", requestId: randomUUID(), channelId: createdChannel!.id }));
    expect((await deletedSnapshot).server.channels.some((channel) => channel.id === createdChannel!.id)).toBe(false);

    const ownerDeleted = waitForEvent(owner.socket, "server.deleted");
    const memberDeleted = waitForEvent(member.socket, "server.deleted");
    owner.socket.send(JSON.stringify({ type: "server.delete", requestId: randomUUID() }));
    expect((await ownerDeleted).serverId).toBe(owner.snapshot.server.id);
    expect((await memberDeleted).serverId).toBe(owner.snapshot.server.id);

    const offlineClientDeletion = await connectToDeletedServer(url, "Вернувшийся участник");
    expect(offlineClientDeletion.serverId).toBe(owner.snapshot.server.id);
  }, 15_000);
});

async function connectToDeletedServer(url: string, displayName: string): Promise<Extract<ServerEvent, { type: "server.deleted" }>> {
  const keys = generateKeyPairSync("ed25519");
  const socket = new WebSocket(url);
  const challenge = await waitForEvent(socket, "auth.challenge");
  if (challenge.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challenge.challenge, "base64"), keys.privateKey).toString("base64");
  const deleted = waitForEvent(socket, "server.deleted");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challenge.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { displayName, avatar: null } }));
  return deleted;
}

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519")): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEvent(socket, "auth.challenge");
  if (challengeEvent.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEvent(socket, "auth.ok");
  const snapshot = waitForEvent(socket, "server.snapshot");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { displayName, avatar: null } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot") throw new Error("Snapshot expected");
  if (authenticated.type !== "auth.ok") throw new Error("Auth ok expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId };
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
