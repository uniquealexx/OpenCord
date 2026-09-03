import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGliteDatabase } from "../src/database/database";
import { DEFAULT_SERVER_ID, runMigrations } from "../src/database/migrations";
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
  it("persists server name, description, attachment limit and screen-share limits", async () => {
    expect(await repository.getServer()).toMatchObject({ name: "OpenCord Local", description: "", maxAttachmentBytes: 10 * 1024 * 1024, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 });
    await repository.updateServerSettings({ name: "Команда", description: "Сервер команды", maxAttachmentBytes: 2000 * 1024 * 1024, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    expect(await repository.getServer()).toMatchObject({ name: "Команда", description: "Сервер команды", maxAttachmentBytes: 2000 * 1024 * 1024, screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 });
    await repository.updateServerSettings({ name: "Команда без лимита", maxAttachmentBytes: null, screenShareMaxResolution: 480, screenShareMaxFrameRate: 15 });
    expect(await repository.getServer()).toMatchObject({ name: "Команда без лимита", maxAttachmentBytes: null, screenShareMaxResolution: 480, screenShareMaxFrameRate: 15 });
    await repository.updateServerSettings({ name: "Источник", maxAttachmentBytes: null, screenShareMaxResolution: 1440, screenShareMaxFrameRate: 60 });
    expect(await repository.getServer()).toMatchObject({ name: "Источник", screenShareMaxResolution: 1440, screenShareMaxFrameRate: 60 });
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
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    const messageId = randomUUID();
    const created = await repository.createMessage(messageId, channel!.id, "user-1", "Первое настоящее сообщение");
    expect(created?.editedAt).toBeNull();
    const updated = await repository.updateMessage(messageId, "user-1", "Исправленное сообщение");
    expect(updated?.message).toMatchObject({ id: messageId, content: "Исправленное сообщение" });
    expect(updated?.message.editedAt).toBeTruthy();
    expect(await repository.getHistory(channel!.id, 50, "user-1")).toEqual([updated?.message]);
    expect(await repository.deleteMessage(messageId, "user-1", false)).toMatchObject({ channelId: channel!.id });
    expect(await repository.getHistory(channel!.id, 50, "user-1")).toEqual([]);
  });

  it("stores reply references and clears them when the source message is deleted", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    const sourceId = randomUUID();
    const replyId = randomUUID();
    await repository.createMessage(sourceId, channel.id, "user-1", "Исходное сообщение");
    const reply = await repository.createMessage(replyId, channel.id, "user-1", "Ответ", [], [], "chat", null, false, sourceId);
    expect(reply).toMatchObject({ id: replyId, replyToMessageId: sourceId });
    expect(await repository.canReplyToMessage(sourceId, channel.id, "user-1")).toBe(true);

    await repository.deleteMessage(sourceId, "user-1", false);
    expect(await repository.getHistory(channel.id, 50, "user-1")).toEqual([expect.objectContaining({ id: replyId, replyToMessageId: null })]);
  });

  it("replaces message attachments and returns removed storage keys", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
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

  it("hides and purges reactions that are not a single emoji", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    const messageId = randomUUID();
    await repository.createMessage(messageId, channel.id, "user-1", "Сообщение с реакциями");
    await repository.toggleReaction(messageId, "user-1", "👍");

    // Мусор, сохранённый до строгой проверки: пишем в обход репозитория.
    await database.query(
      "INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3), ($1, $2, $4)",
      [messageId, "user-1", "a̶̡̜̽͊", "‮работа"],
    );

    // На чтении мусор не доходит до клиента, даже пока лежит в базе.
    const [visible] = await repository.getHistory(channel.id, 50, "user-1");
    expect(visible?.reactions).toEqual([{ emoji: "👍", userIds: ["user-1"] }]);

    expect(await repository.purgeInvalidReactions()).toBe(2);
    expect(await repository.purgeInvalidReactions()).toBe(0);
    const remaining = await database.query<{ emoji: string }>("SELECT emoji FROM message_reactions");
    expect(remaining).toEqual([{ emoji: "👍" }]);
  });

  it("keeps private message attachments away from members outside the conversation", async () => {
    const channel = (await repository.getServer()).channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("sender", "sender-key", { username: "sender", discriminator: "1111", avatar: null });
    await repository.upsertUser("recipient", "recipient-key", { username: "recipient", discriminator: "2222", avatar: null });
    await repository.upsertUser("stranger", "stranger-key", { username: "stranger", discriminator: "3333", avatar: null });

    const privateFile = randomUUID();
    await repository.createAttachment(privateFile, "sender", "private-storage-key", "личное.txt", "text/plain", 10, "a".repeat(64));
    await repository.createMessage(randomUUID(), channel.id, "sender", "Только для тебя", [privateFile], [], "pm", "recipient");

    // Участники переписки файл получают, посторонний — нет, даже зная идентификатор.
    expect(await repository.getAccessibleAttachment(privateFile, "sender")).toMatchObject({ id: privateFile });
    expect(await repository.getAccessibleAttachment(privateFile, "recipient")).toMatchObject({ id: privateFile });
    expect(await repository.getAccessibleAttachment(privateFile, "stranger")).toBeNull();

    // Анонимное личное сообщение: отправитель скрыт от получателя, но файл ему доступен.
    const anonymousFile = randomUUID();
    await repository.createAttachment(anonymousFile, "sender", "anonymous-storage-key", "аноним.txt", "text/plain", 10, "b".repeat(64));
    await repository.createMessage(randomUUID(), channel.id, "sender", "Аноним", [anonymousFile], [], "apm", "recipient", true);
    expect(await repository.getAccessibleAttachment(anonymousFile, "recipient")).toMatchObject({ id: anonymousFile });
    expect(await repository.getAccessibleAttachment(anonymousFile, "stranger")).toBeNull();

    // Вложение обычного сообщения остаётся общедоступным.
    const publicFile = randomUUID();
    await repository.createAttachment(publicFile, "sender", "public-storage-key", "общий.txt", "text/plain", 10, "c".repeat(64));
    await repository.createMessage(randomUUID(), channel.id, "sender", "Всем", [publicFile]);
    expect(await repository.getAccessibleAttachment(publicFile, "stranger")).toMatchObject({ id: publicFile });
  });

  it("searches server messages by query, author, channel and content type", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    const secondChannel = await repository.createChannel(randomUUID(), "поиск", "text", "Результаты поиска");
    await repository.upsertUser("user-1", "public-key-1", { username: "lina", discriminator: "1234", avatar: null });
    await repository.upsertUser("user-2", "public-key-2", { username: "mark", discriminator: "5678", avatar: null });
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
    expect(await repository.updateChannel(created.id, "анонсы", "Новое описание", null, 0)).toMatchObject({ name: "анонсы", description: "Новое описание", kind: "text", participantLimit: null });
    await repository.upsertUser("user-1", "public-key", { username: "lina", discriminator: "1234", avatar: null });
    await repository.createMessage(randomUUID(), created.id, "user-1", "Будет удалено вместе с каналом");
    expect(await repository.deleteChannel(created.id)).toBe(true);
    expect(await repository.deleteChannel(created.id)).toBe(false);
    expect(await repository.getHistory(created.id, 50, "user-1")).toEqual([]);
  });

  it("persists finite and unlimited voice channel capacity", async () => {
    const created = await repository.createChannel(randomUUID(), "Гостиная", "voice", "Голосовой канал");
    expect(created.participantLimit).toBe(25);
    expect(await repository.updateChannel(created.id, created.name, created.description, 7, 0)).toMatchObject({ participantLimit: 7 });
    expect(await repository.updateChannel(created.id, created.name, created.description, 0, 0)).toMatchObject({ participantLimit: 0 });
    expect((await repository.getServer()).channels.find((channel) => channel.id === created.id)).toMatchObject({ participantLimit: 0 });
  });

  it("recovers when the voice limit migration was applied without its migration record", async () => {
    await database.query("DELETE FROM schema_migrations WHERE id = $1", ["009_voice_channel_participant_limit"]);
    await runMigrations(database);
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["009_voice_channel_participant_limit"])).toHaveLength(1);
    expect((await repository.getServer()).channels.find((channel) => channel.kind === "voice")?.participantLimit).toBe(25);
  });

  it("creates one configured owner and persists administrative roles", async () => {
    await repository.upsertUser("owner", "owner-public-key", { username: "owner", discriminator: "0001", avatar: null });
    await repository.upsertUser("member", "member-public-key", { username: "member", discriminator: "0002", avatar: null });
    expect(await repository.ensureMembership("owner", "owner-public-key", "owner-public-key")).toBe("owner");
    expect(await repository.ensureMembership("member", "member-public-key", "owner-public-key")).toBe("member");
    expect(permissionsForRole("owner")).toEqual(["MANAGE_SERVER", "MANAGE_CHANNELS", "MANAGE_MESSAGES", "MANAGE_ROLES", "KICK_MEMBERS", "DELETE_SERVER", "VOICE_CONNECT", "VOICE_SPEAK", "VOICE_MODERATE"]);
    expect(permissionsForRole("administrator")).toContain("MANAGE_MESSAGES");
    expect(permissionsForRole("administrator")).toContain("KICK_MEMBERS");
    expect(await repository.setMemberRole("member", "administrator")).toBe("updated");
    expect((await repository.listMembers(new Map())).find((member) => member.id === "member")?.role).toBe("administrator");
    expect(await repository.setMemberRole("owner", "member")).toBe("owner");
  });

  it("persists bans by identity and removes them explicitly", async () => {
    const ownerKey = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const memberKey = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    await repository.upsertUser("owner", ownerKey, { username: "owner", discriminator: "0001", avatar: null });
    await repository.upsertUser("member", memberKey, { username: "member", discriminator: "0002", avatar: null });
    await repository.ensureMembership("owner", ownerKey, ownerKey);
    await repository.ensureMembership("member", memberKey, ownerKey);

    expect(await repository.banMember("member", "owner", 30)).toBe(true);
    expect(await repository.findActiveBan("member")).toEqual({ expiresAt: expect.any(String) });
    expect((await repository.listBannedMembers())[0]).toMatchObject({ id: "member", bannedBy: "owner", expiresAt: expect.any(String) });
    await expect(repository.getMemberRole("member")).rejects.toThrow("Server membership is missing");
    await database.query("UPDATE server_bans SET expires_at = now() - interval '1 second' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "member"]);
    expect(await repository.findActiveBan("member")).toBeNull();
    expect(await repository.listBannedMembers()).toEqual([]);

    await repository.ensureMembership("member", memberKey, ownerKey);
    expect(await repository.banMember("member", "owner", null)).toBe(true);
    expect(await repository.findActiveBan("member")).toEqual({ expiresAt: null });
    expect((await repository.listBannedMembers())[0]).toMatchObject({ id: "member", expiresAt: null });
    expect(await repository.unbanMember("member")).toBe(true);
    expect(await repository.findActiveBan("member")).toBeNull();
    expect(await repository.listBannedMembers()).toEqual([]);
  });

  it("stores and returns the server banner", async () => {
    const banner = "data:image/webp;base64,AQ==";
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["018_server_banner"])).toHaveLength(1);
    expect((await repository.getServer()).banner).toBeNull();
    await repository.updateServerBanner(banner);
    expect((await repository.getServer()).banner).toBe(banner);
    await repository.updateServerBanner(null);
    expect((await repository.getServer()).banner).toBeNull();
  });

  it("retains a departed profile for seven days, then anonymizes it while preserving the key", async () => {
    const avatar = "data:image/webp;base64,AA==";
    const banner = "data:image/webp;base64,AQ==";
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["012_user_profile_bio"])).toHaveLength(1);
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["013_user_profile_banner"])).toHaveLength(1);
    await repository.upsertUser("member", "member-public-key", { username: "member", discriminator: "1234", avatar: null });
    await repository.ensureMembership("member", "member-public-key", undefined, true);
    expect(await repository.updateUserProfile("member", { username: "member", discriminator: "1234", bio: "Описание для всех", avatar, banner, customStatus: "Пишу релиз", customStatusEmoji: "🚀" })).toBe(true);
    expect(await repository.getMember("member", "dnd")).toMatchObject({ username: "member", discriminator: "1234", bio: "Описание для всех", avatar, banner, status: "dnd", customStatus: "Пишу релиз", customStatusEmoji: "🚀" });
    expect(await repository.leaveServer("member")).toBe("owner");
    expect(await repository.getMember("member", "offline")).toMatchObject({ bio: "Описание для всех", avatar, banner, role: "owner" });

    await repository.upsertUser("second", "second-public-key", { username: "second", discriminator: "9999", avatar });
    await repository.ensureMembership("second", "second-public-key");
    const textChannel = (await repository.getServer()).channels.find((channel) => channel.kind === "text");
    if (!textChannel) throw new Error("Text channel is missing");
    await repository.createMessage(randomUUID(), textChannel.id, "second", "Сообщение остаётся");
    expect(await repository.leaveServer("second")).toBe("member");
    expect((await repository.listMembers(new Map())).some((member) => member.id === "second")).toBe(false);
    expect((await database.query<{ display_name: string; avatar: string | null }>("SELECT display_name, avatar FROM users WHERE id = $1", ["second"]))[0]).toMatchObject({ display_name: "second", avatar });
    expect((await repository.getHistory(textChannel.id, 10, "member"))[0]).toMatchObject({ authorName: "second", authorAvatar: avatar, content: "Сообщение остаётся" });
    expect(await database.query<{ reason: string }>("SELECT reason FROM server_departures WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "second"])).toEqual([{ reason: "leave" }]);

    await database.query("UPDATE server_departures SET anonymize_after = now() - interval '1 second' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "second"]);
    expect(await repository.performRetentionCleanup()).toEqual({ anonymizedUserIds: ["second"], expiredBanUserIds: [] });
    expect((await database.query<{ public_key: string; display_name: string; username: string | null; avatar: string | null }>("SELECT public_key, display_name, username, avatar FROM users WHERE id = $1", ["second"]))[0]).toEqual({ public_key: "second-public-key", display_name: "unknown", username: null, avatar: null });
    expect((await repository.getHistory(textChannel.id, 10, "member"))[0]).toMatchObject({ authorId: "second", authorName: "unknown", authorAvatar: null, content: "Сообщение остаётся" });

    await repository.upsertUser("second", "second-public-key", { username: "second", discriminator: "9999", avatar });
    await repository.ensureMembership("second", "second-public-key");
    expect(await repository.getMember("second", "online")).toMatchObject({ avatar });
    expect(await database.query("SELECT user_id FROM server_departures WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "second"])).toEqual([]);
  });

  it("stores the profile accent color and clears it on anonymization", async () => {
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["029_user_profile_accent_color"])).toHaveLength(1);
    await repository.upsertUser("member", "member-public-key", { username: "member", discriminator: "1234", avatar: null });
    await repository.ensureMembership("member", "member-public-key", undefined, true);
    expect((await repository.getMember("member", "online")).accentColor).toBeNull();

    expect(await repository.updateUserProfile("member", { username: "member", discriminator: "1234", avatar: null, accentColor: "#7c3aed" })).toBe(true);
    expect(await repository.getMember("member", "online")).toMatchObject({ accentColor: "#7c3aed" });

    // SQL-ограничение держит формат даже при записи в обход Zod на границе протокола.
    await expect(database.query("UPDATE users SET accent_color = $2 WHERE id = $1", ["member", "violet"])).rejects.toThrow();
    await expect(database.query("UPDATE users SET accent_color = $2 WHERE id = $1", ["member", "#7C3AED"])).rejects.toThrow();

    // Цвет очищается и повторной установкой, и анонимизацией ушедшего профиля.
    expect(await repository.updateUserProfile("member", { username: "member", discriminator: "1234", avatar: null, accentColor: null })).toBe(true);
    expect((await repository.getMember("member", "online")).accentColor).toBeNull();

    await repository.upsertUser("leaver", "leaver-public-key", { username: "leaver", discriminator: "4321", avatar: null, accentColor: "#4d6bfe" });
    await repository.ensureMembership("leaver", "leaver-public-key");
    expect(await repository.leaveServer("leaver")).toBe("member");
    await database.query("UPDATE server_departures SET anonymize_after = now() - interval '1 second' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "leaver"]);
    await repository.performRetentionCleanup();
    expect((await database.query<{ accent_color: string | null }>("SELECT accent_color FROM users WHERE id = $1", ["leaver"]))[0]).toEqual({ accent_color: null });
  });

    it("stores the name glow and clears it on anonymization", async () => {

    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["030_user_profile_name_glow"])).toHaveLength(1);
    await repository.upsertUser("member", "member-public-key", { username: "member", discriminator: "1234", avatar: null });
    await repository.ensureMembership("member", "member-public-key", undefined, true);
    expect((await repository.getMember("member", "online")).nameGlow).toBeNull();

    expect(await repository.updateUserProfile("member", { username: "member", discriminator: "1234", avatar: null, nameGlow: "#34d399" })).toBe(true);
    expect(await repository.getMember("member", "online")).toMatchObject({ nameGlow: "#34d399" });

    // SQL-ограничение держит формат даже при записи в обход Zod на границе протокола.
    await expect(database.query("UPDATE users SET name_glow = $2 WHERE id = $1", ["member", "green"])).rejects.toThrow();
    await expect(database.query("UPDATE users SET name_glow = $2 WHERE id = $1", ["member", "#34D399"])).rejects.toThrow();

    await repository.upsertUser("leaver", "leaver-public-key", { username: "leaver", discriminator: "4321", avatar: null, nameGlow: "#58b0ff" });
    await repository.ensureMembership("leaver", "leaver-public-key");
    expect(await repository.leaveServer("leaver")).toBe("member");
    await database.query("UPDATE server_departures SET anonymize_after = now() - interval '1 second' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "leaver"]);
    await repository.performRetentionCleanup();
    expect((await database.query<{ name_glow: string | null }>("SELECT name_glow FROM users WHERE id = $1", ["leaver"]))[0]).toEqual({ name_glow: null });
  });

  it("stores the name font and resets it to the default on anonymization", async () => {
    expect(await database.query<{ id: string }>("SELECT id FROM schema_migrations WHERE id = $1", ["031_user_profile_name_font"])).toHaveLength(1);
    await repository.upsertUser("member", "member-public-key", { username: "member", discriminator: "1234", avatar: null });
    await repository.ensureMembership("member", "member-public-key", undefined, true);
    expect((await repository.getMember("member", "online")).nameFont).toBe("none");

    expect(await repository.updateUserProfile("member", { username: "member", discriminator: "1234", avatar: null, nameFont: "pixel" })).toBe(true);
    expect(await repository.getMember("member", "online")).toMatchObject({ nameFont: "pixel" });
    expect((await repository.listMembers(new Map())).find((member) => member.id === "member")).toMatchObject({ nameFont: "pixel" });

    // SQL-ограничение держит enum даже при записи в обход Zod на границе протокола.
    await expect(database.query("UPDATE users SET name_font = $2 WHERE id = $1", ["member", "comic"])).rejects.toThrow();

    await repository.upsertUser("leaver", "leaver-public-key", { username: "leaver", discriminator: "4321", avatar: null, nameFont: "gothic" });
    await repository.ensureMembership("leaver", "leaver-public-key");
    expect(await repository.leaveServer("leaver")).toBe("member");
    await database.query("UPDATE server_departures SET anonymize_after = now() - interval '1 second' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "leaver"]);
    await repository.performRetentionCleanup();
    expect((await database.query<{ name_font: string | null }>("SELECT name_font FROM users WHERE id = $1", ["leaver"]))[0]).toEqual({ name_font: "none" });
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

  it("keeps the username#discriminator tag unique when a second identity asks for a taken one", async () => {
    await repository.upsertUser("first", "first-public-key", { username: "twins", discriminator: "4242", avatar: null });
    await repository.upsertUser("second", "second-public-key", { username: "twins", discriminator: "4242", avatar: null });
    await repository.ensureMembership("first", "first-public-key", undefined, true);
    await repository.ensureMembership("second", "second-public-key");
    const members = await repository.listMembers(new Map());
    expect(members).toHaveLength(2);
    const first = members.find((member) => member.id === "first");
    const second = members.find((member) => member.id === "second");
    // Тег занявшего его первым не меняется, второму сервер выдаёт свободный дискриминатор.
    expect(first).toMatchObject({ username: "twins", discriminator: "4242" });
    expect(second).toMatchObject({ username: "twins" });
    expect(second!.discriminator).toMatch(/^[0-9]{4}$/u);
    expect(second!.discriminator).not.toBe("4242");
    expect(first!.fingerprint).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/u);
    expect(first!.fingerprint).not.toBe(second!.fingerprint);
  });

  it("binds the discriminator to the identity: neither reconnect nor profile update can change it", async () => {
    await repository.upsertUser("owner", "owner-public-key", { username: "target", discriminator: "4242", avatar: null });
    await repository.upsertUser("impostor", "impostor-public-key", { username: "impostor", discriminator: "1111", avatar: null });
    await repository.ensureMembership("owner", "owner-public-key", undefined, true);
    await repository.ensureMembership("impostor", "impostor-public-key");

    // Попытка забрать чужой тег через profile.update: username повторить можно, дискриминатор — нет.
    expect(await repository.updateUserProfile("impostor", { username: "target", discriminator: "4242", avatar: null })).toBe(true);
    // Попытка сменить свой дискриминатор при повторной аутентификации.
    await repository.upsertUser("impostor", "impostor-public-key", { username: "target", discriminator: "4242", avatar: null });

    const members = await repository.listMembers(new Map());
    const owner = members.find((member) => member.id === "owner");
    const impostor = members.find((member) => member.id === "impostor");
    expect(owner).toMatchObject({ username: "target", discriminator: "4242" });
    expect(impostor).toMatchObject({ username: "target" });
    expect(impostor!.discriminator).not.toBe("4242");
  });

  it("stores only member mentions, deduplicates them and replaces them on edit", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("author", "author-key", { username: "author", discriminator: "1111", avatar: null });
    await repository.upsertUser("mentioned", "mentioned-key", { username: "mentioned", discriminator: "2222", avatar: null });
    await repository.upsertUser("outsider", "outsider-key", { username: "outsider", discriminator: "3333", avatar: null });
    await repository.ensureMembership("author", "author-key", undefined, true);
    await repository.ensureMembership("mentioned", "mentioned-key");

    const messageId = randomUUID();
    const created = await repository.createMessage(messageId, channel.id, "author", "Привет <@mentioned>!", [], ["mentioned", "mentioned", "outsider"]);
    expect(created?.mentions).toEqual([{ userId: "mentioned" }]);

    const history = await repository.getHistory(channel.id, 50, "author");
    expect(history[0]?.mentions).toEqual([{ userId: "mentioned" }]);

    const updated = await repository.updateMessage(messageId, "author", "Привет всем!", [], ["author"]);
    expect(updated?.message.mentions).toEqual([{ userId: "author" }]);
    expect((await repository.getHistory(channel.id, 50, "author"))[0]?.mentions).toEqual([{ userId: "author" }]);

    const search = await repository.searchMessages({ query: "Привет", authorId: "author", channelId: null, contentTypes: ["text"], offset: 0, limit: 25 });
    expect(search.messages[0]?.mentions).toEqual([{ userId: "author" }]);
  });

  it("toggles message reactions, keeps order and returns them in history", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("author", "author-key", { username: "author", discriminator: "1111", avatar: null });
    await repository.upsertUser("reactor", "reactor-key", { username: "reactor", discriminator: "2222", avatar: null });
    await repository.ensureMembership("author", "author-key", undefined, true);
    await repository.ensureMembership("reactor", "reactor-key");

    const messageId = randomUUID();
    const created = await repository.createMessage(messageId, channel.id, "author", "Сообщение для реакций");
    expect(created?.reactions).toEqual([]);

    const added = await repository.toggleReaction(messageId, "author", "👍");
    expect(added).toEqual([{ emoji: "👍", userIds: ["author"] }]);
    const joined = await repository.toggleReaction(messageId, "reactor", "👍");
    expect(joined).toEqual([{ emoji: "👍", userIds: ["author", "reactor"] }]);
    const another = await repository.toggleReaction(messageId, "reactor", "❤️");
    expect(another).toEqual([{ emoji: "👍", userIds: ["author", "reactor"] }, { emoji: "❤️", userIds: ["reactor"] }]);

    const history = await repository.getHistory(channel.id, 50, "author");
    expect(history[0]?.reactions).toEqual(another);

    const removed = await repository.toggleReaction(messageId, "author", "👍");
    expect(removed).toEqual([{ emoji: "👍", userIds: ["reactor"] }, { emoji: "❤️", userIds: ["reactor"] }]);
    expect((await repository.getHistory(channel.id, 50, "author"))[0]?.reactions).toEqual(removed);

    const search = await repository.searchMessages({ query: "реакций", authorId: "author", channelId: null, contentTypes: ["text"], offset: 0, limit: 25 });
    expect(search.messages[0]?.reactions).toEqual(removed);

    expect(await repository.toggleReaction(randomUUID(), "author", "👍")).toBeNull();
  });

  it("stores private messages, filters history by participant and masks anonymous senders", async () => {
    const server = await repository.getServer();
    const channel = server.channels.find((item) => item.kind === "text")!;
    await repository.upsertUser("sender", "sender-key", { username: "sender", discriminator: "1111", avatar: null });
    await repository.upsertUser("receiver", "receiver-key", { username: "receiver", discriminator: "2222", avatar: null });
    await repository.upsertUser("outsider", "outsider-key", { username: "outsider", discriminator: "3333", avatar: null });
    await repository.ensureMembership("sender", "sender-key", undefined, true);
    await repository.ensureMembership("receiver", "receiver-key");
    await repository.ensureMembership("outsider", "outsider-key");

    const pm = await repository.createMessage(randomUUID(), channel.id, "sender", "Личное", [], [], "pm", "receiver", false);
    expect(pm).toMatchObject({ kind: "pm", targetUserId: "receiver", anonymous: false });
    const apm = await repository.createMessage(randomUUID(), channel.id, "sender", "Секрет", [], [], "apm", "receiver", true);
    expect(apm).toMatchObject({ kind: "apm", anonymous: true });

    const forReceiver = await repository.getHistory(channel.id, 50, "receiver");
    expect(forReceiver.map((message) => message.id)).toEqual([pm!.id, apm!.id]);
    const masked = forReceiver.find((message) => message.id === apm!.id)!;
    expect(masked.authorId).not.toBe("sender");
    expect(masked.authorName).toBe("Аноним");
    expect(masked.authorAvatar).toBeNull();
    expect(forReceiver.find((message) => message.id === pm!.id)?.authorName).toBe("sender");

    const forSender = await repository.getHistory(channel.id, 50, "sender");
    expect(forSender.find((message) => message.id === apm!.id)?.authorId).toBe("sender");

    expect(await repository.getHistory(channel.id, 50, "outsider")).toEqual([]);

    const search = await repository.searchMessages({ query: "", authorId: null, channelId: channel.id, contentTypes: ["text"], offset: 0, limit: 25 });
    expect(search.messages.map((message) => message.id)).not.toContain(pm!.id);
    expect(search.messages.map((message) => message.id)).not.toContain(apm!.id);
  });

  it("mutes and unmutes chat for a member and exposes the state in the member list", async () => {
    await repository.upsertUser("owner", "owner-key", { username: "owner", discriminator: "1111", avatar: null });
    await repository.upsertUser("member", "member-key", { username: "member", discriminator: "2222", avatar: null });
    await repository.ensureMembership("owner", "owner-key", undefined, true);
    await repository.ensureMembership("member", "member-key");

    expect(await repository.isChatMuted("member")).toBe(false);
    expect(await repository.setChatMuted("member", true)).toBe(true);
    expect(await repository.isChatMuted("member")).toBe(true);
    expect((await repository.listMembers(new Map())).find((item) => item.id === "member")?.chatMuted).toBe(true);
    expect(await repository.setChatMuted("member", false)).toBe(true);
    expect(await repository.isChatMuted("member")).toBe(false);
    expect(await repository.setChatMuted("missing", true)).toBe(false);
  });

  it("persists a voice mute independently of the chat mute and of voice presence", async () => {
    await repository.upsertUser("member", "member-key", { username: "member", discriminator: "2222", avatar: null });
    await repository.ensureMembership("member", "member-key");

    expect(await repository.isVoiceMuted("member")).toBe(false);
    expect(await repository.setVoiceMuted("member", true)).toBe(true);
    expect(await repository.isVoiceMuted("member")).toBe(true);
    // Голосовой мут — отдельное состояние: он не должен затрагивать текстовый чат.
    expect(await repository.isChatMuted("member")).toBe(false);

    expect(await repository.setVoiceMuted("member", false)).toBe(true);
    expect(await repository.isVoiceMuted("member")).toBe(false);
    expect(await repository.setVoiceMuted("missing", true)).toBe(false);
    expect(await repository.isVoiceMuted("missing")).toBe(false);
  });

  it("applies a mute duration, exposes the expiry and lazily clears an expired mute", async () => {
    await repository.upsertUser("owner", "owner-key", { username: "owner", discriminator: "1111", avatar: null });
    await repository.upsertUser("member", "member-key", { username: "member", discriminator: "2222", avatar: null });
    await repository.ensureMembership("owner", "owner-key", undefined, true);
    await repository.ensureMembership("member", "member-key");

    expect(await repository.setChatMuted("member", true, 30)).toBe(true);
    expect(await repository.isChatMuted("member")).toBe(true);
    const listed = (await repository.listMembers(new Map())).find((item) => item.id === "member");
    expect(listed?.chatMuted).toBe(true);
    expect(listed?.chatMutedUntil).toBeTruthy();
    expect(new Date(listed!.chatMutedUntil!).getTime()).toBeGreaterThan(Date.now());

    // Искусственно истекаем срок: проверка лениво снимает мут.
    await database.query("UPDATE server_members SET chat_muted_until = now() - interval '1 minute' WHERE server_id = $1 AND user_id = $2", [DEFAULT_SERVER_ID, "member"]);
    expect(await repository.isChatMuted("member")).toBe(false);
    expect((await repository.listMembers(new Map())).find((item) => item.id === "member")?.chatMuted).toBe(false);
  });
});
