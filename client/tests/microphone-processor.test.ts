import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrophoneTrackProcessor } from "@/shared/rnnoise-processor";
import { Track } from "livekit-client";

class FakeMediaStream {
  constructor() { /* The processor only passes tracks through. */ }
}

class FakeGainParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn();
}

class FakeGain {
  gain = new FakeGainParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

describe("MicrophoneTrackProcessor gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createContext() {
    const gate = new FakeGain();
    const destination = {
      stream: { getAudioTracks: () => [{ stop: vi.fn() }] },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const context = {
      currentTime: 10,
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
      createGain: vi.fn(() => gate),
      createMediaStreamDestination: vi.fn(() => destination),
    } as unknown as AudioContext;
    return { context, gate };
  }

  it("starts open and ramps to silence when the gate closes", async () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    const { context, gate } = createContext();
    const processor = new MicrophoneTrackProcessor({ enableRnnoise: false });
    await processor.init({ kind: Track.Kind.Audio, track: { stop: vi.fn() } as unknown as MediaStreamTrack, audioContext: context });

    expect(gate.gain.value).toBe(1);

    processor.setGateOpen(false);
    expect(gate.gain.cancelScheduledValues).toHaveBeenCalledWith(10);
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 10, expect.any(Number));

    processor.setGateOpen(true);
    expect(gate.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 10, expect.any(Number));
  });

  it("applies the pending gate state set before init", async () => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    const { context, gate } = createContext();
    const processor = new MicrophoneTrackProcessor({ enableRnnoise: false });
    processor.setGateOpen(false);
    await processor.init({ kind: Track.Kind.Audio, track: { stop: vi.fn() } as unknown as MediaStreamTrack, audioContext: context });

    expect(gate.gain.value).toBe(0);
  });
});
