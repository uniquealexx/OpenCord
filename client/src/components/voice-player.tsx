"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function formatVoiceSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export const VOICE_MESSAGE_MIME_TYPES = ["audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4", "audio/wav", "audio/x-wav"] as const;
const VOICE_MESSAGE_FILE_PATTERN = /^voice-message-\d{8}-\d{6}\.(?:webm|ogg|oga|m4a|mp3|wav)$/iu;

/**
 * Голосовое сообщение, а не просто аудиофайл: совпадают и MIME-тип, и имя,
 * которое ставит диктофон композера. Обычный song.mp3 сюда не попадает.
 */
export function isVoiceMessage(attachment: { fileName: string; mimeType: string }): boolean {
  return VOICE_MESSAGE_MIME_TYPES.includes(attachment.mimeType as (typeof VOICE_MESSAGE_MIME_TYPES)[number])
    && VOICE_MESSAGE_FILE_PATTERN.test(attachment.fileName);
}

/** Кастомный плеер голосовых в токенах приложения: круглая кнопка, прогресс-бар, время. */
export function VoicePlayer({ src, label, durationHint = null, onError }: { src: string; label: string; durationHint?: number | null; onError?: () => void }): React.ReactElement {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState<number | null>(durationHint);

  async function toggle(): Promise<void> {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      onError?.();
    }
  }

  function seekTo(clientX: number): void {
    const bar = barRef.current;
    const audio = audioRef.current;
    if (!bar || !audio || !total) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * total;
    setCurrent(audio.currentTime);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    const audio = audioRef.current;
    if (!audio || !total) return;
    if (event.key === "ArrowRight") {
      audio.currentTime = Math.min(total, audio.currentTime + 5);
      setCurrent(audio.currentTime);
      event.preventDefault();
    } else if (event.key === "ArrowLeft") {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      setCurrent(audio.currentTime);
      event.preventDefault();
    }
  }

  const progress = total ? Math.min(1, Math.max(0, current / total)) : 0;
  const playLabel = playing ? t.chat.voicePause : t.chat.voicePlay;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <button
        type="button"
        onClick={() => void toggle()}
        title={playLabel}
        aria-label={`${playLabel}: ${label}`}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-violet-400/15 text-violet-200 transition hover:bg-violet-400/25 active:scale-95"
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-[1px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total === null ? 0 : Math.round(total)}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${formatVoiceSeconds(Math.floor(current))} / ${total === null ? "--:--" : formatVoiceSeconds(Math.floor(total))}`}
          onClick={(event) => seekTo(event.clientX)}
          onKeyDown={handleKeyDown}
          className="flex h-5 cursor-pointer items-center outline-none focus-visible:ring-1 focus-visible:ring-violet-400/50 rounded"
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full bg-violet-400 transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
          {formatVoiceSeconds(Math.floor(current))} / {total === null ? "--:--" : formatVoiceSeconds(Math.floor(total))}
        </p>
      </div>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-hidden
        tabIndex={-1}
        className="hidden"
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) setTotal(duration);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onError={() => onError?.()}
      />
    </div>
  );
}
