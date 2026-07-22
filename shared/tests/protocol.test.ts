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
});
