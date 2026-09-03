import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickVoiceMimeType, useVoiceRecorder, voiceFileExtension, voiceFileName } from "@/hooks/use-voice-recorder";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes = new Set(["audio/webm;codecs=opus"]);
  static isTypeSupported(type: string): boolean { return FakeMediaRecorder.supportedTypes.has(type); }
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;
  constructor(public stream: unknown, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }
  start(): void { this.state = "recording"; }
  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function stubMediaDevices(getUserMedia: () => Promise<unknown>): void {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
}

function stoppableStream(): unknown {
  return { getTracks: () => [{ stop: vi.fn() }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = new Set(["audio/webm;codecs=opus"]);
});

describe("voice recorder helpers", () => {
  it("picks the first supported mime type and maps file names", () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    expect(pickVoiceMimeType()).toBe("audio/webm;codecs=opus");
    expect(voiceFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(voiceFileExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(voiceFileExtension("audio/mp4")).toBe("m4a");
    expect(voiceFileExtension("audio/mpeg")).toBe("mp3");
    expect(voiceFileName("audio/webm;codecs=opus", new Date("2026-01-02T03:04:05Z"))).toBe("voice-message-20260102-030405.webm");
  });

  it("returns null without MediaRecorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickVoiceMimeType()).toBeNull();
  });
});

describe("useVoiceRecorder", () => {
  it("records and produces audio on stop", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    stubMediaDevices(async () => stoppableStream());
    const { result } = renderHook(() => useVoiceRecorder({ maxSeconds: 300 }));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe("recording");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.seconds).toBeGreaterThanOrEqual(2);

    act(() => { result.current.stop(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.audio?.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.current.audio?.blob.size).toBeGreaterThan(0);

    act(() => { result.current.reset(); });
    expect(result.current.status).toBe("idle");
    expect(result.current.audio).toBeNull();
  });

  it("auto-stops at the duration cap and marks the take truncated", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    stubMediaDevices(async () => stoppableStream());
    const { result } = renderHook(() => useVoiceRecorder({ maxSeconds: 5 }));

    await act(async () => { await result.current.start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(result.current.status).toBe("ready");
    expect(result.current.audio?.truncated).toBe(true);
  });

  it("reports denied microphone permission", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const denied = new DOMException("denied", "NotAllowedError");
    stubMediaDevices(async () => { throw denied; });
    const { result } = renderHook(() => useVoiceRecorder({}));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBe("denied");
  });

  it("rejects takes larger than the server limit", async () => {
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    stubMediaDevices(async () => stoppableStream());
    const { result } = renderHook(() => useVoiceRecorder({ maxBytes: 1 }));

    await act(async () => { await result.current.start(); });
    act(() => { result.current.stop(); });
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBe("too-large");
  });
});
