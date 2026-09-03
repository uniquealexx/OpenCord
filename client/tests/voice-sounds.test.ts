import { afterEach, describe, expect, it, vi } from "vitest";
import { VOICE_SOUND_DATA } from "@/lib/voice-sound-data";
import { VOICE_SOUND_NAMES, playVoiceSound, primeVoiceSounds, resetVoiceSoundsForTests, setVoiceSoundOutputDevice } from "@/lib/voice-sounds";

function createContextStub(overrides: Partial<{ setSinkId: (id: string) => Promise<void>; state: string; failDecode: boolean }> = {}) {
  const started: number[] = [];
  const decoded: number[] = [];
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    sampleRate: 48000,
    state: overrides.state ?? "running",
    destination: {},
    resume: vi.fn(async function () {
      return undefined;
    }),
    ...(overrides.setSinkId ? { setSinkId: overrides.setSinkId } : {}),
    decodeAudioData: vi.fn(async function (data: ArrayBuffer) {
      if (overrides.failDecode) throw new Error("bad audio");
      decoded.push(data.byteLength);
      return { duration: 0.5, length: 24000 } as unknown as AudioBuffer;
    }),
    createGain: vi.fn(function () {
      const node = { gain: { value: 1 }, connect: vi.fn() };
      gains.push(node);
      return node;
    }),
    createBufferSource: vi.fn(function () {
      return {
        buffer: null as unknown,
        connect: vi.fn(),
        start: vi.fn(function () {
          started.push(1);
        }),
      };
    }),
  };
  return { context, started, decoded, gains };
}

function installContext(stub: { context: unknown }): void {
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    writable: true,
    value: vi.fn(function () {
      return stub.context;
    }),
  });
}

afterEach(() => {
  resetVoiceSoundsForTests();
  vi.restoreAllMocks();
});

describe("встроенные клипы", () => {
  it("содержит все шесть событий как mp3 в data-URI", () => {
    expect(VOICE_SOUND_NAMES).toEqual(["voiceJoin", "voiceLeave", "screenShareStart", "screenShareStop", "screenShareViewStart", "screenShareViewStop"]);
    for (const name of VOICE_SOUND_NAMES) {
      const uri = VOICE_SOUND_DATA[name];
      expect(uri.startsWith("data:audio/mpeg;base64,")).toBe(true);
      const bytes = atob(uri.slice(uri.indexOf(",") + 1));
      // ID3-тег или синхрослово кадра — иначе в бандл попал не mp3.
      expect(bytes.startsWith("ID3") || bytes.charCodeAt(0) === 0xff).toBe(true);
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });
});

describe("воспроизведение", () => {
  it("декодирует клип один раз и переиспользует буфер", async () => {
    const stub = createContextStub();
    installContext(stub);

    playVoiceSound("voiceJoin");
    await vi.waitFor(() => expect(stub.started).toHaveLength(1));
    playVoiceSound("voiceJoin");
    playVoiceSound("voiceLeave");
    await vi.waitFor(() => expect(stub.started).toHaveLength(3));

    expect(stub.context.decodeAudioData).toHaveBeenCalledTimes(2);
  });

  it("прогрев декодирует все звуки, и следующий вызов стартует без ожидания", async () => {
    const stub = createContextStub();
    installContext(stub);

    primeVoiceSounds();
    await vi.waitFor(() => expect(stub.decoded).toHaveLength(VOICE_SOUND_NAMES.length));
    playVoiceSound("screenShareStart");

    expect(stub.started).toHaveLength(1);
    expect(stub.context.decodeAudioData).toHaveBeenCalledTimes(VOICE_SOUND_NAMES.length);
  });

  it("будит приостановленный до первого клика контекст", async () => {
    const stub = createContextStub({ state: "suspended" });
    installContext(stub);

    playVoiceSound("voiceJoin");

    expect(stub.context.resume).toHaveBeenCalled();
    await vi.waitFor(() => expect(stub.started).toHaveLength(1));
  });

  it("играет через общий регулятор громкости, а не напрямую в выход", async () => {
    const stub = createContextStub();
    installContext(stub);

    playVoiceSound("voiceJoin");
    await vi.waitFor(() => expect(stub.started).toHaveLength(1));

    expect(stub.gains).toHaveLength(1);
    expect(stub.gains[0]!.gain.value).toBeGreaterThan(0);
    expect(stub.gains[0]!.gain.value).toBeLessThanOrEqual(1);
    expect(stub.gains[0]!.connect).toHaveBeenCalledWith(stub.context.destination);
  });

  it("отправляет звуки в выбранное для голоса устройство вывода", () => {
    const setSinkId = vi.fn(async function () {
      return undefined;
    });
    installContext(createContextStub({ setSinkId }));

    setVoiceSoundOutputDevice("headset-1");
    playVoiceSound("voiceJoin");

    expect(setSinkId).toHaveBeenCalledWith("headset-1");
  });

  it("молчит, а не падает, когда декодирование не удалось", async () => {
    const stub = createContextStub({ failDecode: true });
    installContext(stub);

    expect(() => playVoiceSound("voiceJoin")).not.toThrow();
    await vi.waitFor(() => expect(stub.context.decodeAudioData).toHaveBeenCalled());
    expect(stub.started).toHaveLength(0);
  });

  it("молчит, а не падает, когда Web Audio недоступен", () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: undefined });

    expect(() => playVoiceSound("voiceJoin")).not.toThrow();
    expect(() => primeVoiceSounds()).not.toThrow();
  });

  it("молчит, а не падает, когда контекст не создаётся", () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: vi.fn(function () {
        throw new Error("no audio device");
      }),
    });

    expect(() => playVoiceSound("voiceLeave")).not.toThrow();
  });
});
