import { randomUUID } from "node:crypto";
import type { VoicePresence } from "@opencord/shared";
import { describe, expect, it } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import { LIVEKIT_PUBLISH_SOURCES, LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES, LiveKitVoiceService } from "../src/voice";

describe("LiveKit voice grants", () => {
  it("allows microphone, screen video and screen audio only", () => {
    expect(LIVEKIT_PUBLISH_SOURCES).toEqual([
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
  });

  it("removes only microphone publishing while a participant is server-muted", () => {
    expect(LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES).toEqual([
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
    expect(LIVEKIT_SERVER_MUTED_PUBLISH_SOURCES).not.toContain(TrackSource.MICROPHONE);
  });

  it("keeps a screen-share viewer target only inside the same voice channel", () => {
    const service = new LiveKitVoiceService({ internalUrl: "http://127.0.0.1:7880", publicUrl: "ws://127.0.0.1:7880", apiKey: "test-key", apiSecret: "test-secret", secureTransport: false, maxParticipants: 25 });
    const presences = (service as unknown as { presences: Map<string, VoicePresence> }).presences;
    const channelId = randomUUID();
    const otherChannelId = randomUUID();
    const base = { muted: false, deafened: false, serverMuted: false, viewingScreenShareUserId: null };
    presences.set("viewer", { ...base, userId: "viewer", channelId });
    presences.set("same-room-share", { ...base, userId: "same-room-share", channelId });
    presences.set("other-room-share", { ...base, userId: "other-room-share", channelId: otherChannelId });

    expect(service.updateState("viewer", { muted: false, deafened: false, viewingScreenShareUserId: "same-room-share" })?.viewingScreenShareUserId).toBe("same-room-share");
    expect(service.updateState("viewer", { muted: false, deafened: false, viewingScreenShareUserId: "other-room-share" })?.viewingScreenShareUserId).toBeNull();
  });
});
