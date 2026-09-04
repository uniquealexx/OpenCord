import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeybindActions } from "../src/hooks/use-keybind-actions";
import type { KeybindActionEvent, KeybindMap } from "../src/shared/keybinds";
import type { VoiceSession } from "../src/hooks/use-voice-session";

type Listener = (event: KeybindActionEvent) => void;
let listener: Listener | null = null;

function createVoice(overrides: Partial<VoiceSession> = {}): VoiceSession {
  return {
    status: "connected", channelId: "c1", muted: false, deafened: false, activeSpeakerIds: [],
    quality: "excellent", inputDevices: [], outputDevices: [], screenShares: [], isScreenSharing: false,
    locallyMutedParticipantIds: [], participantVolumes: {},
    setMuted: vi.fn(async () => undefined), setDeafened: vi.fn(async () => undefined),
    setParticipantMuted: vi.fn(), setParticipantVolume: vi.fn(),
    setInputDevice: vi.fn(async () => undefined), setOutputDevice: vi.fn(async () => undefined),
    startScreenShare: vi.fn(async () => undefined), stopScreenShare: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    ...overrides,
  } as VoiceSession;
}

function renderWith(voice: VoiceSession, serverMuted = false): void {
  renderHook(() => useKeybindActions(voice, serverMuted, null));
}

beforeEach(() => {
  listener = null;
  (window as unknown as { openCord: unknown }).openCord = {
    keybinds: {
      apply: vi.fn(async () => undefined),
      setCaptureMode: vi.fn(async () => undefined),
      onAction: (next: Listener) => { listener = next; return () => { listener = null; }; },
    },
  };
});
afterEach(() => { cleanup(); delete (window as unknown as { openCord?: unknown }).openCord; });

describe("useKeybindActions", () => {
  it("toggle mute flips on press and ignores release", () => {
    const voice = createVoice();
    renderWith(voice);
    listener?.({ action: "mute", mode: "toggle", phase: "press" });
    listener?.({ action: "mute", mode: "toggle", phase: "release" });
    expect(voice.setMuted).toHaveBeenCalledTimes(1);
    expect(voice.setMuted).toHaveBeenCalledWith(true);
  });

  it("hold mute unmutes on release", () => {
    const voice = createVoice({ muted: true });
    renderWith(voice);
    listener?.({ action: "mute", mode: "hold", phase: "release" });
    expect(voice.setMuted).toHaveBeenCalledWith(false);
  });

  it("never unmutes while server-muted", () => {
    const voice = createVoice({ muted: true });
    renderWith(voice, true);
    listener?.({ action: "mute", mode: "toggle", phase: "press" });
    listener?.({ action: "mute", mode: "hold", phase: "release" });
    expect(voice.setMuted).not.toHaveBeenCalled();
  });

  it("toggle deafen flips deafened", () => {
    const voice = createVoice();
    renderWith(voice);
    listener?.({ action: "deafen", mode: "toggle", phase: "press" });
    expect(voice.setDeafened).toHaveBeenCalledWith(true);
  });

  it("presses are no-ops without an active session, releases still apply", () => {
    const voice = createVoice({ status: "idle" });
    renderWith(voice);
    listener?.({ action: "mute", mode: "toggle", phase: "press" });
    expect(voice.setMuted).not.toHaveBeenCalled();
    listener?.({ action: "mute", mode: "hold", phase: "release" });
    expect(voice.setMuted).toHaveBeenCalledWith(false); // защита от «залипшего» мута
  });

  it("does nothing when the bridge is absent (mobile/tests)", () => {
    delete (window as unknown as { openCord?: unknown }).openCord;
    const voice = createVoice();
    renderWith(voice);
    expect(voice.setMuted).not.toHaveBeenCalled();
  });

  it("pushes the bind map to main on mount and on change", () => {
    const apply = vi.fn(async () => undefined);
    (window as unknown as { openCord: { keybinds: { apply: typeof apply } } }).openCord.keybinds.apply = apply;
    const binds: KeybindMap = { mute: { trigger: { code: "KeyM", control: true, alt: false, shift: false, meta: false }, mode: "toggle" }, deafen: null };
    const { rerender } = renderHook(({ map }) => useKeybindActions(createVoice(), false, map), { initialProps: { map: binds } });
    expect(apply).toHaveBeenCalledWith(binds);
    rerender({ map: { ...binds, mute: null } });
    expect(apply).toHaveBeenLastCalledWith({ ...binds, mute: null });
  });
});
