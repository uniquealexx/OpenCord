import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMIT_MAX_BYTES, isReactionEmoji, stripBidiControls, MEBIBYTE, PROTOCOL_VERSION, USER_AVATAR_MAX_BYTES, USER_BANNER_MAX_BYTES, buildMentionToken, chatMessageSchema, clientEventSchema, discriminatorSchema, fingerprintSchema, messageReactionSchema, parseMentionTokens, publicKeyFingerprint, publicProfileSchema, serverBannerSchema, serverEventSchema, userAvatarSchema, userBannerSchema, userMemberBackgroundSchema, usernameSchema } from "../src";

describe("OpenCord protocol", () => {
  it("accepts a valid ping", () => {
    expect(clientEventSchema.parse({ type: "ping", requestId: crypto.randomUUID() })).toMatchObject({ type: "ping" });
  });

  it("rejects unknown client events", () => {
    expect(() => clientEventSchema.parse({ type: "admin.everything" })).toThrow();
  });

  it("requires the current protocol version during auth", () => {
    const event = { type: "auth.challenge", requestId: crypto.randomUUID(), protocolVersion: PROTOCOL_VERSION, challenge: "abc", expiresAt: new Date().toISOString() };
    expect(serverEventSchema.parse(event)).toEqual(event);
    expect(() => serverEventSchema.parse({ ...event, protocolVersion: 999 })).toThrow();
  });

  it("accepts only compact WebP user avatars", () => {
    expect(userAvatarSchema.parse("data:image/webp;base64,AA==")).toBe("data:image/webp;base64,AA==");
    expect(() => userAvatarSchema.parse("data:image/png;base64,AA==")).toThrow();
    expect(() => userAvatarSchema.parse(`data:image/webp;base64,${"A".repeat(Math.ceil(USER_AVATAR_MAX_BYTES / 3) * 4 + 33)}`)).toThrow();
  });

  it("validates role administration and channel management events", () => {
    expect(clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "новости", kind: "text", description: "Обновления" })).toMatchObject({ type: "channel.create", participantLimit: null });
    expect(clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "Гостиная", kind: "voice", description: "", participantLimit: 7 })).toMatchObject({ participantLimit: 7 });
    expect(clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "Гостиная", kind: "voice", description: "", participantLimit: 0 })).toMatchObject({ participantLimit: 0 });
    expect(() => clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "Гостиная", kind: "voice", description: "", participantLimit: 26 })).toThrow();
    const channelId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "анонсы", description: "Важное", participantLimit: null })).toMatchObject({ type: "channel.update", channelId });
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 25 })).toMatchObject({ participantLimit: 25 });
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 0 })).toMatchObject({ participantLimit: 0 });
    expect(() => clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 26 })).toThrow();
    expect(clientEventSchema.parse({ type: "channel.delete", requestId: crypto.randomUUID(), channelId })).toMatchObject({ type: "channel.delete", channelId });
    expect(clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "administrator" })).toMatchObject({ role: "administrator" });
    expect(clientEventSchema.parse({ type: "member.kick", requestId: crypto.randomUUID(), userId: "member-1" })).toMatchObject({ type: "member.kick", userId: "member-1" });
    expect(clientEventSchema.parse({ type: "member.ban", requestId: crypto.randomUUID(), userId: "member-1", durationMinutes: 30 })).toMatchObject({ type: "member.ban", userId: "member-1", durationMinutes: 30 });
    expect(clientEventSchema.parse({ type: "member.ban", requestId: crypto.randomUUID(), userId: "member-1", durationMinutes: null })).toMatchObject({ durationMinutes: null });
    expect(() => clientEventSchema.parse({ type: "member.ban", requestId: crypto.randomUUID(), userId: "member-1", durationMinutes: 15 })).toThrow();
    expect(clientEventSchema.parse({ type: "member.unban", requestId: crypto.randomUUID(), userId: "member-1" })).toMatchObject({ type: "member.unban", userId: "member-1" });
    expect(() => clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "owner" })).toThrow();
    expect(clientEventSchema.parse({ type: "server.delete", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.delete" });
    expect(serverEventSchema.parse({ type: "server.deleted", serverId: crypto.randomUUID() })).toMatchObject({ type: "server.deleted" });
    expect(clientEventSchema.parse({ type: "server.avatar.update", requestId: crypto.randomUUID(), avatar: "data:image/png;base64,AA==" })).toMatchObject({ type: "server.avatar.update" });
    expect(serverEventSchema.parse({ type: "server.avatar.updated", serverId: crypto.randomUUID(), avatar: "data:image/webp;base64,AA==" })).toMatchObject({ type: "server.avatar.updated" });
    expect(clientEventSchema.parse({ type: "profile.update", requestId: crypto.randomUUID(), profile: { username: "lina", discriminator: "1234", avatar: "data:image/webp;base64,AA==" } })).toMatchObject({ type: "profile.update" });
    expect(clientEventSchema.parse({ type: "server.leave", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.leave" });
    expect(serverEventSchema.parse({ type: "member.removed", userId: "member-1" })).toEqual({ type: "member.removed", userId: "member-1" });
    expect(serverEventSchema.parse({ type: "profile.anonymized", userId: "member-1" })).toEqual({ type: "profile.anonymized", userId: "member-1" });
  });

  it("validates voice mute and deafen state synchronization", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const participant = { userId: "voice-member", channelId, muted: true, deafened: false, serverMuted: true, viewingScreenShareUserId: "screen-owner" };
    expect(clientEventSchema.parse({ type: "voice.state.update", requestId, muted: true, deafened: false, viewingScreenShareUserId: "screen-owner" })).toMatchObject({ muted: true, deafened: false, viewingScreenShareUserId: "screen-owner" });
    expect(clientEventSchema.parse({ type: "voice.member.mute", requestId, userId: "voice-member", muted: true })).toMatchObject({ userId: "voice-member", muted: true });
    expect(serverEventSchema.parse({ type: "voice.participant.updated", participant })).toEqual({ type: "voice.participant.updated", participant });
    expect(clientEventSchema.parse({ type: "voice.state.update", requestId, muted: false, deafened: false, viewingScreenShareUserId: null })).toMatchObject({ viewingScreenShareUserId: null });
    expect(() => serverEventSchema.parse({ type: "voice.participant.updated", participant: { userId: "voice-member", channelId } })).toThrow();
  });

  it("limits message attachments and validates their metadata", () => {
    const attachmentId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "chat.send", requestId: crypto.randomUUID(), channelId: crypto.randomUUID(), content: "Файл", attachmentIds: [attachmentId] })).toMatchObject({ attachmentIds: [attachmentId] });
    expect(clientEventSchema.parse({ type: "chat.send", requestId: crypto.randomUUID(), channelId: crypto.randomUUID(), content: "", attachmentIds: [attachmentId] })).toMatchObject({ content: "", attachmentIds: [attachmentId] });
    expect(() => clientEventSchema.parse({ type: "chat.send", requestId: crypto.randomUUID(), channelId: crypto.randomUUID(), content: "", attachmentIds: [] })).toThrow();
    expect(() => clientEventSchema.parse({ type: "chat.send", requestId: crypto.randomUUID(), channelId: crypto.randomUUID(), content: "Слишком много", attachmentIds: Array.from({ length: 6 }, () => crypto.randomUUID()) })).toThrow();
    expect(serverEventSchema.parse({
      type: "message.created",
      message: { id: crypto.randomUUID(), channelId: crypto.randomUUID(), authorId: "user", authorName: "Лина", authorAvatar: null, content: "Файл", createdAt: new Date().toISOString(), attachments: [{ id: attachmentId, fileName: "план.pdf", mimeType: "application/pdf", sizeBytes: 1024, sha256: "a".repeat(64) }] },
    })).toMatchObject({ type: "message.created" });
  });

  it("validates message editing and deletion events", () => {
    const messageId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "message.update", requestId: crypto.randomUUID(), messageId, content: "Исправлено", attachmentIds: [attachmentId] })).toMatchObject({ type: "message.update", messageId, attachmentIds: [attachmentId] });
    expect(() => clientEventSchema.parse({ type: "message.update", requestId: crypto.randomUUID(), messageId, content: "", attachmentIds: [] })).toThrow();
    expect(() => clientEventSchema.parse({ type: "message.update", requestId: crypto.randomUUID(), messageId, content: "Файл", attachmentIds: [attachmentId, attachmentId] })).toThrow();
    expect(clientEventSchema.parse({ type: "message.delete", requestId: crypto.randomUUID(), messageId })).toMatchObject({ type: "message.delete", messageId });
    expect(serverEventSchema.parse({ type: "message.deleted", messageId, channelId })).toEqual({ type: "message.deleted", messageId, channelId });
  });

  it("validates message reply references", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const replyToMessageId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "chat.send", requestId, channelId, content: "Ответ", replyToMessageId })).toMatchObject({ replyToMessageId });
    expect(chatMessageSchema.parse({ id: crypto.randomUUID(), channelId, authorId: "user", authorName: "Лина", authorAvatar: null, content: "Ответ", createdAt: new Date().toISOString(), replyToMessageId })).toMatchObject({ replyToMessageId });
    expect(() => clientEventSchema.parse({ type: "chat.send", requestId, channelId, content: "Ответ", replyToMessageId: "not-a-uuid" })).toThrow();
  });

  it("validates message reactions and reaction toggle events", () => {
    const messageId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const reaction = { emoji: "👍", userIds: ["user-1", "user-2"] };
    expect(messageReactionSchema.parse(reaction)).toEqual(reaction);
    expect(() => messageReactionSchema.parse({ emoji: "x".repeat(33), userIds: [] })).toThrow();
    expect(() => messageReactionSchema.parse({ emoji: "", userIds: [] })).toThrow();
    expect(() => messageReactionSchema.parse({ emoji: "👍", userIds: Array.from({ length: 101 }, (_item, index) => `user-${index}`) })).toThrow();
    expect(clientEventSchema.parse({ type: "message.react", requestId: crypto.randomUUID(), messageId, emoji: "👍" })).toMatchObject({ type: "message.react", messageId, emoji: "👍" });
    expect(() => clientEventSchema.parse({ type: "message.react", requestId: crypto.randomUUID(), messageId, emoji: "" })).toThrow();
    expect(() => clientEventSchema.parse({ type: "message.react", requestId: crypto.randomUUID(), messageId, emoji: "x".repeat(33) })).toThrow();
    expect(serverEventSchema.parse({ type: "message.reactions.updated", messageId, channelId, reactions: [reaction] })).toEqual({ type: "message.reactions.updated", messageId, channelId, reactions: [reaction] });
    expect(chatMessageSchema.parse({ id: messageId, channelId, authorId: "user", authorName: "Лина", authorAvatar: null, content: "С реакцией", createdAt: new Date().toISOString(), reactions: [reaction] })).toMatchObject({ reactions: [reaction] });
    expect(chatMessageSchema.parse({ id: messageId, channelId, authorId: "user", authorName: "Лина", authorAvatar: null, content: "Без реакций", createdAt: new Date().toISOString() })).toMatchObject({ reactions: [] });
  });

  it("accepts only compact WebP user banners", () => {
    expect(userBannerSchema.parse("data:image/webp;base64,AA==")).toBe("data:image/webp;base64,AA==");
    expect(() => userBannerSchema.parse("data:image/jpeg;base64,AA==")).toThrow();
    expect(() => userBannerSchema.parse(`data:image/webp;base64,${"A".repeat(Math.ceil(USER_BANNER_MAX_BYTES / 3) * 4 + 33)}`)).toThrow();
  });

  it("accepts server banners in the same WebP format and defaults snapshots without one", () => {
    const banner = "data:image/webp;base64,AA==";
    expect(serverBannerSchema.parse(banner)).toBe(banner);
    expect(serverBannerSchema.parse(null)).toBeNull();
    expect(() => serverBannerSchema.parse("data:image/jpeg;base64,AA==")).toThrow();

    const base = {
      id: crypto.randomUUID(),
      name: "Команда",
      maxAttachmentBytes: null,
      screenShareMaxResolution: 1080,
      screenShareMaxFrameRate: 60,
      channels: [],
      members: [],
      currentUser: { id: "user", role: "owner", permissions: [] },
    };
    const snapshot = serverEventSchema.parse({ type: "server.snapshot", server: base });
    expect(snapshot.type === "server.snapshot" && snapshot.server.banner).toBeNull();
    const snapshotWithBanner = serverEventSchema.parse({ type: "server.snapshot", server: { ...base, banner } });
    expect(snapshotWithBanner.type === "server.snapshot" && snapshotWithBanner.server.banner).toBe(banner);

    expect(clientEventSchema.parse({ type: "server.banner.update", requestId: crypto.randomUUID(), banner })).toMatchObject({ type: "server.banner.update", banner });
    expect(serverEventSchema.parse({ type: "server.banner.updated", serverId: crypto.randomUUID(), banner })).toMatchObject({ type: "server.banner.updated", banner });
  });

  it("validates user presence and defaults older profiles to online", () => {
    const base = { username: "lina", discriminator: "1234" } as const;
    expect(publicProfileSchema.parse({ ...base, avatar: null })).toMatchObject({ status: "online", bio: "", banner: null, memberBackground: null });
    expect(publicProfileSchema.parse({ ...base, bio: "  Пишу открытый код  ", avatar: null, status: "invisible" })).toMatchObject({ status: "invisible", bio: "Пишу открытый код" });
    expect(() => publicProfileSchema.parse({ ...base, avatar: null, status: "offline" })).toThrow();
    expect(() => publicProfileSchema.parse({ ...base, bio: "x".repeat(161), avatar: null })).toThrow();
    expect(serverEventSchema.parse({ type: "member.updated", member: { id: "member", username: "lina", discriminator: "1234", fingerprint: "abcd-ef01-2345-6789", bio: "Пишу открытый код", avatar: null, banner: "data:image/webp;base64,AA==", status: "dnd", role: "member" } })).toMatchObject({ member: { status: "dnd", bio: "Пишу открытый код", banner: "data:image/webp;base64,AA==", memberBackground: null } });
  });

  it("validates the member list background in the banner format and defaults it to null", () => {
    expect(userMemberBackgroundSchema.parse("data:image/webp;base64,AA==")).toBe("data:image/webp;base64,AA==");
    expect(userMemberBackgroundSchema.parse(null)).toBeNull();
    expect(() => userMemberBackgroundSchema.parse("data:image/png;base64,AA==")).toThrow();
    const base = { username: "lina", discriminator: "1234", avatar: null } as const;
    expect(publicProfileSchema.parse({ ...base, memberBackground: "data:image/webp;base64,AA==" })).toMatchObject({ memberBackground: "data:image/webp;base64,AA==" });
    expect(() => publicProfileSchema.parse({ ...base, memberBackground: "data:image/png;base64,AA==" })).toThrow();
    expect(serverEventSchema.parse({ type: "member.updated", member: { id: "member", username: "lina", discriminator: "1234", fingerprint: "abcd-ef01-2345-6789", bio: "", avatar: null, banner: null, memberBackground: "data:image/webp;base64,AA==", status: "online", role: "member" } })).toMatchObject({ member: { memberBackground: "data:image/webp;base64,AA==" } });
  });

  it("validates custom status text, emoji and server description", () => {
    const base = { username: "lina", discriminator: "1234", avatar: null } as const;
    expect(publicProfileSchema.parse({ ...base, customStatus: "В работе", customStatusEmoji: "🚀" })).toMatchObject({ customStatus: "В работе", customStatusEmoji: "🚀" });
    expect(() => publicProfileSchema.parse({ ...base, customStatus: "x".repeat(33), customStatusEmoji: "🚀" })).toThrow();
    expect(() => publicProfileSchema.parse({ ...base, customStatusEmoji: "x".repeat(17) })).toThrow();
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId: crypto.randomUUID(), name: "OpenCord", description: "Сервер сообщества", maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 })).toMatchObject({ description: "Сервер сообщества" });
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId: crypto.randomUUID(), name: "OpenCord", description: "x".repeat(161), maxAttachmentBytes: null, screenShareMaxResolution: 1080, screenShareMaxFrameRate: 60 })).toThrow();
  });

  it("normalizes usernames and requires a four-digit discriminator", () => {
    expect(usernameSchema.parse("  LiNa_1.2-x ")).toBe("lina_1.2-x");
    expect(() => usernameSchema.parse("a")).toThrow();
    expect(() => usernameSchema.parse("Имя")).toThrow();
    expect(() => usernameSchema.parse("user name")).toThrow();
    expect(() => usernameSchema.parse("u".repeat(33))).toThrow();
    expect(discriminatorSchema.parse("0007")).toBe("0007");
    expect(() => discriminatorSchema.parse("123")).toThrow();
    expect(() => discriminatorSchema.parse("12345")).toThrow();
    expect(() => discriminatorSchema.parse("12a4")).toThrow();
    expect(fingerprintSchema.parse("abcd-ef01-2345-6789")).toBe("abcd-ef01-2345-6789");
    expect(() => fingerprintSchema.parse("abcd-ef01-2345")).toThrow();
    expect(() => fingerprintSchema.parse("abcd-ef01-2345-678g")).toThrow();
  });

  it("validates mentions on send and edit events", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "chat.send", requestId, channelId, content: `Привет ${buildMentionToken("user-1")}!`, mentions: ["user-1"] })).toMatchObject({ mentions: ["user-1"] });
    expect(clientEventSchema.parse({ type: "message.update", requestId, messageId, content: "Уточнение", mentions: ["user-2"] })).toMatchObject({ mentions: ["user-2"] });
    expect(() => clientEventSchema.parse({ type: "chat.send", requestId, channelId, content: "Дубль", mentions: ["user-1", "user-1"] })).toThrow();
    expect(() => clientEventSchema.parse({ type: "chat.send", requestId, channelId, content: "Слишком много", mentions: Array.from({ length: 21 }, (_item, index) => `user-${index}`) })).toThrow();
    expect(serverEventSchema.parse({
      type: "message.created",
      message: { id: crypto.randomUUID(), channelId: crypto.randomUUID(), authorId: "user", authorName: "Лина", authorAvatar: null, content: "Привет <@member-1>!", createdAt: new Date().toISOString(), mentions: [{ userId: "member-1" }] },
    })).toMatchObject({ type: "message.created" });
  });

  it("parses mention tokens and computes stable public key fingerprints", async () => {
    expect(parseMentionTokens(`<@user-1> и <@a_b> снова <@user-1> и текст <@9>`)).toEqual(["user-1", "a_b", "9"]);
    expect(parseMentionTokens("без упоминаний")).toEqual([]);
    const publicKey = "T3BlbkNvcmQgcHVibGljIGtleQ=="; // "OpenCord public key" в base64
    expect(await publicKeyFingerprint(publicKey)).toMatch(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/u);
    expect(await publicKeyFingerprint(publicKey)).toBe(await publicKeyFingerprint(publicKey));
  });

  it("validates private messages and chat mute events", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "chat.pm", requestId, channelId, content: "Привет", targetUserId: "user-1" })).toMatchObject({ type: "chat.pm", targetUserId: "user-1" });
    expect(clientEventSchema.parse({ type: "chat.apm", requestId, channelId, content: "Секрет", targetUserId: "user-1" })).toMatchObject({ type: "chat.apm" });
    expect(() => clientEventSchema.parse({ type: "chat.pm", requestId, channelId, content: "  ", targetUserId: "user-1" })).toThrow();
    expect(clientEventSchema.parse({ type: "chat.mute.set", requestId, userId: "user-1", muted: true })).toMatchObject({ type: "chat.mute.set", muted: true, durationMinutes: null });
    expect(clientEventSchema.parse({ type: "chat.mute.set", requestId, userId: "user-1", muted: true, durationMinutes: 30 })).toMatchObject({ durationMinutes: 30 });
    expect(() => clientEventSchema.parse({ type: "chat.mute.set", requestId, userId: "user-1", muted: true, durationMinutes: 0 })).toThrow();
    expect(serverEventSchema.parse({
      type: "message.created",
      message: { id: crypto.randomUUID(), channelId: crypto.randomUUID(), authorId: "author", authorName: "Лина", authorAvatar: null, content: "Привет", createdAt: new Date().toISOString(), kind: "apm", targetUserId: "user-1", anonymous: true },
    })).toMatchObject({ type: "message.created", message: { kind: "apm", anonymous: true } });
    expect(serverEventSchema.parse({ type: "member.updated", member: { id: "member", username: "lina", discriminator: "1234", fingerprint: "abcd-ef01-2345-6789", bio: "", avatar: null, banner: null, status: "online", role: "member", chatMuted: true, chatMutedUntil: "2026-08-14T19:00:00.000Z" } })).toMatchObject({ member: { chatMuted: true, chatMutedUntil: "2026-08-14T19:00:00.000Z" } });
  });

  it("validates server identity, attachment and screen-share settings", () => {
    const requestId = crypto.randomUUID();
    const settings = { name: "Команда OpenCord", screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 } as const;
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings })).toMatchObject({ maxAttachmentBytes: MEBIBYTE, ...settings });
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES, ...settings })).toMatchObject({ maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES });
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: null, ...settings })).toMatchObject({ maxAttachmentBytes: null });
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings, screenShareMaxResolution: 1440 })).toMatchObject({ screenShareMaxResolution: 1440 });
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE - 1, ...settings })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES + 1, ...settings })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings, screenShareMaxResolution: 2160 })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings, screenShareMaxFrameRate: 120 })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings, name: "x" })).toThrow();
  });

  it("validates paginated message search filters", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "message.search", requestId, filters: { query: "котик", authorId: "user-1", channelId, contentTypes: ["text", "image"], offset: 0, limit: 25 } })).toMatchObject({ type: "message.search", filters: { query: "котик", contentTypes: ["text", "image"] } });
    expect(() => clientEventSchema.parse({ type: "message.search", requestId, filters: { query: "", authorId: null, channelId: null, contentTypes: [] } })).toThrow();
    expect(() => clientEventSchema.parse({ type: "message.search", requestId, filters: { query: "котик", contentTypes: ["image", "image"] } })).toThrow();
  });

  it("strips bidirectional controls that disguise a file extension", () => {
    // U+202E переставляет хвост имени: .exe показывается как .pdf.
    expect(stripBidiControls("счёт-‮fdp.exe")).toBe("счёт-fdp.exe");
    expect(stripBidiControls("‭photo‬.png")).toBe("photo.png");
    expect(stripBidiControls("⁦a⁧b⁨c⁩.txt")).toBe("abc.txt");
    expect(stripBidiControls("؜‎‏report.pdf")).toBe("report.pdf");
    // Обычные имена, включая арабские и ивритские буквы, не меняются.
    expect(stripBidiControls("отчёт.pdf")).toBe("отчёт.pdf");
    expect(stripBidiControls("تقرير.pdf")).toBe("تقرير.pdf");
  });

  it("accepts only a single real emoji as a reaction", () => {
    const requestId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const react = (emoji: string): unknown => ({ type: "message.react", requestId, messageId, emoji });

    // Простое эмодзи, вариационная селекция, ZWJ-последовательность, флаг, keycap, модификатор тона.
    for (const emoji of ["👍", "❤️", "👨‍👩‍👧‍👦", "🇺🇦", "1️⃣", "👍🏽"]) {
      expect(clientEventSchema.parse(react(emoji))).toMatchObject({ emoji });
      expect(isReactionEmoji(emoji)).toBe(true);
    }

    // Свободный текст, комбинирующая «zalgo»-стопка, RTL-override и несколько эмодзи
    // подряд ломали бы вёрстку ленты у всех, кто её видит.
    for (const junk of ["A", "ЛОЛ", "a̶̡̜̽͊", "‮работа", "👍👍", "👍 ", " ", "", "❤"]) {
      expect(() => clientEventSchema.parse(react(junk))).toThrow();
      expect(isReactionEmoji(junk)).toBe(false);
    }
  });
});
