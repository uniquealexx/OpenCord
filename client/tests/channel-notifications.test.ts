import { describe, expect, it } from "vitest";
import { buildToastForMessage, getChannelNotificationSettings, shouldNotify } from "@/lib/channel-notifications";
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

describe("buildToastForMessage", () => {
  const all = { enabled: true, everyone: true, mentions: true };
  const input = {
    messageId: "msg-1",
    channelId: "channel-1",
    channelName: "общий",
    authorId: "user-bob",
    authorName: "Боб",
    excerpt: "Привет",
    mentionedUserIds: [] as string[],
    contentHasEveryone: false,
    selfUserId: "user-alice",
    activeChannelId: "channel-2" as string | null,
    windowFocused: true,
    globalEnabled: true,
    settings: all,
  };

  it("builds a message toast for background channels while the master is on", () => {
    expect(buildToastForMessage(input)).toEqual({
      id: "msg-1",
      channelId: "channel-1",
      channelName: "общий",
      authorName: "Боб",
      kind: "message",
      excerpt: "Привет",
    });
  });

  it("suppresses toasts for the open channel while the window is focused", () => {
    expect(buildToastForMessage({ ...input, activeChannelId: "channel-1", windowFocused: true })).toBeNull();
    expect(buildToastForMessage({ ...input, activeChannelId: "channel-1", windowFocused: false })).not.toBeNull();
  });

  it("prioritizes mentions over @everyone and honors child switches", () => {
    const off = { enabled: false, everyone: true, mentions: true };
    expect(buildToastForMessage({ ...input, settings: off, mentionedUserIds: ["user-alice"], contentHasEveryone: true })?.kind).toBe("mention");
    expect(buildToastForMessage({ ...input, settings: off, contentHasEveryone: true })?.kind).toBe("everyone");
    expect(buildToastForMessage({ ...input, settings: off })).toBeNull();
  });

  it("returns null for own messages and muted globals", () => {
    expect(buildToastForMessage({ ...input, authorId: "user-alice" })).toBeNull();
    expect(buildToastForMessage({ ...input, globalEnabled: false })).toBeNull();
  });
});
