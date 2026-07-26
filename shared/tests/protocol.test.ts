import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, USER_AVATAR_MAX_BYTES, clientEventSchema, serverEventSchema, userAvatarSchema } from "../src";

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
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "анонсы", description: "Важное" })).toMatchObject({ type: "channel.update", channelId });
    expect(clientEventSchema.parse({ type: "channel.delete", requestId: crypto.randomUUID(), channelId })).toMatchObject({ type: "channel.delete", channelId });
    expect(clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "administrator" })).toMatchObject({ role: "administrator" });
    expect(() => clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "owner" })).toThrow();
    expect(clientEventSchema.parse({ type: "server.delete", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.delete" });
    expect(serverEventSchema.parse({ type: "server.deleted", serverId: crypto.randomUUID() })).toMatchObject({ type: "server.deleted" });
    expect(clientEventSchema.parse({ type: "server.avatar.update", requestId: crypto.randomUUID(), avatar: "data:image/png;base64,AA==" })).toMatchObject({ type: "server.avatar.update" });
    expect(serverEventSchema.parse({ type: "server.avatar.updated", serverId: crypto.randomUUID(), avatar: "data:image/webp;base64,AA==" })).toMatchObject({ type: "server.avatar.updated" });
    expect(clientEventSchema.parse({ type: "profile.update", requestId: crypto.randomUUID(), profile: { displayName: "Лина", avatar: "data:image/webp;base64,AA==" } })).toMatchObject({ type: "profile.update" });
    expect(clientEventSchema.parse({ type: "server.leave", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.leave" });
    expect(serverEventSchema.parse({ type: "member.removed", userId: "member-1" })).toEqual({ type: "member.removed", userId: "member-1" });
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
});
