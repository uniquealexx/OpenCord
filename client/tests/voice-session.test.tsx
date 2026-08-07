import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResponsiveVoiceActivityGate, mergeResponsiveSpeakerIds, useVoiceSession } from "@/hooks/use-voice-session";
import { createDefaultState } from "@/shared/state";

describe("voice session controls", () => {
  afterEach(() => {
    document.querySelectorAll("audio[data-opencord-livekit='true']").forEach((element) => element.remove());
  });

  it("turns incoming audio back on when the microphone is enabled while deafened", async () => {
    const remoteAudio = document.createElement("audio");
    remoteAudio.dataset.opencordLivekit = "true";
    document.body.appendChild(remoteAudio);
    const { result } = renderHook(() => useVoiceSession(null, createDefaultState().preferences, vi.fn()));

    await act(async () => result.current.setDeafened(true));
    expect(result.current).toMatchObject({ muted: true, deafened: true });
    expect(remoteAudio.muted).toBe(true);

    await act(async () => result.current.setMuted(false));
    expect(result.current).toMatchObject({ muted: false, deafened: false });
    expect(remoteAudio.muted).toBe(false);
  });

  it("mutes one remote participant locally and preserves it across deafen toggles", async () => {
    const first = document.createElement("audio");
    first.dataset.opencordLivekit = "true";
    first.dataset.opencordParticipantId = "first-user";
    const second = document.createElement("audio");
    second.dataset.opencordLivekit = "true";
    second.dataset.opencordParticipantId = "second-user";
    document.body.append(first, second);
    const { result } = renderHook(() => useVoiceSession(null, createDefaultState().preferences, vi.fn()));

    act(() => result.current.setParticipantMuted("first-user", true));
    expect(result.current.locallyMutedParticipantIds).toEqual(["first-user"]);
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(false);

    await act(async () => result.current.setDeafened(true));
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(true);
    await act(async () => result.current.setDeafened(false));
    expect(first.muted).toBe(true);
    expect(second.muted).toBe(false);

    act(() => result.current.setParticipantMuted("first-user", false));
    expect(result.current.locallyMutedParticipantIds).toEqual([]);
    expect(first.muted).toBe(false);
  });

  it("changes only the selected participant volume and clamps the value", () => {
    const first = document.createElement("audio");
    first.dataset.opencordLivekit = "true";
    first.dataset.opencordParticipantId = "first-user";
    const second = document.createElement("audio");
    second.dataset.opencordLivekit = "true";
    second.dataset.opencordParticipantId = "second-user";
    document.body.append(first, second);
    const { result } = renderHook(() => useVoiceSession(null, createDefaultState().preferences, vi.fn()));

    act(() => result.current.setParticipantVolume("first-user", 0.35));
    expect(result.current.participantVolumes).toEqual({ "first-user": 0.35 });
    expect(first.volume).toBe(0.35);
    expect(second.volume).toBe(1);

    act(() => result.current.setParticipantVolume("first-user", 2));
    expect(result.current.participantVolumes).toEqual({});
    expect(first.volume).toBe(1);
  });

  it("restores participant audio settings after a new hook instance", () => {
    const onSettingsChange = vi.fn();
    const firstHook = renderHook(() => useVoiceSession(null, createDefaultState().preferences, vi.fn(), onSettingsChange));
    act(() => firstHook.result.current.setParticipantMuted("remote-user", true));
    act(() => firstHook.result.current.setParticipantVolume("remote-user", 0.4));
    const savedSettings = onSettingsChange.mock.calls.at(-1)?.[0] ?? {};
    expect(savedSettings).toEqual({ "remote-user": { muted: true, volume: 0.4 } });
    firstHook.unmount();

    const remoteAudio = document.createElement("audio");
    remoteAudio.dataset.opencordLivekit = "true";
    remoteAudio.dataset.opencordParticipantId = "remote-user";
    document.body.appendChild(remoteAudio);
    const preferences = { ...createDefaultState().preferences, voiceParticipantSettings: savedSettings };
    const secondHook = renderHook(() => useVoiceSession(null, preferences, vi.fn()));

    expect(secondHook.result.current.locallyMutedParticipantIds).toEqual(["remote-user"]);
    expect(secondHook.result.current.participantVolumes).toEqual({ "remote-user": 0.4 });
    expect(remoteAudio.muted).toBe(true);
    expect(remoteAudio.volume).toBe(0.4);
  });

  it("activates responsive voice activity on the first loud sample and releases without a fade delay", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking));

    gate.sample(0.011);
    gate.sample(0.012);
    expect(changes).toEqual([true]);

    gate.sample(0.006);
    gate.sample(0.006);
    expect(changes).toEqual([true]);
    gate.sample(0.006);
    expect(changes).toEqual([true, false]);
  });

  it("uses hysteresis so small level changes do not flicker the voice ring", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking));

    gate.sample(0.02);
    gate.sample(0.009);
    gate.sample(0.006);
    gate.sample(0.009);
    gate.sample(0.006);
    gate.reset();

    expect(changes).toEqual([true, false]);
  });

  it("lets responsive audio analysis override a delayed LiveKit speaker state", () => {
    expect(mergeResponsiveSpeakerIds(["local-user", "fallback-user"], [
      { identity: "local-user", speaking: false },
      { identity: "responsive-user", speaking: true },
    ])).toEqual(["fallback-user", "responsive-user"]);
  });
});
