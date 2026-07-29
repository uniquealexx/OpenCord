import { PROTOCOL_VERSION, serverHealthSchema } from "@opencord/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PGliteDatabase } from "../src/database/database";
import { DisabledVoiceService } from "../src/voice";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

class DegradedVoiceService extends DisabledVoiceService {
  override async capability() {
    return { status: "degraded" as const, secureTransport: false, maxParticipants: 25, warning: "LiveKit unavailable" };
  }
}

describe("GET /health", () => {
  it("returns typed build metadata and keeps degraded voice non-fatal", async () => {
    const app = await buildApp({
      database: new PGliteDatabase("memory://"),
      buildInfo: { version: "1.2.3", releaseChannel: "stable", commit: "abcdef0123456789abcdef0123456789abcdef01" },
      voiceService: new DegradedVoiceService(),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(serverHealthSchema.parse(response.json())).toEqual({
      status: "ok", service: "opencord-server", version: "1.2.3", releaseChannel: "stable", buildCommit: "abcdef012345",
      protocolVersion: PROTOCOL_VERSION, database: "pglite", voice: { status: "degraded", secureTransport: false, maxParticipants: 25, warning: "LiveKit unavailable" },
    });
  }, 15_000);
});
