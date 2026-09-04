import { describe, expect, it } from "vitest";
import { getChannelNotificationSettings, shouldNotify } from "@/lib/channel-notifications";
import { createDefaultState } from "@/shared/state";

describe("channel notification settings", () => {
  it("returns all-enabled defaults for channels without an override", () => {
    const preferences = createDefaultState().preferences;
    expect(getChannelNotificationSettings(preferences, "unknown-channel")).toEqual({ enabled: true, everyone: true, mentions: true });
  });

  it("round-trips a stored override and fills partial overrides with defaults", () => {
    const preferences = createDefaultState().preferences;
    const stored = { ...preferences, notificationOverrides: { "channel-1": { enabled: false, everyone: true, mentions: false } } };
    expect(getChannelNotificationSettings(stored, "channel-1")).toEqual({ enabled: false, everyone: true, mentions: false });
    const partial = { ...preferences, notificationOverrides: { "channel-2": { enabled: false } } };
    expect(getChannelNotificationSettings(partial, "channel-2")).toEqual({ enabled: false, everyone: true, mentions: true });
  });
});

describe("shouldNotify", () => {
  const all = { enabled: true, everyone: true, mentions: true };
  const base = { globalEnabled: true, settings: all, authorId: "user-bob", selfUserId: "user-alice", isMentioned: false, isEveryone: false };

  it("notifies on any message while the master switch is on", () => {
    expect(shouldNotify(base)).toBe(true);
  });

  it("notifies on mentions and @everyone when the master switch is off", () => {
    const off = { ...base, settings: { enabled: false, everyone: true, mentions: true } };
    expect(shouldNotify({ ...off, isMentioned: true })).toBe(true);
    expect(shouldNotify({ ...off, isEveryone: true })).toBe(true);
    expect(shouldNotify(off)).toBe(false);
  });

  it("respects disabled mention and @everyone children", () => {
    const off = { ...base, settings: { enabled: false, everyone: false, mentions: false } };
    expect(shouldNotify({ ...off, isMentioned: true })).toBe(false);
    expect(shouldNotify({ ...off, isEveryone: true })).toBe(false);
  });

  it("never notifies for own messages or when globally muted", () => {
    expect(shouldNotify({ ...base, authorId: "user-alice" })).toBe(false);
    expect(shouldNotify({ ...base, globalEnabled: false })).toBe(false);
  });
});
