import { describe, expect, it } from "vitest";
import { calculateAudioRms, decibelsToMeterPercent, rmsToDecibels } from "@/lib/voice-level";

describe("voice level meter math", () => {
  it("computes RMS of audio samples", () => {
    expect(calculateAudioRms(new Float32Array([1, -1]))).toBeCloseTo(1);
    expect(calculateAudioRms(new Float32Array(16))).toBe(0);
  });

  it("converts RMS to decibels", () => {
    expect(rmsToDecibels(1)).toBe(0);
    expect(rmsToDecibels(0.1)).toBeCloseTo(-20);
    expect(rmsToDecibels(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("maps decibels to the meter range and clamps the result", () => {
    expect(decibelsToMeterPercent(-45)).toBeCloseTo(0.5);
    expect(decibelsToMeterPercent(-10)).toBe(1);
    expect(decibelsToMeterPercent(-80)).toBe(0);
    expect(decibelsToMeterPercent(0)).toBe(1);
    expect(decibelsToMeterPercent(-120)).toBe(0);
    expect(decibelsToMeterPercent(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(decibelsToMeterPercent(Number.NaN)).toBe(0);
  });
});
