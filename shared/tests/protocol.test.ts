import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, clientEventSchema, serverEventSchema } from "../src";

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

  it("validates role administration and channel management events", () => {
    expect(clientEventSchema.parse({ type: "channel.create", requestId: crypto.randomUUID(), name: "новости", kind: "text", description: "Обновления" })).toMatchObject({ type: "channel.create" });
    const channelId = crypto.randomUUID();
    expect(clientEventSchema.parse({ type: "channel.update", requestId: crypto.randomUUID(), channelId, name: "анонсы", description: "Важное" })).toMatchObject({ type: "channel.update", channelId });
    expect(clientEventSchema.parse({ type: "channel.delete", requestId: crypto.randomUUID(), channelId })).toMatchObject({ type: "channel.delete", channelId });
    expect(clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "administrator" })).toMatchObject({ role: "administrator" });
    expect(() => clientEventSchema.parse({ type: "member.role.set", requestId: crypto.randomUUID(), userId: "member-1", role: "owner" })).toThrow();
    expect(clientEventSchema.parse({ type: "server.delete", requestId: crypto.randomUUID() })).toMatchObject({ type: "server.delete" });
    expect(serverEventSchema.parse({ type: "server.deleted", serverId: crypto.randomUUID() })).toMatchObject({ type: "server.deleted" });
  });
});
