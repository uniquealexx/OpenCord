import { describe, expect, it } from "vitest";
import { createDefaultState, parsePersistedState, safePersistedState, STATE_VERSION } from "@/shared/state";

describe("persisted client state", () => {
  it("creates a valid versioned initial state", () => {
    const state = createDefaultState();
    expect(parsePersistedState(state)).toEqual(state);
    expect(state.version).toBe(STATE_VERSION);
    expect(state.servers).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.activeServerId).toBeNull();
    expect(state.preferences.voiceParticipantSettings).toEqual({});
  });

  it("persists participant mute and volume settings while accepting older v3 state", () => {
    const state = createDefaultState();
    const olderPreferences: Partial<typeof state.preferences> = { ...state.preferences };
    delete olderPreferences.voiceParticipantSettings;
    expect(parsePersistedState({ ...state, preferences: olderPreferences }).preferences.voiceParticipantSettings).toEqual({});

    const settings = { "remote-user": { muted: true, volume: 0.35 } };
    const restored = parsePersistedState({ ...state, preferences: { ...state.preferences, voiceParticipantSettings: settings } });
    expect(restored.preferences.voiceParticipantSettings).toEqual(settings);
  });

  it("persists a selected user status and accepts profiles saved before statuses existed", () => {
    const state = createDefaultState();
    const profile = { id: "local-user", displayName: "Лина", bio: "", avatar: null, createdAt: "2026-08-07T00:00:00.000Z" };
    expect(parsePersistedState({ ...state, profile }).profile?.status).toBeUndefined();
    expect(parsePersistedState({ ...state, profile: { ...profile, status: "invisible" } }).profile?.status).toBe("invisible");
  });

  it("rejects an active channel outside the active server", () => {
    const state = createDefaultState();
    expect(() => parsePersistedState({ ...state, activeChannelId: "missing" })).toThrow();
  });

  it("falls back for unsupported or corrupt state", () => {
    const fallback = safePersistedState({ version: 999, profile: "invalid" });
    expect(fallback).toEqual(createDefaultState());
  });

  it("migrates v1 by removing only the legacy template server", () => {
    const current = createDefaultState();
    const legacy = {
      ...current,
      version: 1,
      onboardingComplete: true,
      servers: [
        { id: "open-space", name: "Открытое пространство", address: null, accent: "#7c5cff", channels: [{ id: "welcome", serverId: "open-space", name: "общий", kind: "text", description: "" }], members: [] },
        { id: "real-server", name: "Мой сервер", address: "http://127.0.0.1:3210", accent: "#36c5f0", channels: [{ id: "real-general", serverId: "real-server", name: "общий", kind: "text", description: "" }], members: [] },
      ],
      messages: [
        { id: "template-message", channelId: "welcome", authorId: "demo", authorName: "Demo", authorColor: "#7c5cff", content: "Шаблон", createdAt: new Date().toISOString() },
        { id: "real-message", channelId: "real-general", authorId: "user", authorName: "Лина", authorColor: "#36c5f0", content: "Настоящее", createdAt: new Date().toISOString() },
      ],
      activeServerId: "open-space",
      activeChannelId: "welcome",
    };
    const migrated = parsePersistedState(legacy);
    expect(migrated.version).toBe(3);
    expect(migrated.preferences.voiceInputMode).toBe("voice");
    expect(migrated.servers.map((server) => server.id)).toEqual(["real-server"]);
    expect(migrated.messages.map((message) => message.id)).toEqual(["real-message"]);
    expect(migrated.activeServerId).toBe("real-server");
    expect(migrated.activeChannelId).toBe("real-general");
  });
});
