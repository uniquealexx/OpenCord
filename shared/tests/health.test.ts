import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, serverHealthSchema } from "../src";

const voice = { status: "available", secureTransport: true, maxParticipants: 25, warning: null } as const;

describe("server health contract", () => {
  it("accepts development, beta, and stable builds", () => {
    expect(serverHealthSchema.parse({ status: "ok", service: "opencord-server", version: "1.2.3-dev.1", releaseChannel: "development", buildCommit: null, protocolVersion: PROTOCOL_VERSION, database: "pglite", voice })).toMatchObject({ version: "1.2.3-dev.1" });
    expect(serverHealthSchema.parse({ status: "ok", service: "opencord-server", version: "1.2.3-beta.1", releaseChannel: "beta", buildCommit: "a1b2c3d4e5f6", protocolVersion: PROTOCOL_VERSION, database: "postgres", voice })).toMatchObject({ releaseChannel: "beta" });
    expect(serverHealthSchema.parse({ status: "ok", service: "opencord-server", version: "1.2.3", releaseChannel: "stable", buildCommit: "a1b2c3d4e5f6", protocolVersion: PROTOCOL_VERSION, database: "postgres", voice })).toMatchObject({ releaseChannel: "stable" });
  });

  it("rejects malformed or incomplete build metadata", () => {
    const base = { status: "ok", service: "opencord-server", version: "1.2.3", releaseChannel: "stable", buildCommit: "a1b2c3d4e5f6", protocolVersion: PROTOCOL_VERSION, database: "postgres", voice };
    expect(() => serverHealthSchema.parse({ ...base, version: "latest" })).toThrow();
    expect(() => serverHealthSchema.parse({ ...base, releaseChannel: "nightly" })).toThrow();
    expect(() => serverHealthSchema.parse({ ...base, buildCommit: null })).toThrow();
    expect(() => serverHealthSchema.parse({ ...base, releaseChannel: "beta", version: "1.2.3-beta.1", buildCommit: null })).toThrow();
    expect(() => serverHealthSchema.parse({ ...base, buildCommit: "abc" })).toThrow();
    expect(() => serverHealthSchema.parse({ ...base, service: "not-opencord" })).toThrow();
  });
});
