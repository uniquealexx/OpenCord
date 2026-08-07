import { describe, expect, it } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import { LIVEKIT_PUBLISH_SOURCES } from "../src/voice";

describe("LiveKit voice grants", () => {
  it("allows microphone, screen video and screen audio only", () => {
    expect(LIVEKIT_PUBLISH_SOURCES).toEqual([
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ]);
  });
});
