import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVoiceSession } from "@/hooks/use-voice-session";
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
});
