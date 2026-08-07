import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";
import { runMigrations } from "../src/database/migrations";
import { ChatRepository, permissionsForRole } from "../src/database/repository";

let database: PGliteDatabase;
let repository: ChatRepository;

beforeEach(async () => {
  database = new PGliteDatabase("memory://");
  await runMigrations(database);
  repository = new ChatRepository(database);
});

afterEach(async () => database.close());

describe("ChatRepository", () => {
  it("persists server name, attachment limit and screen-share limits", async () => {
    expect(await repository.getServer()).toMatchObject({ name: "OpenCord Local", maxAttachmentBytes: 10 * 1024 * 1024, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 });
    await repository.updateServerSettings({ name: "Команда", maxAttachmentBytes: 2000 * 1024 * 1024, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    expect(await repository.getServer()).toMatchObject({ name: "Команда", maxAttachmentBytes: 2000 * 1024 * 1024, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    await repository.updateServerSettings({ name: "Команда без лимита", maxAttachmentBytes: null, screenShareMaxResolution: 480, screenShareMaxFrameRate: 15 });
    expect(await repository.getServer()).toMatchObject({ name: "Команда без лимита", maxAttachmentBytes: null, screenShareMaxResolution: 480, screenShareMaxFrameRate: 15 });
  });

  it("does not overwrite a manually changed name on the same deployment restart", async () => {
    await repository.configureServer("Имя установки", "deployment-1");
    await repository.updateServerSettings({ name: "Ручное имя", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 });
    await repository.configureServer("Старое имя установки", "deployment-1");
    expect((await repository.getServer()).name).toBe("Ручное имя");
    await repository.configureServer("Новая установка", "deployment-2");
    expect((await repository.getServer()).name).toBe("Новая установка");
  });

  it("stores and returns message history", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text");
    expect(channel).toBeDefined();
    await repository.upsertUser("user-1", "public-key", { displayName: "Лина", avatar: null });
    const messageId = randomUUID();
    const created = await repository.createMessage(messageId, channel!.id, "user-1", "Первое настоящее сообщение");
    expect(created?.editedAt).toBeNull();
    const updated = await repository.updateMessage(messageId, "user-1", "Исправленное сообщение");
    expect(updated?.message).toMatchObject({ id: messageId, content: "Исправленное сообщение" });
    expect(updated?.message.editedAt).toBeTruthy();
    expect(await repository.getHistory(channel!.id, 50)).toEqual([updated?.message]);
    expect(await repository.deleteMessage(messageId, "user-1", false)).toMatchObject({ channelId: channel!.id });
    expect(await repository.getHistory(channel!.id, 50)).toEqual([]);
  });

  it("replaces message attachments and returns removed storage keys", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { displayName: "Лина", avatar: null });
    const firstId = randomUUID();
    const secondId = randomUUID();
    await repository.createAttachment(firstId, "user-1", "first-storage-key", "старый.txt", "text/plain", 10, "a".repeat(64));
    await repository.createAttachment(secondId, "user-1", "second-storage-key", "новый.txt", "text/plain", 20, "b".repeat(64));
    const messageId = randomUUID();
    await repository.createMessage(messageId, channel.id, "user-1", "До правки", [firstId]);

    const updated = await repository.updateMessage(messageId, "user-1", "После правки", [secondId]);
    expect(updated?.message.attachments).toEqual([expect.objectContaining({ id: secondId, fileName: "новый.txt" })]);
    expect(updated?.removedStorageKeys).toEqual(["first-storage-key"]);
    expect(await repository.getAccessibleAttachment(firstId, "user-1")).toBeNull();
  });

  it("searches server messages by query, author, channel and content type", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    const secondChannel = await repository.createChannel(randomUUID(), "поиск", "text", "Результаты поиска");
    await repository.upsertUser("user-1", "public-key-1", { displayName: "Лина", avatar: null });
    await repository.upsertUser("user-2", "public-key-2", { displayName: "Марк", avatar: null });
    await repository.createMessage(randomUUID(), channel.id, "user-1", "Текст про космос");

    const imageId = randomUUID();
    await repository.createAttachment(imageId, "user-2", randomUUID(), "галактика.png", "image/png", 10, "a".repeat(64));
    await repository.createMessage(randomUUID(), channel.id, "user-2", "", [imageId]);

    const videoId = randomUUID();
    await repository.createAttachment(videoId, "user-1", randomUUID(), "демо.mp4", "video/mp4", 20, "b".repeat(64));
    await repository.createMessage(randomUUID(), secondChannel.id, "user-1", "Космическое видео", [videoId]);

    const fileId = randomUUID();
    await repository.createAttachment(fileId, "user-1", randomUUID(), "отчёт.pdf", "application/pdf", 30, "c".repeat(64));
    await repository.createMessage(randomUUID(), channel.id, "user-1", "", [fileId]);

    const images = await repository.searchMessages({ query: "галактика", authorId: null, channelId: null, contentTypes: ["image"], offset: 0, limit: 25 });
    expect(images).toMatchObject({ total: 1, offset: 0, hasMore: false });
    expect(images.messages[0]?.attachments[0]?.fileName).toBe("галактика.png");

    const authoredTextAndVideo = await repository.searchMessages({ query: "кос", authorId: "user-1", channelId: null, contentTypes: ["text", "video"], offset: 0, limit: 1 });
    expect(authoredTextAndVideo.total).toBe(2);
    expect(authoredTextAndVideo.messages).toHaveLength(1);
    expect(authoredTextAndVideo.hasMore).toBe(true);

    const filesInChannel = await repository.searchMessages({ query: "", authorId: null, channelId: channel.id, contentTypes: ["file"], offset: 0, limit: 25 });
    expect(filesInChannel.messages).toHaveLength(1);
    expect(filesInChannel.messages[0]?.attachments[0]?.fileName).toBe("отчёт.pdf");
  });

  it("updates channels and deletes their message history", async () => {
    const created = await repository.createChannel(randomUUID(), "черновик", "text", "Старое описание");
    expect(await repository.updateChannel(created.id, "анонсы", "Новое описание", null)).toMatchObject({ name: "анонсы", description: "Новое описание", kind: "text", participantLimit: null });
    await repository.upsertUser("user-1", "public-key", { displayName: "Лина", avatar: null });
    await repository.createMessage(randomUUID(), created.id, "user-1", "Будет удалено вместе с каналом");
    expect(await repository.deleteChannel(created.id)).toBe(true);
    expect(await repository.deleteChannel(created.id)).toBe(false);
    expect(await repository.getHistory(created.id, 50)).toEqual([]);
  });

  it("persists finite and unlimited voice channel capacity", async () => {
    const created = await repository.createChannel(randomUUID(), "Гостиная", "voice", "Голосовой канал");
    expect(created.participantLimit).toBe(25);
    expect(await repository.updateChannel(created.id, created.name, created.description, 7)).toMatchObject({ participantLimit: 7 });
    expect(await repository.updateChannel(created.id, created.name, created.description, 0)).toMatchObject({ participantLimit: 0 });
    expect((await repository.getServer()).channels.find((channel) => channel.id === created.id)).toMatchObject({ participantLimit: 0 });
  });

  it("recovers when the voice limit migration was applied without its migration record", async () => {
    await database.query("DELETE FROM schema_migrations WHERE id = $1", ["009_voice_channel_participant_limit"]);
    await runMigrations(database);
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["009_voice_channel_participant_limit"])).toHaveLength(1);
    expect((await repository.getServer()).channels.find((channel) => channel.kind === "voice")?.participantLimit).toBe(25);
  });

  it("creates one configured owner and persists administrative roles", async () => {
    await repository.upsertUser("owner", "owner-public-key", { displayName: "Владелец", avatar: null });
    await repository.upsertUser("member", "member-public-key", { displayName: "Участник", avatar: null });
    expect(await repository.ensureMembership("owner", "owner-public-key", "owner-public-key")).toBe("owner");
    expect(await repository.ensureMembership("member", "member-public-key", "owner-public-key")).toBe("member");
    expect(permissionsForRole("owner")).toEqual(["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "KICK_MEMBERS", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"]);
    expect(permissionsForRole("administrator")).toContain("MANAGE_MESSAGES");
    expect(permissionsForRole("administrator")).toContain("KICK_MEMBERS");
    expect(await repository.setMemberRole("member", "administrator")).toBe("updated");
    expect((await repository.listMembers(new Map())).find((member) => member.id === "member")?.role).toBe("administrator");
    expect(await repository.setMemberRole("owner", "member")).toBe("owner");
  });

  it("updates a profile in place and clears its public media when a member leaves", async () => {
    const avatar = "data:image/webp;base64,AA==";
    const banner = "data:image/webp;base64,AQ==";
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["012_user_profile_bio"])).toHaveLength(1);
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["013_user_profile_banner"])).toHaveLength(1);
    await repository.upsertUser("member", "member-public-key", { displayName: "Участник", avatar: null });
    await repository.ensureMembership("member", "member-public-key", undefined, true);
    expect(await repository.updateUserProfile("member", { displayName: "Новое имя", bio: "Описание для всех", avatar, banner })).toBe(true);
    expect(await repository.getMember("member", "dnd")).toMatchObject({ displayName: "Новое имя", bio: "Описание для всех", avatar, banner, status: "dnd" });
    expect(await repository.leaveServer("member")).toBe("owner");
    expect(await repository.getMember("member", "offline")).toMatchObject({ bio: "", avatar: null, banner: null, role: "owner" });

    await repository.upsertUser("second", "second-public-key", { displayName: "Второй", avatar });
    await repository.ensureMembership("second", "second-public-key");
    expect(await repository.leaveServer("second")).toBe("member");
    expect((await repository.listMembers(new Map())).some((member) => member.id === "second")).toBe(false);
  });

  it("keeps a deletion tombstone across restarts and clears it for a new deployment", async () => {
    const firstDeployment = randomUUID();
    await repository.configureServer("Первая версия", firstDeployment);
    await repository.markServerDeleted();
    expect(await repository.isServerDeleted()).toBe(true);
    await repository.configureServer("Перезапуск", firstDeployment);
    expect(await repository.isServerDeleted()).toBe(true);
    await repository.configureServer("Новая версия", randomUUID());
    expect(await repository.isServerDeleted()).toBe(false);
    expect((await repository.getServer()).name).toBe("Новая версия");
  });

  it("persists a shared server avatar", async () => {
    const avatar = "data:image/png;base64,AA==";
    await repository.updateServerAvatar(avatar);
    expect((await repository.getServer()).avatar).toBe(avatar);
    await repository.updateServerAvatar(null);
    expect((await repository.getServer()).avatar).toBeNull();
  });
});
