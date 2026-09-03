/**
 * Сборка `src/lib/voice-sound-data.ts` из mp3-файлов в `sounds/`.
 *
 * Звуки встраиваются в код как data-URI, а не кладутся в `public/`: renderer
 * грузится с `file://`, статический экспорт Next.js подставляет относительный
 * `assetPrefix`, и путь к файлу из бандла ненадёжен, тогда как `media-src data:`
 * в CSP разрешён (см. `src/app/layout.tsx`). Шесть клипов дают ~80 КБ base64.
 *
 *   node scripts/embed-voice-sounds.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = ["voiceJoin", "voiceLeave", "screenShareStart", "screenShareStop", "screenShareViewStart", "screenShareViewStop"];

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const entries = [];
for (const name of NAMES) {
  const file = path.join(root, "sounds", `${name}.mp3`);
  const data = await readFile(file);
  entries.push(`  ${name}: "data:audio/mpeg;base64,${data.toString("base64")}",`);
  console.log(`${name}: ${(data.length / 1024).toFixed(1)} КБ`);
}

const source = `/* Сгенерировано scripts/embed-voice-sounds.mjs из sounds/*.mp3 — не редактировать вручную. */

/** Служебные звуки голосового чата как data-URI; ключи задают допустимые имена звуков. */
export const VOICE_SOUND_DATA = {
${entries.join("\n")}
} as const;
`;

await writeFile(path.join(root, "src", "lib", "voice-sound-data.ts"), source, "utf8");
console.log("src/lib/voice-sound-data.ts обновлён");
