export const MIC_LEVEL_MIN_DB = -80;
export const MIC_LEVEL_MAX_DB = -10;
const MIC_LEVEL_POLL_INTERVAL_MS = 33;

export function rmsToDecibels(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

export function decibelsToMeterPercent(decibels: number): number {
  if (!Number.isFinite(decibels)) return 0;
  return Math.min(1, Math.max(0, (decibels - MIC_LEVEL_MIN_DB) / (MIC_LEVEL_MAX_DB - MIC_LEVEL_MIN_DB)));
}

export function calculateAudioRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export interface MicLevelMeter {
  stop(): void;
}

/**
 * Measures the RMS level of a captured stream and reports it in dBFS.
 * Returns null where Web Audio is unavailable so callers can skip the meter.
 */
export function createMicLevelMeter(stream: MediaStream, onLevel: (decibels: number | null) => void, pollIntervalMs: number = MIC_LEVEL_POLL_INTERVAL_MS): MicLevelMeter | null {
  if (typeof AudioContext === "undefined") return null;
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const tick = (): void => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(rmsToDecibels(calculateAudioRms(samples)));
  };
  const interval = window.setInterval(tick, pollIntervalMs);
  void context.resume().catch(() => undefined);
  return {
    stop(): void {
      window.clearInterval(interval);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => undefined);
      onLevel(null);
    },
  };
}
