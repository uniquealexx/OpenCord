import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMIT_MAX_BYTES, MEBIBYTE, PROTOCOL_VERSION, USER_AVATAR_MAX_BYTES, USER_BANNER_MAX_BYTES, clientEventSchema, publicProfileSchema, serverEventSchema, userAvatarSchema, userBannerSchema } from "../src";

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
    expect(clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "новости", kind: "text", description: "Обновления" })).toMatchObject({ type: "channel.create" });
    const channelId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "анонсы", description: "Важное", participantLimit: null })).toMatchObject({ type: "channel.update", channelId });
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 25 })).toMatchObject({ participantLimit: 25 });
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 0 })).toMatchObject({ participantLimit: 0 });
    expect(() => clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "Гостиная", description: "", participantLimit: 26 })).toThrow();
    expect(clientEventSchema.parse({ type: "channel.delete", requestId: crypto.randomUUID(), channelId })).toMatchObject({ type: "channel.delete", channelId });
    expect(clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "administrator" })).toMatchObject({ role: "administrator" });
    expect(clientEventSchema.parse({ type: "member.kick", requestId: crypto.randomUUID(), userId: "member-1" })).toMatchObject({ type: "member.kick", userId: "member-1" });
    expect(() => clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "owner" })).toThrow();
    expect(clientEventSchema.parse({ type: "server.delete", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.delete" });
    expect(serverEventSchema.parse({ type: "server.deleted", serverId: crypto.randomUUID() })).toMatchObject({ type: "server.deleted" });
    expect(clientEventSchema.parse({ type: "server.avatar.update", requestId: crypto.randomUUID(), avatar: "data:image/png;base64,AA==" })).toMatchObject({ type: "server.avatar.update" });
    expect(serverEventSchema.parse({ type: "server.avatar.updated", serverId: crypto.randomUUID(), avatar: "data:image/webp;base64,AA==" })).toMatchObject({ type: "server.avatar.updated" });
    expect(clientEventSchema.parse({ type: "profile.update", requestId: crypto.randomUUID(), profile: { displayName: "Лина", avatar: "data:image/webp;base64,AA==" } })).toMatchObject({ type: "profile.update" });
    expect(clientEventSchema.parse({ type: "server.leave", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.leave" });
    expect(serverEventSchema.parse({ type: "member.removed", userId: "member-1" })).toEqual({ type: "member.removed", userId: "member-1" });
  });

  it("validates voice mute and deafen state synchronization", () => {
    const requestId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    const participant = { userId: "voice-member", channelId, muted: true, deafened: false };
    expect(clientEventSchema.parse({ type: "voice.state.update", requestId, muted: true, deafened: false })).toMatchObject({ muted: true, deafened: false });
    expect(serverEventSchema.parse({ type: "voice.participant.updated", participant })).toEqual({ type: "voice.participant.updated", participant });
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

  it("accepts only compact WebP user banners", () => {
    expect(userBannerSchema.parse("data:image/webp;base64,AA==")).toBe("data:image/webp;base64,AA==");
    expect(() => userBannerSchema.parse("data:image/jpeg;base64,AA==")).toThrow();
    expect(() => userBannerSchema.parse(`data:image/webp;base64,${"A".repeat(Math.ceil(USER_BANNER_MAX_BYTES / 3) * 4 + 33)}`)).toThrow();
  });

  it("validates user presence and defaults older profiles to online", () => {
    expect(publicProfileSchema.parse({ displayName: "Лина", avatar: null })).toMatchObject({ status: "online", bio: "", banner: null });
    expect(publicProfileSchema.parse({ displayName: "Лина", bio: "  Пишу открытый код  ", avatar: null, status: "invisible" })).toMatchObject({ status: "invisible", bio: "Пишу открытый код" });
    expect(() => publicProfileSchema.parse({ displayName: "Лина", avatar: null, status: "offline" })).toThrow();
    expect(() => publicProfileSchema.parse({ displayName: "Лина", bio: "x".repeat(161), avatar: null })).toThrow();
    expect(serverEventSchema.parse({ type: "member.updated", member: { id: "member", displayName: "Лина", bio: "Пишу открытый код", avatar: null, banner: "data:image/webp;base64,AA==", status: "dnd", role: "member" } })).toMatchObject({ member: { status: "dnd", bio: "Пишу открытый код", banner: "data:image/webp;base64,AA==" } });
  });

  it("validates server identity, attachment and screen-share settings", () => {
    const requestId = crypto.randomUUID();
    const settings = { name: "Команда OpenCord", screenShareMaxResolution: 720, screenShareMaxFrameRate: 30 } as const;
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings })).toMatchObject({ maxAttachmentBytes: MEBIBYTE, ...settings });
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES, ...settings })).toMatchObject({ maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES });
    expect(clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: null, ...settings })).toMatchObject({ maxAttachmentBytes: null });
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE - 1, ...settings })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: ATTACHMENT_LIMIT_MAX_BYTES + 1, ...settings })).toThrow();
    expect(() => clientEventSchema.parse({ type: "server.settings.update", requestId, maxAttachmentBytes: MEBIBYTE, ...settings, screenShareMaxResolution: 1440 })).toThrow();
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
});
