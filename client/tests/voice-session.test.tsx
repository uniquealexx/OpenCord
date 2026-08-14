import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureMicrophoneProcessing, createResponsiveVoiceActivityGate, decibelsToRms, mergeResponsiveSpeakerIds, requestHighestScreenShareQuality, useVoiceSession } from "@/hooks/use-voice-session";
import { createDefaultState } from "@/shared/state";
import type { LocalAudioTrack } from "livekit-client";

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

    gate.sample(0.025);
    gate.sample(0.026);
    expect(changes).toEqual([true]);

    gate.sample(0.003);
    gate.sample(0.003);
    expect(changes).toEqual([true]);
    gate.sample(0.003);
    expect(changes).toEqual([true]);
    gate.sample(0.003);
    expect(changes).toEqual([true, false]);
  });

  it("does not latch the voice ring on ambient noise during warm-up calibration", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking));

    // Шум комнаты выше стартового порога, но ниже «громкого» уровня: в прогреве не открывает,
    // а калибрует шумовой пол — и после прогрева тоже не залипает.
    for (let index = 0; index < 60; index += 1) gate.sample(0.01);
    expect(changes).toEqual([]);

    gate.sample(0.03);
    expect(changes).toEqual([true]);
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

  it("automatically becomes more sensitive after measuring a quiet microphone", () => {
    const changes: boolean[] = [];
    const calibrations: number[] = [];
    const gate = createResponsiveVoiceActivityGate(
      (speaking) => changes.push(speaking),
      ({ openThreshold }) => calibrations.push(openThreshold),
    );
    const initialThreshold = gate.calibration().openThreshold;

    for (let index = 0; index < 60; index += 1) gate.sample(0.0008);
    const quietThreshold = gate.calibration().openThreshold;
    gate.sample(quietThreshold + 0.001);

    expect(quietThreshold).toBeLessThan(initialThreshold);
    expect(changes).toEqual([true]);
    expect(calibrations.length).toBeGreaterThan(1);
  });

  it("raises the activation threshold for stable background noise", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking));

    for (let index = 0; index < 160; index += 1) gate.sample(0.004);
    const noisyCalibration = gate.calibration();

    expect(changes).toEqual([]);
    expect(noisyCalibration.noiseFloor).toBeGreaterThan(0.0038);
    expect(noisyCalibration.openThreshold).toBeGreaterThan(0.012);

    gate.sample(0.02);
    expect(changes).toEqual([true]);
  });

  it("freezes the noise floor while the user is speaking", () => {
    const gate = createResponsiveVoiceActivityGate(vi.fn());
    for (let index = 0; index < 80; index += 1) gate.sample(0.001);
    gate.sample(0.02);
    const beforeSpeech = gate.calibration().noiseFloor;

    for (let index = 0; index < 100; index += 1) gate.sample(0.03);
    expect(gate.calibration().noiseFloor).toBeCloseTo(beforeSpeech, 8);
  });

  it("gradually closes on steady non-loud noise while the gate is open", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking));

    gate.sample(0.03); // громкий сигнал открывает гейт сразу
    expect(changes).toEqual([true]);

    // Устойчивый негромкий фон: шумовой пол медленно поднимается, порог закрытия обгоняет
    // фон — гейт закрывается сам, без громкой речи.
    for (let index = 0; index < 400 && !changes.includes(false); index += 1) gate.sample(0.012);
    expect(changes).toEqual([true, false]);
  });

  it("uses the selected decibel threshold without automatic recalibration", () => {
    const changes: boolean[] = [];
    const gate = createResponsiveVoiceActivityGate((speaking) => changes.push(speaking), undefined, { automatic: false, manualThresholdDb: -40 });

    expect(gate.calibration()).toMatchObject({ noiseFloor: 0, openThreshold: 0.01 });
    for (let index = 0; index < 100; index += 1) gate.sample(0.009);
    expect(changes).toEqual([]);
    expect(gate.calibration().openThreshold).toBe(0.01);

    gate.sample(0.011);
    expect(changes).toEqual([true]);
    for (let index = 0; index < 4; index += 1) gate.sample(0.007);
    expect(changes).toEqual([true, false]);
  });

  it("converts and clamps manual sensitivity decibels", () => {
    expect(decibelsToRms(-40)).toBeCloseTo(0.01, 8);
    expect(decibelsToRms(-100)).toBeCloseTo(0.0001, 8);
    expect(decibelsToRms(0)).toBeCloseTo(0.3162277, 6);
  });

  it("lets responsive audio analysis override a delayed LiveKit speaker state", () => {
    expect(mergeResponsiveSpeakerIds(["local-user", "fallback-user"], [
      { identity: "local-user", speaking: false },
      { identity: "responsive-user", speaking: true },
    ])).toEqual(["fallback-user", "responsive-user"]);
  });

  it("requests the highest LiveKit layer for a canvas-rendered screen share", () => {
    const publication = { setEnabled: vi.fn(), setVideoQuality: vi.fn() };
    requestHighestScreenShareQuality(publication);
    expect(publication.setEnabled).toHaveBeenCalledWith(true);
    expect(publication.setVideoQuality).toHaveBeenCalledWith(2);
  });

  it("attaches the local microphone processor when noise suppression is enabled", async () => {
    const setProcessor = vi.fn(async (...args: unknown[]) => { void args; });
    const track = {
      getProcessor: vi.fn(() => undefined),
      setProcessor,
      stopProcessor: vi.fn(async () => undefined),
      mediaStreamTrack: { applyConstraints: vi.fn(async () => undefined) },
    } as unknown as LocalAudioTrack;
    const preferences = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };

    await expect(configureMicrophoneProcessing(track, preferences)).resolves.toMatchObject({ suppression: "enhanced" });
    expect(setProcessor).toHaveBeenCalledOnce();
    expect(setProcessor.mock.calls[0]?.[0]).toMatchObject({ name: "opencord-microphone", enableRnnoise: true });
  });

  it("falls back to WebRTC suppression without breaking the microphone", async () => {
    const applyConstraints = vi.fn(async () => undefined);
    const track = {
      getProcessor: vi.fn(() => undefined),
      setProcessor: vi.fn(async () => { throw new Error("unsupported"); }),
      stopProcessor: vi.fn(async () => undefined),
      mediaStreamTrack: { applyConstraints },
    } as unknown as LocalAudioTrack;
    const preferences = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };

    await expect(configureMicrophoneProcessing(track, preferences)).resolves.toMatchObject({ suppression: "standard", processor: null });
    expect(applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
  });

  it("installs a gate-only processor and disables suppression when the switch is off", async () => {
    const stopProcessor = vi.fn(async () => undefined);
    const applyConstraints = vi.fn(async () => undefined);
    const setProcessor = vi.fn(async (...args: unknown[]) => { void args; });
    const track = {
      getProcessor: vi.fn(() => ({ name: "opencord-microphone" })),
      setProcessor,
      stopProcessor,
      mediaStreamTrack: { applyConstraints },
    } as unknown as LocalAudioTrack;
    const preferences = { noiseSuppression: false, echoCancellation: true, autoGainControl: true };

    await expect(configureMicrophoneProcessing(track, preferences)).resolves.toMatchObject({ suppression: "off" });
    expect(stopProcessor).toHaveBeenCalledOnce();
    expect(applyConstraints).toHaveBeenCalledWith({ noiseSuppression: false });
    expect(setProcessor.mock.calls[0]?.[0]).toMatchObject({ enableRnnoise: false });
  });
});
