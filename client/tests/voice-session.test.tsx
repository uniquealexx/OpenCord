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
