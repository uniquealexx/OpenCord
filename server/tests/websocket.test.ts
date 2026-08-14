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
import type { VoiceService } from "../src/voice";

const openApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const temporaryDirectories: string[] = [];
const testBuildInfo = { version: "0.1.0", releaseChannel: "development", commit: null } as const;

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("WebSocket chat flow", () => {
  it("authenticates two identities, broadcasts and persists a message", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
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

    const search = waitForEvent(second.socket, "message.search.result");
    second.socket.send(JSON.stringify({ type: "message.search", requestId: randomUUID(), filters: { query: "двумя", authorId: first.userId, channelId: null, contentTypes: ["text"], offset: 0, limit: 25 } }));
    const searchResult = await search;
    expect(searchResult.type === "message.search.result" && searchResult.result).toMatchObject({ total: 1, offset: 0, hasMore: false });
    expect(searchResult.type === "message.search.result" && searchResult.result.messages[0]?.content).toBe("Сообщение между двумя клиентами");

    const closed = [once(first.socket, "close"), once(second.socket, "close")];
    first.socket.close();
    second.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("uploads, attaches and downloads a file through an authenticated session", async () => {
    const attachmentsDir = await mkdtemp(path.join(tmpdir(), "opencord-attachments-"));
    temporaryDirectories.push(attachmentsDir);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, attachmentsDir });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const client = await connectAndAuthenticate(`${baseUrl.replace("http", "ws")}/ws`, "Файловый пользователь");
    const channel = client.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Text channel expected");
    const file = Buffer.from("OpenCord attachment test", "utf8");

    const upload = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${client.sessionToken}`,
        "content-type": "application/octet-stream",
        "content-length": String(file.length),
        "x-opencord-file-name": Buffer.from("проверка.txt").toString("base64url"),
        "x-opencord-mime-type": "text/plain",
      },
      body: file,
    });
    expect(upload.status).toBe(201);
    const attachment = await upload.json() as { id: string; fileName: string; sizeBytes: number };
    expect(attachment).toMatchObject({ fileName: "проверка.txt", sizeBytes: file.length });

    const createdPromise = waitForEvent(client.socket, "message.created");
    client.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: "", attachmentIds: [attachment.id] }));
    const created = await createdPromise;
    if (created.type !== "message.created") throw new Error("Message expected");
    expect(created.message.content).toBe("");
    expect(created.message.attachments[0]).toMatchObject({ id: attachment.id, fileName: "проверка.txt" });

    const download = await fetch(`${baseUrl}/api/attachments/${attachment.id}`, { headers: { authorization: `Bearer ${client.sessionToken}` } });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(file);
    expect((await fetch(`${baseUrl}/api/attachments/${attachment.id}`)).status).toBe(401);

    const updatedPromise = waitForEvent(client.socket, "message.updated");
    client.socket.send(JSON.stringify({ type: "message.update", requestId: randomUUID(), messageId: created.message.id, content: "Файл откреплён", attachmentIds: [] }));
    const updated = await updatedPromise;
    expect(updated.type === "message.updated" && updated.message).toMatchObject({ content: "Файл откреплён", attachments: [] });
    expect((await fetch(`${baseUrl}/api/attachments/${attachment.id}`, { headers: { authorization: `Bearer ${client.sessionToken}` } })).status).toBe(404);

    const closed = once(client.socket, "close");
    client.socket.close();
    await closed;
  }, 15_000);

  it("broadcasts profile replacement and removes a leaving member", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const observer = await connectAndAuthenticate(url, "Наблюдатель");
    const memberJoined = waitForMemberUpdated(observer.socket, (candidate) => candidate.displayName === "Участник");
    const member = await connectAndAuthenticate(url, "Участник");
    expect(await memberJoined).toMatchObject({ member: { id: member.userId, username: usernameFromDisplayName("Участник"), discriminator: "1234", displayName: "Участник", avatar: null } });
    const avatar = "data:image/webp;base64,AA==";
    const banner = "data:image/webp;base64,AQ==";

    const profileUpdated = waitForEvent(observer.socket, "member.updated");
    member.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "member", discriminator: "1234", displayName: "Новое имя", bio: "Описание участника", avatar, banner, status: "dnd" } }));
    expect(await profileUpdated).toMatchObject({ member: { id: member.userId, username: "member", discriminator: "1234", displayName: "Новое имя", bio: "Описание участника", avatar, banner, status: "dnd" } });

    const becameInvisible = waitForEvent(observer.socket, "member.updated");
    member.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "member", discriminator: "1234", displayName: "Новое имя", bio: "Описание участника", avatar, banner, status: "invisible" } }));
    expect(await becameInvisible).toMatchObject({ member: { id: member.userId, bio: "Описание участника", banner, status: "offline" } });

    const memberRemoved = waitForEvent(observer.socket, "member.removed");
    const memberClosed = once(member.socket, "close");
    member.socket.send(JSON.stringify({ type: "server.leave", requestId: randomUUID() }));
    expect(await memberRemoved).toEqual({ type: "member.removed", userId: member.userId });
    await memberClosed;
    observer.socket.close();
  }, 15_000);

  it("bootstraps one owner, enforces permissions and promotes an administrator", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const ownerAvatar = "data:image/webp;base64,AA==";
    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys, ownerAvatar);
    const member = await connectAndAuthenticate(url, "Участник");
    expect(owner.snapshot.server.currentUser.role).toBe("owner");
    expect(owner.snapshot.server.currentUser.permissions).toContain("MANAGE_ROLES");
    expect(owner.snapshot.server.currentUser.permissions).toContain("MANAGE_SERVER");
    expect(member.snapshot.server.currentUser.role).toBe("member");
    expect(member.snapshot.server.members.find((item) => item.id === owner.userId)?.avatar).toBe(ownerAvatar);

    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "закрытый", kind: "text", description: "" }));
    const denied = await forbidden;
    expect(denied.type === "error" && denied.code).toBe("FORBIDDEN");

    const existingChannel = owner.snapshot.server.channels[0]!;
    const forbiddenDelete = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.delete", requestId: randomUUID(), channelId: existingChannel.id }));
    expect((await forbiddenDelete).code).toBe("FORBIDDEN");

    const forbiddenAvatar = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "server.avatar.update", requestId: randomUUID(), avatar: "data:image/png;base64,AA==" }));
    expect((await forbiddenAvatar).code).toBe("FORBIDDEN");

    const ownerAvatarUpdated = waitForEvent(owner.socket, "server.avatar.updated");
    const memberAvatarUpdated = waitForEvent(member.socket, "server.avatar.updated");
    owner.socket.send(JSON.stringify({ type: "server.avatar.update", requestId: randomUUID(), avatar: "data:image/png;base64,AA==" }));
    expect(await ownerAvatarUpdated).toMatchObject({ avatar: "data:image/png;base64,AA==" });
    expect(await memberAvatarUpdated).toMatchObject({ avatar: "data:image/png;base64,AA==" });

    const settingsDenied = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Нельзя", maxAttachmentBytes: null, screenShareMaxResolution: 480, screenShareMaxFrameRate: 15 }));
    expect((await settingsDenied).code).toBe("FORBIDDEN");

    const ownerSettingsSnapshot = waitForEvent(owner.socket, "server.snapshot");
    const memberSettingsSnapshot = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "server.settings.update", requestId: randomUUID(), name: "Новая команда", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 }));
    expect((await ownerSettingsSnapshot).server).toMatchObject({ name: "Новая команда", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    expect((await memberSettingsSnapshot).server).toMatchObject({ name: "Новая команда", maxAttachmentBytes: null, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });

    const ownerMessageCreated = waitForEvent(member.socket, "message.created");
    owner.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: existingChannel.id, content: "Сообщение владельца" }));
    const ownerMessage = await ownerMessageCreated;
    if (ownerMessage.type !== "message.created") throw new Error("Owner message expected");

    const memberMessageCreated = waitForEvent(owner.socket, "message.created");
    member.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: existingChannel.id, content: "Сообщение участника" }));
    const memberMessage = await memberMessageCreated;
    if (memberMessage.type !== "message.created") throw new Error("Member message expected");

    const foreignEditDenied = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "message.update", requestId: randomUUID(), messageId: memberMessage.message.id, content: "Чужая правка" }));
    expect((await foreignEditDenied).code).toBe("FORBIDDEN");

    const ownMessageUpdated = waitForEvent(owner.socket, "message.updated");
    member.socket.send(JSON.stringify({ type: "message.update", requestId: randomUUID(), messageId: memberMessage.message.id, content: "Исправлено автором" }));
    const updated = await ownMessageUpdated;
    expect(updated.type === "message.updated" && updated.message).toMatchObject({ id: memberMessage.message.id, content: "Исправлено автором" });
    expect(updated.type === "message.updated" && updated.message.editedAt).toBeTruthy();

    const foreignDeleteDenied = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "message.delete", requestId: randomUUID(), messageId: ownerMessage.message.id }));
    expect((await foreignDeleteDenied).code).toBe("FORBIDDEN");

    const promotedSnapshot = waitForEvent(member.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.role.set", requestId: randomUUID(), userId: member.userId, role: "administrator" }));
    expect((await promotedSnapshot).server.currentUser.role).toBe("administrator");

    const regular = await connectAndAuthenticate(url, "Исключаемый участник");
    const regularDenied = waitForEvent(regular.socket, "error");
    regular.socket.send(JSON.stringify({ type: "member.kick", requestId: randomUUID(), userId: owner.userId }));
    expect((await regularDenied).code).toBe("FORBIDDEN");

    const removedForOwner = waitForEvent(owner.socket, "member.removed");
    const removedForAdmin = waitForEvent(member.socket, "member.removed");
    const removedForTarget = waitForEvent(regular.socket, "member.removed");
    const regularClosed = once(regular.socket, "close");
    member.socket.send(JSON.stringify({ type: "member.kick", requestId: randomUUID(), userId: regular.userId }));
    expect(await removedForOwner).toEqual({ type: "member.removed", userId: regular.userId });
    expect(await removedForAdmin).toEqual({ type: "member.removed", userId: regular.userId });
    expect(await removedForTarget).toEqual({ type: "member.removed", userId: regular.userId });
    await regularClosed;

    const adminDeletedMessage = waitForEvent(owner.socket, "message.deleted");
    member.socket.send(JSON.stringify({ type: "message.delete", requestId: randomUUID(), messageId: ownerMessage.message.id }));
    expect(await adminDeletedMessage).toMatchObject({ messageId: ownerMessage.message.id, channelId: existingChannel.id });

    const channelSnapshot = waitForEvent(member.socket, "server.snapshot");
    member.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "новости", kind: "text", description: "Обновления" }));
    const createdSnapshot = await channelSnapshot;
    const createdChannel = createdSnapshot.server.channels.find((channel) => channel.name === "новости");
    expect(createdChannel).toBeDefined();

    const updatedSnapshot = waitForEvent(member.socket, "server.snapshot");
    member.socket.send(JSON.stringify({ type: "channel.update", requestId: randomUUID(), channelId: createdChannel!.id, name: "анонсы", description: "Важные обновления", participantLimit: null }));
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

  it("allows only the owner and role-superior administrators to server-mute voice members", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const voiceChannelId = randomUUID();
    const moderationCalls: Array<{ userId: string; muted: boolean }> = [];
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async () => ({ endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null }),
      leave: async () => null,
      updateState: () => null,
      disconnect: async () => null,
      setModeratorMuted: async (userId, muted) => {
        moderationCalls.push({ userId, muted });
        return { userId, channelId: voiceChannelId, muted, deafened: false, serverMuted: muted, viewingScreenShareUserId: null };
      },
      removeChannel: async () => [],
      presence: () => [],
      receiveWebhook: async () => null,
      reconcile: async () => [],
    };
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey, voiceService });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const administrator = await connectAndAuthenticate(url, "Administrator");
    const target = await connectAndAuthenticate(url, "Target member");

    const promoted = waitForEvent(administrator.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "member.role.set", requestId: randomUUID(), userId: administrator.userId, role: "administrator" }));
    expect((await promoted).server.currentUser.role).toBe("administrator");

    const memberDenied = waitForEvent(target.socket, "error");
    target.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: administrator.userId, muted: true }));
    expect((await memberDenied).code).toBe("FORBIDDEN");

    const hierarchyDenied = waitForEvent(administrator.socket, "error");
    administrator.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: owner.userId, muted: true }));
    expect((await hierarchyDenied).code).toBe("FORBIDDEN");

    const serverMuted = waitForEvent(owner.socket, "voice.participant.updated");
    administrator.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: target.userId, muted: true }));
    expect((await serverMuted).participant).toMatchObject({ userId: target.userId, muted: true, serverMuted: true });

    const serverUnmuted = waitForEvent(owner.socket, "voice.participant.updated");
    administrator.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: target.userId, muted: false }));
    expect((await serverUnmuted).participant).toMatchObject({ userId: target.userId, muted: false, serverMuted: false });
    expect(moderationCalls).toEqual([{ userId: target.userId, muted: true }, { userId: target.userId, muted: false }]);
  }, 15_000);

  it("coexists identical username#discriminator members and delivers mentions with membership validation", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const firstTwin = await connectAndAuthenticate(url, "Близнец первый", generateKeyPairSync("ed25519"), null, "twins", "4242");
    const observer = await connectAndAuthenticate(url, "Наблюдатель", generateKeyPairSync("ed25519"), null, "observer", "7777");
    const secondTwin = await connectAndAuthenticate(url, "Близнец второй", generateKeyPairSync("ed25519"), null, "twins", "4242");

    const twins = secondTwin.snapshot.server.members.filter((member) => member.username === "twins" && member.discriminator === "4242");
    expect(twins).toHaveLength(2);
    expect(twins[0]!.fingerprint).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/u);
    expect(twins[0]!.fingerprint).not.toBe(twins[1]!.fingerprint);

    const channel = secondTwin.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const broadcast = waitForEvent(observer.socket, "message.created");
    firstTwin.socket.send(JSON.stringify({
      type: "chat.send",
      requestId: randomUUID(),
      channelId: channel!.id,
      content: `Смотри <@${secondTwin.userId}>, ты это ты`,
      mentions: [secondTwin.userId, "not-a-member"],
    }));
    const created = await broadcast;
    if (created.type !== "message.created") throw new Error("Message expected");
    expect(created.message.mentions).toEqual([{ userId: secondTwin.userId }]);

    const history = waitForEvent(observer.socket, "history.result");
    observer.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const result = await history;
    expect(result.type === "history.result" && result.messages.some((message) => message.mentions.some((mention) => mention.userId === secondTwin.userId))).toBe(true);

    const updated = waitForEvent(observer.socket, "message.updated");
    firstTwin.socket.send(JSON.stringify({ type: "message.update", requestId: randomUUID(), messageId: created.message.id, content: "Отредактировано без упоминаний", mentions: [] }));
    const edited = await updated;
    expect(edited.type === "message.updated" && edited.message.mentions).toEqual([]);

    const closed = [once(firstTwin.socket, "close"), once(observer.socket, "close"), once(secondTwin.socket, "close")];
    firstTwin.socket.close();
    observer.socket.close();
    secondTwin.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("delivers private messages only to participants, masks anonymous senders and enforces chat mute", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const sender = await connectAndAuthenticate(url, "Sender");
    const receiver = await connectAndAuthenticate(url, "Receiver");
    const outsider = await connectAndAuthenticate(url, "Outsider");
    const channel = sender.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    // /pm: получают отправитель и получатель; посторонний — нет.
    const outsiderNext = waitForEvent(outsider.socket, "message.created");
    const receiverPm = waitForEvent(receiver.socket, "message.created");
    const senderPm = waitForEvent(sender.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.pm", requestId: randomUUID(), channelId: channel!.id, content: "Приват", targetUserId: receiver.userId }));
    const receivedPm = await receiverPm;
    const sentPm = await senderPm;
    if (receivedPm.type !== "message.created" || sentPm.type !== "message.created") throw new Error("Private message expected");
    expect(receivedPm.message).toMatchObject({ kind: "pm", content: "Приват", authorId: sender.userId, targetUserId: receiver.userId });
    expect(sentPm.message).toMatchObject({ kind: "pm", content: "Приват" });

    // Обычное сообщение доходит и до постороннего — значит, личное ему не ушло.
    sender.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Всем" }));
    const outsiderGot = await outsiderNext;
    expect(outsiderGot.type === "message.created" && outsiderGot.message.content).toBe("Всем");

    // /apm: получателю личность отправителя не видна, отправитель видит себя.
    const receiverApm = waitForEvent(receiver.socket, "message.created");
    const senderApm = waitForEvent(sender.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.apm", requestId: randomUUID(), channelId: channel!.id, content: "Секрет", targetUserId: receiver.userId }));
    const receivedApm = await receiverApm;
    const sentApm = await senderApm;
    if (receivedApm.type !== "message.created" || sentApm.type !== "message.created") throw new Error("Anonymous message expected");
    expect(receivedApm.message).toMatchObject({ kind: "apm", anonymous: true, content: "Секрет", authorName: "Аноним", authorAvatar: null });
    expect(receivedApm.message.authorId).not.toBe(sender.userId);
    expect(sentApm.message).toMatchObject({ kind: "apm", content: "Секрет", authorId: sender.userId, authorName: "Sender" });

    // История: получатель видит анонимное сообщение без отправителя, посторонний — не видит личных.
    const receiverHistory = waitForEvent(receiver.socket, "history.result");
    receiver.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const receiverHistoryEvent = await receiverHistory;
    if (receiverHistoryEvent.type !== "history.result") throw new Error("History expected");
    const apmInHistory = receiverHistoryEvent.messages.find((message) => message.content === "Секрет");
    expect(apmInHistory).toMatchObject({ authorName: "Аноним" });
    expect(apmInHistory?.authorId).not.toBe(sender.userId);

    const outsiderHistory = waitForEvent(outsider.socket, "history.result");
    outsider.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const outsiderHistoryEvent = await outsiderHistory;
    if (outsiderHistoryEvent.type !== "history.result") throw new Error("History expected");
    expect(outsiderHistoryEvent.messages.some((message) => message.content === "Секрет" || message.content === "Приват")).toBe(false);

    // /mute: владелец мутит отправителя на 30 минут — его сообщения отклоняются.
    const mutedEvent = waitForMemberUpdated(receiver.socket, (member) => member.id === sender.userId && member.chatMuted === true);
    owner.socket.send(JSON.stringify({ type: "chat.mute.set", requestId: randomUUID(), userId: sender.userId, muted: true, durationMinutes: 30 }));
    const mutedMember = (await mutedEvent).member;
    expect(mutedMember.chatMuted).toBe(true);
    expect(mutedMember.chatMutedUntil).toBeTruthy();

    const denied = waitForEvent(sender.socket, "error");
    sender.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Мне нельзя" }));
    expect((await denied).code).toBe("FORBIDDEN");

    // Обычный участник не может менять мут.
    const memberDenied = waitForEvent(receiver.socket, "error");
    receiver.socket.send(JSON.stringify({ type: "chat.mute.set", requestId: randomUUID(), userId: sender.userId, muted: false }));
    expect((await memberDenied).code).toBe("FORBIDDEN");

    // /unmute: сообщения снова проходят.
    const unmutedEvent = waitForMemberUpdated(receiver.socket, (member) => member.id === sender.userId && member.chatMuted === false);
    owner.socket.send(JSON.stringify({ type: "chat.mute.set", requestId: randomUUID(), userId: sender.userId, muted: false }));
    expect((await unmutedEvent).member.chatMuted).toBe(false);

    const allowed = waitForEvent(receiver.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Снова можно" }));
    const allowedEvent = await allowed;
    expect(allowedEvent.type === "message.created" && allowedEvent.message.content).toBe("Снова можно");

    const closed = [once(owner.socket, "close"), once(sender.socket, "close"), once(receiver.socket, "close"), once(outsider.socket, "close")];
    owner.socket.close();
    sender.socket.close();
    receiver.socket.close();
    outsider.socket.close();
    await Promise.all(closed);
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
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challenge.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: "returning", discriminator: "4321", displayName, avatar: null } }));
  return deleted;
}

async function connectAndAuthenticate(url: string, displayName: string, keys = generateKeyPairSync("ed25519"), avatar: string | null = null, username = usernameFromDisplayName(displayName), discriminator = "1234"): Promise<{ socket: WebSocket; snapshot: Extract<ServerEvent, { type: "server.snapshot" }>; userId: string; sessionToken: string }> {
  const socket = new WebSocket(url);
  const challengeEvent = await waitForEvent(socket, "auth.challenge");
  if (challengeEvent.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challengeEvent.challenge, "base64"), keys.privateKey).toString("base64");
  const authOk = waitForEvent(socket, "auth.ok");
  const snapshot = waitForEvent(socket, "server.snapshot");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username, discriminator, displayName, avatar } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot") throw new Error("Snapshot expected");
  if (authenticated.type !== "auth.ok") throw new Error("Auth ok expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId, sessionToken: authenticated.sessionToken };
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

/** Ждёт событие типа type, пропуская подходящие по типу, но не подходящие по условию (например, собственные member.updated). */
function waitForMemberUpdated(socket: WebSocket, predicate: (member: Extract<ServerEvent, { type: "member.updated" }>["member"]) => boolean): Promise<Extract<ServerEvent, { type: "member.updated" }>> {
  return waitForEventMatching(socket, "member.updated", (event) => predicate(event.member));
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
