import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import { Track, type AudioProcessorOptions, type TrackProcessor } from "livekit-client";

const DRY_SIGNAL_MIX = 0.08;
const GATE_OPEN_TIME = 0.012;
const GATE_CLOSE_TIME = 0.04;
const workletUrl = new URL("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js", import.meta.url);
const simdWasmUrl = new URL("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm", import.meta.url);
type RnnoiseModule = typeof import("@sapphi-red/web-noise-suppressor");
interface PreparedRnnoise { module: RnnoiseModule; wasmBinary: ArrayBuffer }
const loadedContexts = new WeakMap<AudioContext, Promise<PreparedRnnoise>>();

async function prepareRnnoise(context: AudioContext): Promise<PreparedRnnoise> {
  const current = loadedContexts.get(context);
  if (current) return current;
  const modulePromise = import("@sapphi-red/web-noise-suppressor");
  const loading = Promise.all([loadWorklet(context), loadBinaryAsset(simdWasmUrl), modulePromise])
    .then(([, wasmBinary, module]) => ({ module, wasmBinary }));
  loadedContexts.set(context, loading);
  try {
    return await loading;
  } catch (error) {
    loadedContexts.delete(context);
    throw error;
  }
}

async function loadBinaryAsset(url: URL): Promise<ArrayBuffer> {
  if (url.protocol !== "file:") {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load RNNoise model (${response.status})`);
    return response.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url.href);
    request.responseType = "arraybuffer";
    request.addEventListener("load", () => request.response instanceof ArrayBuffer ? resolve(request.response) : reject(new Error("RNNoise model is empty")));
    request.addEventListener("error", () => reject(new Error("Unable to load the local RNNoise model")));
    request.send();
  });
}

async function loadTextAsset(url: URL): Promise<string> {
  if (url.protocol !== "file:") {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load RNNoise worklet (${response.status})`);
    return response.text();
  }
  return new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url.href);
    request.responseType = "text";
    request.addEventListener("load", () => typeof request.responseText === "string" ? resolve(request.responseText) : reject(new Error("RNNoise worklet is empty")));
    request.addEventListener("error", () => reject(new Error("Unable to load the local RNNoise worklet")));
    request.send();
  });
}

async function loadWorklet(context: AudioContext): Promise<void> {
  const source = await loadTextAsset(workletUrl);
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function supportsEnhancedNoiseSuppression(context?: AudioContext): boolean {
  return typeof AudioWorkletNode === "function" && Boolean(context?.audioWorklet);
}

export interface MicrophoneTrackProcessorOptions {
  enableRnnoise: boolean;
}

/**
 * LiveKit audio processor for the local microphone: an optional RNNoise
 * suppression stage followed by a smooth voice gate. The gate is driven by
 * the sensitivity settings and silences the published signal below the
 * activation threshold, like Discord's input sensitivity.
 */
export class MicrophoneTrackProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "opencord-microphone";
  readonly enableRnnoise: boolean;
  processedTrack?: MediaStreamTrack;
  private audioContext?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private rnnoise?: RnnoiseWorkletNode;
  private processedGain?: GainNode;
  private dryGain?: GainNode;
  private gate?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private pendingOpen = true;

  constructor(options: MicrophoneTrackProcessorOptions = { enableRnnoise: true }) {
    this.enableRnnoise = options.enableRnnoise;
  }

  async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
    this.audioContext = audioContext;
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    let rnnoise: RnnoiseWorkletNode | undefined;
    let processedGain: GainNode | undefined;
    let dryGain: GainNode | undefined;
    if (this.enableRnnoise) {
      if (!supportsEnhancedNoiseSuppression(audioContext)) throw new Error("AudioWorklet is not supported by this Chromium version");
      const { module, wasmBinary } = await prepareRnnoise(audioContext);
      rnnoise = new module.RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary });
      processedGain = audioContext.createGain();
      dryGain = audioContext.createGain();
      processedGain.gain.value = 1 - DRY_SIGNAL_MIX;
      dryGain.gain.value = DRY_SIGNAL_MIX;
    }
    const gate = audioContext.createGain();
    gate.gain.value = this.pendingOpen ? 1 : 0;
    const destination = audioContext.createMediaStreamDestination();
    if (rnnoise && processedGain && dryGain) {
      source.connect(rnnoise).connect(processedGain).connect(gate);
      source.connect(dryGain).connect(gate);
    } else {
      source.connect(gate);
    }
    gate.connect(destination);
    const processedTrack = destination.stream.getAudioTracks()[0];
    if (!processedTrack) {
      rnnoise?.destroy();
      source.disconnect();
      throw new Error("Microphone processor did not produce an audio track");
    }
    this.source = source;
    this.rnnoise = rnnoise;
    this.processedGain = processedGain;
    this.dryGain = dryGain;
    this.gate = gate;
    this.destination = destination;
    this.processedTrack = processedTrack;
  }

  setGateOpen(open: boolean): void {
    this.pendingOpen = open;
    const gate = this.gate;
    const context = this.audioContext;
    if (!gate || !context) return;
    const now = context.currentTime;
    gate.gain.cancelScheduledValues(now);
    gate.gain.setTargetAtTime(open ? 1 : 0, now, open ? GATE_OPEN_TIME : GATE_CLOSE_TIME);
  }

  async restart(options: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.rnnoise?.disconnect();
    this.rnnoise?.destroy();
    this.processedGain?.disconnect();
    this.dryGain?.disconnect();
    this.gate?.disconnect();
    this.destination?.disconnect();
    this.processedTrack?.stop();
    this.audioContext = undefined;
    this.source = undefined;
    this.rnnoise = undefined;
    this.processedGain = undefined;
    this.dryGain = undefined;
    this.gate = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }
}
