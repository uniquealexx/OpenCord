import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MESSAGE_FLOOD_BURST, PROTOCOL_VERSION, VOICE_JOIN_BURST, VOICE_MODERATED_REJOIN_COOLDOWN_MS, serverEventSchema, type ServerEvent } from "@opencord/shared";
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
    if (created.type !== "message.created") throw new Error("Message expected");

    const replyBroadcast = waitForEvent(second.socket, "message.created");
    first.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Это ответ", replyToMessageId: created.message.id }));
    const reply = await replyBroadcast;
    expect(reply.type === "message.created" && reply.message).toMatchObject({ content: "Это ответ", replyToMessageId: created.message.id });

    const history = waitForEvent(second.socket, "history.result");
    second.socket.send(JSON.stringify({ type: "history.request", requestId: randomUUID(), channelId: channel!.id, limit: 50 }));
    const result = await history;
    expect(result.type === "history.result" && result.messages.some((message) => message.content === "Сообщение между двумя клиентами")).toBe(true);
    expect(result.type === "history.result" && result.messages.some((message) => message.replyToMessageId === created.message.id)).toBe(true);

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

  it("toggles message reactions and broadcasts the updated reaction list", async () => {
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
    first.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel!.id, content: "Сообщение для реакции" }));
    const created = await broadcast;
    if (created.type !== "message.created") throw new Error("Message expected");

    const reacted = waitForEventMatching(second.socket, "message.reactions.updated", (event) => event.reactions.length > 0);
    first.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: created.message.id, emoji: "👍" }));
    expect(await reacted).toMatchObject({ messageId: created.message.id, channelId: channel!.id, reactions: [{ emoji: "👍", userIds: [first.userId] }] });

    const joined = waitForEventMatching(first.socket, "message.reactions.updated", (event) => event.reactions[0]?.userIds.length === 2);
    second.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: created.message.id, emoji: "👍" }));
    expect(await joined).toMatchObject({ messageId: created.message.id, reactions: [{ emoji: "👍", userIds: [first.userId, second.userId] }] });

    const removed = waitForEventMatching(second.socket, "message.reactions.updated", (event) => event.reactions.length === 1 && event.reactions[0]?.userIds[0] === second.userId);
    first.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: created.message.id, emoji: "👍" }));
    expect(await removed).toMatchObject({ messageId: created.message.id, reactions: [{ emoji: "👍", userIds: [second.userId] }] });

    const notFound = waitForEvent(first.socket, "error");
    first.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: randomUUID(), emoji: "👍" }));
    expect((await notFound).code).toBe("NOT_FOUND");

    // Реакция — ровно одно эмодзи: свободный текст протокол до обработчика не пускает.
    for (const junk of ["ЛОЛ", "a̶̡̜̽͊", "‮работа", "👍👍"]) {
      const invalid = waitForEvent(first.socket, "error");
      first.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: created.message.id, emoji: junk }));
      expect((await invalid).code).toBe("INVALID_EVENT");
    }

    const closed = [once(first.socket, "close"), once(second.socket, "close")];
    first.socket.close();
    second.socket.close();
    await Promise.all(closed);
  }, 15_000);

it("forbids the sender from reacting to their own anonymous private message", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const sender = await connectAndAuthenticate(url, "Sender");
    const receiver = await connectAndAuthenticate(url, "Receiver");
    const channel = sender.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    // Анонимное личное сообщение от sender к receiver.
    const senderApm = waitForEvent(sender.socket, "message.created");
    const receiverApm = waitForEvent(receiver.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.apm", requestId: randomUUID(), channelId: channel!.id, content: "Секрет", targetUserId: receiver.userId }));
    const sentApm = await senderApm;
    const receivedApm = await receiverApm;
    if (sentApm.type !== "message.created" || receivedApm.type !== "message.created") throw new Error("Anonymous message expected");

    // Отправитель не может реагировать на собственное анонимное сообщение.
    const forbidden = waitForEvent(sender.socket, "error");
    sender.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: sentApm.message.id, emoji: "👍" }));
    expect((await forbidden).code).toBe("FORBIDDEN");

    // Получатель по-прежнему может реагировать на полученное анонимное сообщение.
    const reacted = waitForEventMatching(receiver.socket, "message.reactions.updated", (event) => event.reactions.length > 0);
    receiver.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: receivedApm.message.id, emoji: "👍" }));
    expect(await reacted).toMatchObject({ messageId: receivedApm.message.id, reactions: [{ emoji: "👍", userIds: [receiver.userId] }] });

    const closed = [once(sender.socket, "close"), once(receiver.socket, "close")];
    sender.socket.close();
    receiver.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("enforces channel slowmode for members and lets moderators bypass it", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys);
    const member = await connectAndAuthenticate(url, "Участник");
    const channel = owner.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Text channel expected");
    expect(channel.slowmodeSeconds).toBe(0);

    const configured = waitForEventMatching(member.socket, "server.snapshot", (event) => event.server.channels.some((item) => item.id === channel.id && item.slowmodeSeconds === 30));
    owner.socket.send(JSON.stringify({ type: "channel.update", requestId: randomUUID(), channelId: channel.id, name: channel.name, description: channel.description, participantLimit: null, slowmodeSeconds: 30 }));
    await configured;

    // Первое сообщение проходит, второе упирается в медленный режим.
    const first = waitForEvent(member.socket, "message.created");
    member.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: "Первое" }));
    await first;
    const limited = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: "Второе" }));
    const rejection = await limited;
    expect(rejection.code).toBe("RATE_LIMITED");
    expect(rejection.retryAfterMs).toBeGreaterThan(0);
    expect(rejection.retryAfterMs).toBeLessThanOrEqual(30_000);

    // Владелец держит MANAGE_MESSAGES, поэтому пишет подряд без задержки.
    const ownerFirst = waitForEvent(owner.socket, "message.created");
    owner.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: "Модератор раз" }));
    await ownerFirst;
    const ownerSecond = waitForEventMatching(owner.socket, "message.created", (event) => event.message.content === "Модератор два");
    owner.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: "Модератор два" }));
    await ownerSecond;

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 20_000);

  it("applies a bulk slowmode to selected text channels and ignores voice ones", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: exportPublicKey(ownerKeys.publicKey) });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys);
    const member = await connectAndAuthenticate(url, "Участник");
    const textChannels = owner.snapshot.server.channels.filter((item) => item.kind === "text");
    const voiceChannel = owner.snapshot.server.channels.find((item) => item.kind === "voice");
    expect(textChannels.length).toBeGreaterThan(1);
    if (!voiceChannel) throw new Error("Voice channel expected");

    // Одним событием настраиваем все текстовые каналы разом плюс голосовой в выборке.
    const applied = waitForEventMatching(owner.socket, "server.snapshot", (event) =>
      textChannels.every((item) => event.server.channels.find((candidate) => candidate.id === item.id)?.slowmodeSeconds === 10));
    owner.socket.send(JSON.stringify({ type: "channel.slowmode.set", requestId: randomUUID(), channelIds: [...textChannels.map((item) => item.id), voiceChannel.id], slowmodeSeconds: 10 }));
    const snapshot = await applied;
    expect(snapshot.server.channels.find((item) => item.id === voiceChannel.id)?.slowmodeSeconds).toBe(0);

    // Обычный участник массовую настройку выполнить не может.
    const forbidden = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "channel.slowmode.set", requestId: randomUUID(), channelIds: [textChannels[0]!.id], slowmodeSeconds: 0 }));
    expect((await forbidden).code).toBe("FORBIDDEN");

    // Выборка без единого текстового канала — ошибка, а не молчаливый успех.
    const notFound = waitForEvent(owner.socket, "error");
    owner.socket.send(JSON.stringify({ type: "channel.slowmode.set", requestId: randomUUID(), channelIds: [voiceChannel.id], slowmodeSeconds: 5 }));
    expect((await notFound).code).toBe("NOT_FOUND");

    const closed = [once(owner.socket, "close"), once(member.socket, "close")];
    owner.socket.close();
    member.socket.close();
    await Promise.all(closed);
  }, 20_000);

  it("stops a flooding client even when the channel has no slowmode", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const flooder = await connectAndAuthenticate(url, "Флудер");
    const channel = flooder.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Text channel expected");
    expect(channel.slowmodeSeconds).toBe(0);

    // Модифицированный клиент шлёт сообщения в цикле, не дожидаясь ответов.
    const limited = waitForEvent(flooder.socket, "error");
    for (let attempt = 0; attempt < MESSAGE_FLOOD_BURST + 5; attempt += 1) {
      flooder.socket.send(JSON.stringify({ type: "chat.send", requestId: randomUUID(), channelId: channel.id, content: `Флуд ${attempt}` }));
    }
    const rejection = await limited;
    expect(rejection.code).toBe("RATE_LIMITED");
    expect(rejection.retryAfterMs).toBeGreaterThan(0);

    const closed = once(flooder.socket, "close");
    flooder.socket.close();
    await closed;
  }, 20_000);

  it("rejects reactions on a private message from outside the conversation", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const sender = await connectAndAuthenticate(url, "Отправитель");
    const receiver = await connectAndAuthenticate(url, "Получатель");
    const stranger = await connectAndAuthenticate(url, "Посторонний");
    const channel = sender.snapshot.server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();

    const delivered = waitForEvent(sender.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.pm", requestId: randomUUID(), channelId: channel!.id, content: "Только между нами", targetUserId: receiver.userId }));
    const privateMessage = await delivered;
    if (privateMessage.type !== "message.created") throw new Error("Private message expected");

    // Посторонний знает идентификатор, но ответ такой же, как на несуществующее сообщение.
    const rejected = waitForEvent(stranger.socket, "error");
    stranger.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: privateMessage.message.id, emoji: "👍" }));
    expect((await rejected).code).toBe("NOT_FOUND");

    // Участники переписки о вторжении не узнают: реакций на сообщении нет.
    const reacted = waitForEventMatching(sender.socket, "message.reactions.updated", (event) => event.messageId === privateMessage.message.id);
    receiver.socket.send(JSON.stringify({ type: "message.react", requestId: randomUUID(), messageId: privateMessage.message.id, emoji: "👍" }));
    expect(await reacted).toMatchObject({ reactions: [{ emoji: "👍", userIds: [receiver.userId] }] });

    const closed = [once(sender.socket, "close"), once(receiver.socket, "close"), once(stranger.socket, "close")];
    sender.socket.close();
    receiver.socket.close();
    stranger.socket.close();
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

    // U+202E перевернул бы хвост имени: .exe отобразился бы как .pdf.
    const disguised = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${client.sessionToken}`,
        "content-type": "application/octet-stream",
        "content-length": String(file.length),
        "x-opencord-file-name": Buffer.from("счёт-‮fdp.exe").toString("base64url"),
        "x-opencord-mime-type": "application/octet-stream",
      },
      body: file,
    });
    expect(disguised.status).toBe(201);
    expect((await disguised.json() as { fileName: string }).fileName).toBe("счёт-fdp.exe");

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

  it("serves a private message attachment to its participants only", async () => {
    const attachmentsDir = await mkdtemp(path.join(tmpdir(), "opencord-private-attachments-"));
    temporaryDirectories.push(attachmentsDir);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, attachmentsDir });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const url = `${baseUrl.replace("http", "ws")}/ws`;

    const sender = await connectAndAuthenticate(url, "Отправитель");
    const recipient = await connectAndAuthenticate(url, "Получатель");
    const stranger = await connectAndAuthenticate(url, "Посторонний");
    const channel = sender.snapshot.server.channels.find((item) => item.kind === "text");
    if (!channel) throw new Error("Text channel expected");

    const file = Buffer.from("Личный файл", "utf8");
    const upload = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${sender.sessionToken}`,
        "content-type": "application/octet-stream",
        "content-length": String(file.length),
        "x-opencord-file-name": Buffer.from("личное.txt").toString("base64url"),
        "x-opencord-mime-type": "text/plain",
      },
      body: file,
    });
    expect(upload.status).toBe(201);
    const attachment = await upload.json() as { id: string };

    // Личное сообщение получает вложение через редактирование — своих полей у chat.pm нет.
    const privateMessage = waitForEvent(recipient.socket, "message.created");
    sender.socket.send(JSON.stringify({ type: "chat.pm", requestId: randomUUID(), channelId: channel.id, content: "Держи файл", targetUserId: recipient.userId }));
    const created = await privateMessage;
    if (created.type !== "message.created") throw new Error("Message expected");
    const attached = waitForEvent(recipient.socket, "message.updated");
    sender.socket.send(JSON.stringify({ type: "message.update", requestId: randomUUID(), messageId: created.message.id, content: "Держи файл", attachmentIds: [attachment.id] }));
    expect((await attached).type === "message.updated").toBe(true);

    const fetchAs = (token: string): Promise<Response> => fetch(`${baseUrl}/api/attachments/${attachment.id}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await fetchAs(sender.sessionToken)).status).toBe(200);
    expect((await fetchAs(recipient.sessionToken)).status).toBe(200);
    // Посторонний участник сервера знает идентификатор, но переписка не его.
    expect((await fetchAs(stranger.sessionToken)).status).toBe(404);

    const closed = [once(sender.socket, "close"), once(recipient.socket, "close"), once(stranger.socket, "close")];
    sender.socket.close();
    recipient.socket.close();
    stranger.socket.close();
    await Promise.all(closed);
  }, 15_000);

  it("broadcasts profile replacement and removes a leaving member", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const observer = await connectAndAuthenticate(url, "Наблюдатель");
    const memberJoined = waitForMemberUpdated(observer.socket, (candidate) => candidate.username === usernameFromDisplayName("Участник"));
    const member = await connectAndAuthenticate(url, "Участник");
    expect(await memberJoined).toMatchObject({ member: { id: member.userId, username: usernameFromDisplayName("Участник"), discriminator: "1234", avatar: null } });
    const avatar = "data:image/webp;base64,AA==";
    const banner = "data:image/webp;base64,AQ==";
    const memberBackground = "data:image/webp;base64,Ag==";

    const profileUpdated = waitForEvent(observer.socket, "member.updated");
    member.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "member", discriminator: "1234", bio: "Описание участника", avatar, banner, memberBackground, status: "dnd", accentColor: "#7c3aed", nameGlow: "#34d399", nameFont: "pixel" } }));
    expect(await profileUpdated).toMatchObject({ member: { id: member.userId, username: "member", discriminator: "1234", bio: "Описание участника", avatar, banner, memberBackground, status: "dnd", accentColor: "#7c3aed", nameGlow: "#34d399", nameFont: "pixel" } });

    const becameInvisible = waitForEvent(observer.socket, "member.updated");
    member.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "member", discriminator: "1234", bio: "Описание участника", avatar, banner, status: "invisible" } }));
    expect(await becameInvisible).toMatchObject({ member: { id: member.userId, bio: "Описание участника", banner, memberBackground: null, status: "offline", accentColor: null, nameGlow: null, nameFont: "none" } });

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

    const forbiddenBanner = waitForEvent(member.socket, "error");
    member.socket.send(JSON.stringify({ type: "server.banner.update", requestId: randomUUID(), banner: "data:image/webp;base64,AA==" }));
    expect((await forbiddenBanner).code).toBe("FORBIDDEN");

    const ownerBannerUpdated = waitForEvent(owner.socket, "server.banner.updated");
    const memberBannerUpdated = waitForEvent(member.socket, "server.banner.updated");
    owner.socket.send(JSON.stringify({ type: "server.banner.update", requestId: randomUUID(), banner: "data:image/webp;base64,AA==" }));
    expect(await ownerBannerUpdated).toMatchObject({ banner: "data:image/webp;base64,AA==" });
    expect(await memberBannerUpdated).toMatchObject({ banner: "data:image/webp;base64,AA==" });

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

    const offlineClientDeletion = await connectToDeletedServer(url);
    expect(offlineClientDeletion.serverId).toBe(owner.snapshot.server.id);
  }, 15_000);

  it("creates a voice channel with the requested participant limit", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys);

    const limitedSnapshot = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Тихая", kind: "voice", description: "", participantLimit: 7 }));
    expect((await limitedSnapshot).server.channels.find((channel) => channel.name === "Тихая")).toMatchObject({ kind: "voice", participantLimit: 7 });

    // Старый клиент без поля получает лимит по умолчанию.
    const defaultSnapshot = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    expect((await defaultSnapshot).server.channels.find((channel) => channel.name === "Голос")).toMatchObject({ kind: "voice", participantLimit: 25 });

    owner.socket.close();
  }, 15_000);

  it("blocks a banned identity until an administrator removes the ban", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const memberKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Владелец", ownerKeys);
    const member = await connectAndAuthenticate(url, "Участник", memberKeys);

    const bannedSnapshot = waitForEventMatching(owner.socket, "server.snapshot", (event) => event.server.bannedMembers?.some((item) => item.id === member.userId) === true);
    // Сам забаненный получает BANNED со сроком, а не member.removed: иначе его клиент
    // удалил бы сервер из списка вместо показа экрана блокировки.
    const memberEvents: ServerEvent[] = [];
    member.socket.on("message", (data: WebSocket.RawData) => {
      const parsed = serverEventSchema.safeParse(JSON.parse(data.toString()) as unknown);
      if (parsed.success) memberEvents.push(parsed.data);
    });
    const memberClosed = once(member.socket, "close");
    owner.socket.send(JSON.stringify({ type: "member.ban", requestId: randomUUID(), userId: member.userId, durationMinutes: null }));
    expect((await bannedSnapshot).server.bannedMembers).toContainEqual(expect.objectContaining({ id: member.userId, username: usernameFromDisplayName("Участник"), expiresAt: null }));
    await memberClosed;
    expect(memberEvents).toContainEqual(expect.objectContaining({ type: "error", code: "BANNED", banExpiresAt: null }));
    expect(memberEvents.some((event) => event.type === "member.removed" && event.userId === member.userId)).toBe(false);

    const bannedAttempt = await connectAndExpectBanned(url, memberKeys);
    expect(bannedAttempt).toMatchObject({ type: "error", code: "BANNED", banExpiresAt: null });

    const unbannedSnapshot = waitForEventMatching(owner.socket, "server.snapshot", (event) => event.server.bannedMembers?.length === 0);
    owner.socket.send(JSON.stringify({ type: "member.unban", requestId: randomUUID(), userId: member.userId }));
    await unbannedSnapshot;
    const returned = await connectAndAuthenticate(url, "Участник", memberKeys);
    expect(returned.userId).toBe(member.userId);

    // Временный бан отдаёт дедлайн, по которому клиент показывает срок разблокировки.
    const returnedClosed = once(returned.socket, "close");
    owner.socket.send(JSON.stringify({ type: "member.ban", requestId: randomUUID(), userId: member.userId, durationMinutes: 30 }));
    await returnedClosed;
    const temporaryAttempt = await connectAndExpectBanned(url, memberKeys);
    expect(temporaryAttempt.code).toBe("BANNED");
    expect(new Date(temporaryAttempt.banExpiresAt ?? "").getTime()).toBeGreaterThan(Date.now());
    owner.socket.close();
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
      verifySelfMute: async () => null,
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

  it("broadcasts a correction when a claimed self-mute does not match the real microphone state", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    let verifications = 0;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        presence = { userId: request.userId, channelId: request.channelId, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { const left = presence; presence = null; return left; },
      updateState: (userId, state) => {
        if (!presence || presence.userId !== userId) return null;
        presence = { ...presence, ...state };
        return presence;
      },
      disconnect: async () => null,
      setModeratorMuted: async () => null,
      // Микрофон на самом деле продолжает передавать: заявленная заглушка — ложь.
      verifySelfMute: async (userId) => {
        verifications += 1;
        if (!presence || presence.userId !== userId || !presence.muted) return null;
        presence = { ...presence, muted: false };
        return presence;
      },
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
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
    const liar = await connectAndAuthenticate(url, "Liar");

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");

    const joined = waitForEvent(liar.socket, "voice.join.authorized");
    liar.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await joined;

    // Клиент объявляет себя заглушённым — остальные сразу видят это заявление.
    const claimed = waitForEvent(owner.socket, "voice.participant.updated");
    liar.socket.send(JSON.stringify({ type: "voice.state.update", requestId: randomUUID(), muted: true, deafened: false, viewingScreenShareUserId: null }));
    expect((await claimed).participant).toMatchObject({ userId: liar.userId, muted: true });

    // ...но проверка по настоящему состоянию дорожки возвращает правду всем.
    const corrected = await waitForEvent(owner.socket, "voice.participant.updated");
    expect(corrected.participant).toMatchObject({ userId: liar.userId, muted: false });
    expect(verifications).toBe(1);

    owner.socket.close();
    liar.socket.close();
  }, 20_000);

  it("releases a voice presence whose control connection went away, but not before the grace period", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        presence = { userId: request.userId, channelId: request.channelId, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { const left = presence; presence = null; return left; },
      updateState: () => null,
      disconnect: async () => null,
      setModeratorMuted: async () => null,
      verifySelfMute: async () => null,
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
      receiveWebhook: async () => null,
      reconcile: async () => [],
    };
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey, voiceService, voiceOrphanGraceMs: 400 });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const speakerKeys = generateKeyPairSync("ed25519");
    const speaker = await connectAndAuthenticate(url, "Speaker", speakerKeys);

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");

    const joined = waitForEvent(speaker.socket, "voice.join.authorized");
    speaker.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await joined;
    expect(presence).not.toBeNull();

    // Обрыв управляющего соединения: соединение с LiveKit при этом никуда не девается.
    const released = waitForEvent(owner.socket, "voice.participant.left");
    speaker.socket.close();
    const left = await released;
    expect(left.participant).toMatchObject({ userId: speaker.userId, channelId: voiceChannel!.id });
    expect(presence).toBeNull();

    owner.socket.close();
  }, 20_000);

  it("keeps a reconnecting participant in the voice channel", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        presence = { userId: request.userId, channelId: request.channelId, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { const left = presence; presence = null; return left; },
      updateState: () => null,
      disconnect: async () => null,
      setModeratorMuted: async () => null,
      verifySelfMute: async () => null,
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
      receiveWebhook: async () => null,
      reconcile: async () => [],
    };
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo, bootstrapOwnerPublicKey: ownerPublicKey, voiceService, voiceOrphanGraceMs: 800 });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const owner = await connectAndAuthenticate(url, "Owner", ownerKeys);
    const speakerKeys = generateKeyPairSync("ed25519");
    const speaker = await connectAndAuthenticate(url, "Speaker", speakerKeys);

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");

    const joined = waitForEvent(speaker.socket, "voice.join.authorized");
    speaker.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await joined;

    // Короткий обрыв сети: клиент возвращается с той же идентичностью до конца паузы.
    speaker.socket.close();
    const reconnected = await connectAndAuthenticate(url, "Speaker", speakerKeys);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    // Разговор не должен прерваться из-за переподключения.
    expect(presence).toMatchObject({ userId: speaker.userId, channelId: voiceChannel!.id });

    owner.socket.close();
    reconnected.socket.close();
  }, 20_000);

  it("throttles a voice join loop before it reaches the voice server, and still lets the participant leave", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    let issueJoinCalls = 0;
    let leaveCalls = 0;
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        issueJoinCalls += 1;
        presence = { userId: request.userId, channelId: request.channelId, muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { leaveCalls += 1; const left = presence; presence = null; return left; },
      updateState: () => null,
      disconnect: async () => null,
      setModeratorMuted: async () => null,
      verifySelfMute: async () => null,
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
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
    const flooder = await connectAndAuthenticate(url, "Flooder");

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");

    // Цикл входов заметно длиннее допустимого запаса.
    const refused = waitForEvent(flooder.socket, "error");
    for (let attempt = 0; attempt < VOICE_JOIN_BURST + 4; attempt += 1) {
      flooder.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    }
    const refusal = await refused;
    expect(refusal.code).toBe("RATE_LIMITED");
    expect(refusal.retryAfterMs).toBeGreaterThan(0);
    // До голосового сервера доходит не больше запаса, а не весь цикл.
    expect(issueJoinCalls).toBeLessThanOrEqual(VOICE_JOIN_BURST);

    // Выход обязан работать даже после исчерпания запаса: иначе участник застрял бы в канале.
    const left = waitForEvent(owner.socket, "voice.participant.left");
    flooder.socket.send(JSON.stringify({ type: "voice.leave", requestId: randomUUID() }));
    await left;
    expect(leaveCalls).toBeGreaterThan(0);

    owner.socket.close();
    flooder.socket.close();
  }, 20_000);

  it("holds a moderated participant out of voice for the rejoin cooldown", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    let joinCount = 0;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        joinCount += 1;
        presence = { userId: request.userId, channelId: request.channelId, muted: false, deafened: false, serverMuted: request.serverMuted, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { const left = presence; presence = null; return left; },
      updateState: () => null,
      disconnect: async () => { const left = presence; presence = null; return left; },
      setModeratorMuted: async () => null,
      verifySelfMute: async () => null,
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
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
    const target = await connectAndAuthenticate(url, "Target member");

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");
    expect(voiceChannel).toBeDefined();

    const joined = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await joined;
    expect(joinCount).toBe(1);

    const disconnected = waitForEvent(target.socket, "voice.participant.disconnected");
    owner.socket.send(JSON.stringify({ type: "voice.member.disconnect", requestId: randomUUID(), userId: target.userId }));
    expect((await disconnected).reason).toBe("moderated");

    // Обход: сразу нажать на тот же канал ещё раз.
    const refused = waitForEvent(target.socket, "error");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    const refusal = await refused;
    expect(refusal.code).toBe("FORBIDDEN");
    expect(refusal.retryAfterMs).toBeGreaterThan(0);
    expect(refusal.retryAfterMs).toBeLessThanOrEqual(VOICE_MODERATED_REJOIN_COOLDOWN_MS);
    // Отказ должен случиться до обращения к голосовому серверу.
    expect(joinCount).toBe(1);

    owner.socket.close();
    target.socket.close();
  }, 20_000);

  it("does not start a rejoin cooldown for a member who was not in a voice channel", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async () => ({ endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null }),
      leave: async () => null,
      updateState: () => null,
      // Участник не в канале: голосовой сервис отключать некого.
      disconnect: async () => null,
      setModeratorMuted: async () => null,
      verifySelfMute: async () => null,
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
    const target = await connectAndAuthenticate(url, "Target member");

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");

    owner.socket.send(JSON.stringify({ type: "voice.member.disconnect", requestId: randomUUID(), userId: target.userId }));
    // Ответа на это отключение нет, поэтому синхронизируемся отдельным запросом.
    const pong = waitForEvent(owner.socket, "pong");
    owner.socket.send(JSON.stringify({ type: "ping", requestId: randomUUID() }));
    await pong;

    const joined = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    expect((await joined).channelId).toBe(voiceChannel!.id);

    owner.socket.close();
    target.socket.close();
  }, 20_000);

  it("keeps a server mute across leaving and rejoining a voice channel", async () => {
    const ownerKeys = generateKeyPairSync("ed25519");
    const ownerPublicKey = exportPublicKey(ownerKeys.publicKey);
    // Единственное состояние, которое голосовой сервис держит сам, — presence: она
    // стирается выходом из канала. Тест проверяет, что мут её переживает.
    const joinRequests: Array<{ userId: string; serverMuted: boolean }> = [];
    let presence: { userId: string; channelId: string; muted: boolean; deafened: boolean; serverMuted: boolean; viewingScreenShareUserId: string | null } | null = null;
    const voiceService: VoiceService = {
      capability: async () => ({ status: "available", secureTransport: true, maxParticipants: 25, warning: null }),
      issueJoin: async (request) => {
        joinRequests.push({ userId: request.userId, serverMuted: request.serverMuted });
        presence = { userId: request.userId, channelId: request.channelId, muted: request.serverMuted, deafened: false, serverMuted: request.serverMuted, viewingScreenShareUserId: null };
        return { endpoint: "wss://voice.example.test", token: "x".repeat(20), expiresAt: new Date(Date.now() + 60_000).toISOString(), replaced: null };
      },
      leave: async () => { const left = presence; presence = null; return left; },
      updateState: () => null,
      disconnect: async () => { const left = presence; presence = null; return left; },
      setModeratorMuted: async (userId, muted) => {
        if (!presence || presence.userId !== userId) return null;
        presence = { ...presence, serverMuted: muted, muted };
        return presence;
      },
      verifySelfMute: async () => null,
      removeChannel: async () => [],
      presence: () => (presence ? [presence] : []),
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
    const target = await connectAndAuthenticate(url, "Target member");

    const channelCreated = waitForEvent(owner.socket, "server.snapshot");
    owner.socket.send(JSON.stringify({ type: "channel.create", requestId: randomUUID(), name: "Голос", kind: "voice" }));
    const voiceChannel = (await channelCreated).server.channels.find((channel) => channel.kind === "voice");
    expect(voiceChannel).toBeDefined();

    const firstJoin = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await firstJoin;
    expect(joinRequests).toEqual([{ userId: target.userId, serverMuted: false }]);

    const muted = waitForEvent(owner.socket, "voice.participant.updated");
    owner.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: target.userId, muted: true }));
    expect((await muted).participant).toMatchObject({ userId: target.userId, serverMuted: true });

    // Обход: выйти из канала и войти заново. Presence стирается, мут — нет.
    const left = waitForEvent(owner.socket, "voice.participant.left");
    target.socket.send(JSON.stringify({ type: "voice.leave", requestId: randomUUID() }));
    await left;

    const rejoin = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await rejoin;
    expect(joinRequests.at(-1)).toEqual({ userId: target.userId, serverMuted: true });

    // Снятие мута тоже сохраняется: следующий вход выдаёт полные права.
    const unmuted = waitForEvent(owner.socket, "voice.participant.updated");
    owner.socket.send(JSON.stringify({ type: "voice.member.mute", requestId: randomUUID(), userId: target.userId, muted: false }));
    expect((await unmuted).participant).toMatchObject({ userId: target.userId, serverMuted: false });

    const leftAgain = waitForEvent(owner.socket, "voice.participant.left");
    target.socket.send(JSON.stringify({ type: "voice.leave", requestId: randomUUID() }));
    await leftAgain;
    const finalJoin = waitForEvent(target.socket, "voice.join.authorized");
    target.socket.send(JSON.stringify({ type: "voice.join", requestId: randomUUID(), channelId: voiceChannel!.id }));
    await finalJoin;
    expect(joinRequests.at(-1)).toEqual({ userId: target.userId, serverMuted: false });

    owner.socket.close();
    target.socket.close();
  }, 20_000);

  it("refuses to hand out a taken username#discriminator tag and delivers mentions with membership validation", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const firstTwin = await connectAndAuthenticate(url, "Близнец первый", generateKeyPairSync("ed25519"), null, "twins", "4242");
    const observer = await connectAndAuthenticate(url, "Наблюдатель", generateKeyPairSync("ed25519"), null, "observer", "7777");
    const secondTwin = await connectAndAuthenticate(url, "Близнец второй", generateKeyPairSync("ed25519"), null, "twins", "4242");

    // Оба просили тег twins#4242, но он принадлежит идентичности: второй получает свой.
    const twins = secondTwin.snapshot.server.members.filter((member) => member.username === "twins");
    expect(twins).toHaveLength(2);
    expect(twins.filter((member) => member.discriminator === "4242")).toHaveLength(1);
    expect(new Set(twins.map((member) => member.discriminator)).size).toBe(2);
    expect(twins.find((member) => member.id === firstTwin.userId)!.discriminator).toBe("4242");
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

  it("ignores a client-supplied discriminator in profile.update so a tag cannot be impersonated", async () => {
    const app = await buildApp({ database: new PGliteDatabase("memory://"), buildInfo: testBuildInfo });
    openApps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Unexpected test address");
    const url = `ws://127.0.0.1:${address.port}/ws`;

    const victim = await connectAndAuthenticate(url, "Жертва", generateKeyPairSync("ed25519"), null, "victim", "4242");
    const impostor = await connectAndAuthenticate(url, "Самозванец", generateKeyPairSync("ed25519"), null, "impostor", "1111");
    const impostorDiscriminator = impostor.snapshot.server.members.find((member) => member.id === impostor.userId)!.discriminator;

    // Модифицированный клиент присылает чужой тег целиком: username повторяется, тег — нет.
    const stolen = waitForMemberUpdated(victim.socket, (member) => member.id === impostor.userId && member.username === "victim");
    impostor.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "victim", discriminator: "4242", bio: "", avatar: null, banner: null, status: "online" } }));
    expect((await stolen).member.discriminator).toBe(impostorDiscriminator);
    expect((await stolen).member.discriminator).not.toBe("4242");

    // Свой дискриминатор нельзя сменить и себе: тег закреплён за идентичностью.
    const renamed = waitForMemberUpdated(impostor.socket, (member) => member.id === victim.userId && member.bio === "Всё ещё я");
    victim.socket.send(JSON.stringify({ type: "profile.update", requestId: randomUUID(), profile: { username: "victim", discriminator: "0000", bio: "Всё ещё я", avatar: null, banner: null, status: "online" } }));
    expect((await renamed).member.discriminator).toBe("4242");

    const closed = [once(victim.socket, "close"), once(impostor.socket, "close")];
    victim.socket.close();
    impostor.socket.close();
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
    expect(sentApm.message).toMatchObject({ kind: "apm", content: "Секрет", authorId: sender.userId, authorName: "sender" });

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

async function connectToDeletedServer(url: string): Promise<Extract<ServerEvent, { type: "server.deleted" }>> {
  const keys = generateKeyPairSync("ed25519");
  const socket = new WebSocket(url);
  const challenge = await waitForEvent(socket, "auth.challenge");
  if (challenge.type !== "auth.challenge") throw new Error("Challenge expected");
  const publicKey = exportPublicKey(keys.publicKey);
  const signature = sign(null, Buffer.from(challenge.challenge, "base64"), keys.privateKey).toString("base64");
  const deleted = waitForEvent(socket, "server.deleted");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challenge.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username: "returning", discriminator: "4321", avatar: null } }));
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
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challengeEvent.requestId, protocolVersion: PROTOCOL_VERSION, publicKey, signature, profile: { username, discriminator, avatar } }));
  const authenticated = await authOk;
  const snapshotEvent = await snapshot;
  if (snapshotEvent.type !== "server.snapshot") throw new Error("Snapshot expected");
  if (authenticated.type !== "auth.ok") throw new Error("Auth ok expected");
  return { socket, snapshot: snapshotEvent, userId: authenticated.userId, sessionToken: authenticated.sessionToken };
}

async function connectAndExpectBanned(url: string, keys: { publicKey: KeyObject; privateKey: KeyObject }): Promise<Extract<ServerEvent, { type: "error" }>> {
  const socket = new WebSocket(url);
  const challenge = await waitForEvent(socket, "auth.challenge");
  if (challenge.type !== "auth.challenge") throw new Error("Challenge expected");
  const signature = sign(null, Buffer.from(challenge.challenge, "base64"), keys.privateKey).toString("base64");
  const rejected = waitForEvent(socket, "error");
  socket.send(JSON.stringify({ type: "auth.respond", requestId: challenge.requestId, protocolVersion: PROTOCOL_VERSION, publicKey: exportPublicKey(keys.publicKey), signature, profile: { username: "member", discriminator: "1234", avatar: null } }));
  return rejected;
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
