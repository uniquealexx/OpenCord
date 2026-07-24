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
    expect(migrated.version).toBe(2);
    expect(migrated.servers.map((server) => server.id)).toEqual(["real-server"]);
    expect(migrated.messages.map((message) => message.id)).toEqual(["real-message"]);
    expect(migrated.activeServerId).toBe("real-server");
    expect(migrated.activeChannelId).toBe("real-general");
  });
});
