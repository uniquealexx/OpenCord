import { describe, expect, it } from "vitest";
import { createDefaultState, parsePersistedState, safePersistedState, STATE_VERSION } from "@/shared/state";

describe("persisted client state", () => {
  it("creates a valid versioned initial state", () => {
    const state = createDefaultState();
    expect(parsePersistedState(state)).toEqual(state);
    expect(state.version).toBe(STATE_VERSION);
    expect(state.servers[0]?.channels.length).toBeGreaterThan(0);
  });

  it("rejects an active channel outside the active server", () => {
    const state = createDefaultState();
    expect(() => parsePersistedState({ ...state, activeChannelId: "missing" })).toThrow();
  });

  it("falls back for unsupported or corrupt state", () => {
    const fallback = safePersistedState({ version: 999, profile: "invalid" });
    expect(fallback).toEqual(createDefaultState());
  });
});
