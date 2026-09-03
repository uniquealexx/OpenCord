/**
 * Короткие служебные звуки голосового чата: вход и выход из комнаты, запуск и
 * завершение демонстрации, подключение к чужой демонстрации и отключение от неё.
 *
 * Сами клипы сгенерированы в ElevenLabs, обрезаны до первого сэмпла (ведущая
 * тишина срезана — звук должен начинаться в момент события, а не через полсекунды),
 * выровнены по среднему уровню −16 dBFS (по пику выравнивать бесполезно: у короткого
 * «блипа» весь запас съедает щелчок атаки, и на слух он тонет рядом с остальными)
 * и встроены в `voice-sound-data.ts` как data-URI: renderer
 * грузится с `file://`, поэтому путь к файлу в `public/` в статическом экспорте
 * ненадёжен, а `media-src data:` в CSP разрешён.
 *
 * Воспроизведение идёт через Web Audio, а не через `<audio>`: буфер декодируется
 * один раз, повторный вызов стартует мгновенно и без сборки нового элемента.
 */
import { VOICE_SOUND_DATA } from "@/lib/voice-sound-data";

export type VoiceSoundName = keyof typeof VOICE_SOUND_DATA;

export const VOICE_SOUND_NAMES = Object.keys(VOICE_SOUND_DATA) as VoiceSoundName[];

type AudioContextConstructor = new () => AudioContext;

let context: AudioContext | null = null;
let outputDeviceId: string | null = null;
const buffers = new Map<VoiceSoundName, AudioBuffer>();
const decoding = new Map<VoiceSoundName, Promise<AudioBuffer | null>>();

function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const constructor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext) as
    | AudioContextConstructor
    | undefined;
  if (!constructor) return null;
  try {
    context = new constructor();
  } catch {
    return null;
  }
  applyOutputDevice();
  return context;
}

/** Вывод служебных звуков в то же устройство, что выбрано для голоса; поддержки может не быть — тогда играет устройство по умолчанию. */
function applyOutputDevice(): void {
  const active = context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (!active?.setSinkId || !outputDeviceId) return;
  void active.setSinkId(outputDeviceId).catch(() => undefined);
}

export function setVoiceSoundOutputDevice(deviceId: string | null): void {
  outputDeviceId = deviceId;
  applyOutputDevice();
}

/** data-URI → ArrayBuffer: `decodeAudioData` принимает только сырые байты. */
function decodeDataUri(uri: string): ArrayBuffer {
  const binary = atob(uri.slice(uri.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function loadBuffer(active: AudioContext, name: VoiceSoundName): Promise<AudioBuffer | null> {
  const started = decoding.get(name);
  if (started) return started;
  const pending = Promise.resolve()
    .then(() => active.decodeAudioData(decodeDataUri(VOICE_SOUND_DATA[name])))
    .then((buffer) => {
      buffers.set(name, buffer);
      return buffer;
    })
    .catch(() => null);
  decoding.set(name, pending);
  return pending;
}

/** Общая громкость служебных звуков: клипы выровнены между собой, этот множитель задаёт уровень всей группы. */
const MASTER_GAIN = 0.6;

function play(active: AudioContext, buffer: AudioBuffer): void {
  const source = active.createBufferSource();
  source.buffer = buffer;
  const gain = active.createGain();
  gain.gain.value = MASTER_GAIN;
  source.connect(gain);
  gain.connect(active.destination);
  source.start();
}

/**
 * Прогрев: декодирует все клипы заранее, чтобы первый же звук зазвучал без
 * паузы на разбор mp3. Вызывается при подключении к голосовому каналу.
 */
export function primeVoiceSounds(): void {
  const active = audioContext();
  if (!active) return;
  for (const name of VOICE_SOUND_NAMES) void loadBuffer(active, name);
}

/**
 * Воспроизведение звука события. Ошибки гасятся намеренно: звук — украшение,
 * из-за отсутствующего или заблокированного до первого клика аудиоконтекста
 * не должен падать вход в комнату.
 */
export function playVoiceSound(name: VoiceSoundName): void {
  const active = audioContext();
  if (!active) return;
  try {
    if (active.state === "suspended") void active.resume().catch(() => undefined);
    const ready = buffers.get(name);
    // Уже декодированный звук стартует синхронно — задержки между событием и звуком нет.
    if (ready) {
      play(active, ready);
      return;
    }
    void loadBuffer(active, name).then((buffer) => {
      if (buffer) play(active, buffer);
    });
  } catch {
    // намеренно тихо: см. комментарий выше
  }
}

/** Только для тестов: сбрасывает контекст и кэш буферов. */
export function resetVoiceSoundsForTests(): void {
  context = null;
  outputDeviceId = null;
  buffers.clear();
  decoding.clear();
}
